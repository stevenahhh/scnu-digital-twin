import assert from 'node:assert/strict';
import test from 'node:test';

import { GlbBuilder } from './glb.mjs';
import { MeshData } from './meshData.mjs';
import { ObjectTags, emitObjectNodes, pivotOf, rebase, splitByOwner } from './objectNodes.mjs';

const box = (mesh, [x0, y0, z0], [x1, y1, z1], color) => {
  mesh.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], undefined, color);
  mesh.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], undefined, color);
};

test('splitByOwner gives each owner its own compact mesh and keeps vertex attributes', () => {
  const mesh = new MeshData({ uvs: false, colors: true });
  box(mesh, [0, 0, 0], [1, 1, 1], [10, 20, 30, 255]);
  box(mesh, [5, 2, 5], [6, 3, 6], [40, 50, 60, 255]);
  const owners = [...new Array(8).fill('A'), ...new Array(8).fill('B')];
  const parts = splitByOwner(mesh, owners);
  assert.deepEqual([...parts.keys()], ['A', 'B']);
  const b = parts.get('B');
  assert.equal(b.vertexCount, 8);
  assert.equal(b.indices.length, 12);
  assert.ok(b.indices.every((i) => i >= 0 && i < 8));
  assert.deepEqual(b.positions.slice(0, 3), [5, 2, 5]);
  assert.deepEqual(b.colors.slice(0, 4), [40, 50, 60, 255]);
  assert.equal(b.uvs, null);
});

test('splitByOwner rejects a triangle whose vertices belong to different owners', () => {
  const mesh = new MeshData();
  mesh.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]);
  assert.throws(() => splitByOwner(mesh, ['A', 'A', 'B', 'B']), /mixed owners/);
});

test('pivotOf is the bbox centre in x and z and the bbox minimum in y over every part', () => {
  const a = new MeshData();
  box(a, [0, 1, 0], [2, 3, 4]);
  const b = new MeshData();
  box(b, [4, 0.5, 2], [6, 2, 8]);
  assert.deepEqual(pivotOf([a, b]), [3, 0.5, 4]);
});

test('rebase moves positions relative to the pivot and leaves normals alone', () => {
  const mesh = new MeshData();
  box(mesh, [10, 1, 20], [12, 2, 22]);
  const normals = [...mesh.normals];
  rebase(mesh, [11, 1, 21]);
  assert.deepEqual(mesh.positions.slice(0, 3), [-1, 0, -1]);
  assert.deepEqual(mesh.normals, normals);
});

test('ObjectTags assigns every vertex added since the last tag, in every layer, to the tagged id', () => {
  const solid = new MeshData();
  const glass = new MeshData();
  const tags = new ObjectTags();
  tags.addLayer('solid', solid);
  tags.addLayer('glass', glass);
  box(solid, [0, 0, 0], [1, 1, 1]);
  box(glass, [0, 0, 0], [1, 1, 1]);
  tags.tag('A', { kind: 'bench', category: 'furniture' });
  box(solid, [3, 0, 3], [4, 1, 4]);
  tags.tag('B', { kind: 'fence', category: 'furniture' });
  assert.deepEqual(tags.layer('solid').owners, [...new Array(8).fill('A'), ...new Array(8).fill('B')]);
  assert.deepEqual(tags.layer('glass').owners, new Array(8).fill('A'));
  assert.deepEqual([...tags.objects.keys()], ['A', 'B']);
});

test('emitObjectNodes writes one node per object at its base pivot, one primitive per material, grouped by kind', () => {
  const glb = new GlbBuilder();
  const solidMaterial = glb.addMaterial({ name: 'Furniture' });
  const glassMaterial = glb.addMaterial({ name: 'Furniture_Glass' });
  const solid = new MeshData({ uvs: false, colors: true });
  const glass = new MeshData({ uvs: false, colors: true });
  const tags = new ObjectTags();
  tags.addLayer('solid', solid, solidMaterial);
  tags.addLayer('glass', glass, glassMaterial);
  box(solid, [0, 1, 0], [2, 2, 2]);
  box(glass, [0, 2, 0], [2, 3, 2]);
  tags.tag('SH-1', { kind: 'shelter', category: 'furniture', extras: { estimated: true } });
  box(solid, [10, 0, 10], [11, 4, 11]);
  tags.tag('LP-1', { kind: 'street_lamp/path', category: 'lamp' });

  const emitted = emitObjectNodes(glb, tags, { objectNumbers: new Map([['SH-1', 7], ['LP-1', 9]]) });
  assert.deepEqual(emitted.map((e) => e.id), ['SH-1', 'LP-1']);
  const shelter = glb.json.nodes[emitted[0].node];
  assert.equal(shelter.name, 'SH-1');
  assert.deepEqual(shelter.translation, [1, 1, 1]);
  assert.deepEqual(shelter.extras.editable, { id: 'SH-1', kind: 'shelter', category: 'furniture' });
  assert.equal(shelter.extras.estimated, true);
  const mesh = glb.json.meshes[shelter.mesh];
  assert.equal(mesh.name, 'SH-1');
  assert.deepEqual(mesh.primitives.map((p) => p.material), [solidMaterial, glassMaterial]);
  const position = glb.json.accessors[mesh.primitives[0].attributes.POSITION];
  assert.deepEqual(position.min, [-1, 0, -1]);
  assert.deepEqual(position.max, [1, 1, 1]);
  const ids = glb.json.accessors[mesh.primitives[1].attributes._OBJECT_ID];
  assert.equal(ids.count, 8);

  const lamp = glb.json.nodes[emitted[1].node];
  assert.deepEqual(lamp.translation, [10.5, 0, 10.5]);
  assert.equal(glb.json.meshes[lamp.mesh].primitives.length, 1);

  const groups = glb.groupRoots([]);
  assert.deepEqual([...groups.keys()].sort(), ['Furniture', 'Furniture/shelter', 'Furniture/street_lamp_path']);
  const shelterGroup = glb.json.nodes[groups.get('Furniture/shelter')];
  assert.deepEqual(shelterGroup.children, [emitted[0].node]);
  assert.equal(shelterGroup.extras.collection, true);
});

test('emitObjectNodes refuses geometry that no object owns', () => {
  const glb = new GlbBuilder();
  const solid = new MeshData();
  const tags = new ObjectTags();
  tags.addLayer('solid', solid, glb.addMaterial({ name: 'Furniture' }));
  box(solid, [0, 0, 0], [1, 1, 1]);
  tags.tag(null);
  assert.throws(() => emitObjectNodes(glb, tags), /no object owns 4 triangles/);
});

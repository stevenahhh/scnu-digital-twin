import assert from "node:assert/strict";
import test from "node:test";
import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { createSceneEditor, kindLabel, recenterView } from "./sceneEditor.mjs";

// generator contract: an object node's origin is its base centre
const box = () => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const material = () => new MeshStandardMaterial();
const at = (x, y, z) => new Matrix4().makeTranslation(x, y, z);

// A small stand-in for campus-v2.glb after the per-object split: collections, editable nodes (extras.editable lands in
// userData), a building pick prism, a lamp with its light pool instance and an instanced tree species.
function campus() {
  const scene = new Group();
  const furniture = new Group();
  furniture.name = "Furniture";
  furniture.position.set(10, 0, 0);
  const fence = new Group();
  fence.name = "OC0101";
  fence.position.set(5, 1, 5);
  fence.userData.editable = { id: "OC0101", kind: "fence", category: "furniture" };
  fence.add(new Mesh(box(), material()));
  const lamp = new Mesh(box(), material());
  lamp.name = "SL01";
  lamp.position.set(-4, 0, 2);
  lamp.userData.editable = { id: "SL01", kind: "street_lamp/path", category: "lamp" };
  furniture.add(fence, lamp);

  const pools = new InstancedMesh(box(), material(), 1);
  pools.name = "Lamps_pools";
  pools.userData.lampIds = ["SL01"];
  pools.setMatrixAt(0, at(-4, 0.1, 4));

  const model = new Mesh(box(), material());
  model.name = "BLD_SCNU_E8_Model";
  model.position.set(50, 0, 50);
  model.userData.editable = { id: "BLD_SCNU_E8", kind: "building", category: "building" };
  const proxy = new Mesh(box(), material());
  proxy.name = "BLD_SCNU_E8";
  proxy.position.set(50, 0, 50);
  proxy.userData.pickProxy = true;

  const pine = new Group();
  pine.name = "Trees_pine";
  const trunk = new InstancedMesh(box(), material(), 2);
  trunk.name = "Trees_pine_trunk";
  const crown = new InstancedMesh(box(), material(), 2);
  crown.name = "Trees_pine_crown";
  for (let i = 0; i < 2; i += 1) {
    trunk.setMatrixAt(i, at(i * 10, 0, 0));
    crown.setMatrixAt(i, at(i * 10, 3, 0));
  }
  pine.add(trunk, crown);
  scene.add(furniture, pools, model, proxy, pine);
  scene.updateMatrixWorld(true);
  return { scene, fence, lamp, pools, model, proxy, trunk, crown };
}

const draft = (patch = {}) => ({ revision: 0, transforms: {}, removed: [], added: [], ...patch });
const instancePosition = (mesh, index) => {
  const m = new Matrix4();
  mesh.getMatrixAt(index, m);
  return new Vector3().setFromMatrixPosition(m).toArray();
};
const turnY = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).toArray();
// instance matrices are Float32Array storage
const close = (actual, expected) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6, `${actual} vs ${expected}`));

test("every editable node and every tree instance is indexed, with a library by kind", () => {
  const editor = createSceneEditor(campus().scene);
  assert.deepEqual([...editor.entries.keys()].sort(), ["BLD_SCNU_E8", "OC0101", "SL01", "Trees_pine#0", "Trees_pine#1"]);
  assert.deepEqual(editor.entries.get("Trees_pine#1").transform.position, [10, 0, 0]);
  assert.deepEqual(editor.library().map(({ key, count, prototype }) => [key, count, prototype]), [
    ["building/building", 1, "BLD_SCNU_E8"],
    ["furniture/fence", 1, "OC0101"],
    ["lamp/street_lamp/path", 1, "SL01"],
    ["tree/pine", 2, "Trees_pine#0"],
  ]);
  assert.equal(kindLabel("fence"), "펜스");
  assert.equal(kindLabel("plaza_structure/fountain"), "분수");
  assert.equal(kindLabel("unknown_thing"), "unknown_thing");
});

test("a moved object takes its followers along: the lamp's light pool and the building's pick prism", () => {
  const c = campus();
  const editor = createSceneEditor(c.scene);
  editor.apply(draft({ transforms: {
    SL01: { position: [-4, 0, 12], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    BLD_SCNU_E8: { position: [60, 0, 50], quaternion: turnY, scale: [2, 1, 2] },
    OC0101: { position: [7, 1, 5], quaternion: [0, 0, 0, 1], scale: [1, 3, 1] },
  } }));
  close(c.lamp.position.toArray(), [-4, 0, 12]);
  close(instancePosition(c.pools, 0), [-4, 0.1, 14]);
  close(c.proxy.position.toArray(), [60, 0, 50]);
  close(c.proxy.quaternion.toArray(), turnY);
  close(c.proxy.scale.toArray(), [2, 1, 2]);
  close(c.fence.scale.toArray(), [1, 3, 1]);

  editor.apply(draft());
  close(c.lamp.position.toArray(), [-4, 0, 2]);
  close(instancePosition(c.pools, 0), [-4, 0.1, 4]);
  close(c.proxy.position.toArray(), [50, 0, 50]);
});

test("a tree instance moves trunk and crown together and a removed one disappears from drawing and picking", () => {
  const c = campus();
  const editor = createSceneEditor(c.scene);
  editor.apply(draft({ transforms: { "Trees_pine#1": { position: [10, 0, 20], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] } } }));
  close(instancePosition(c.trunk, 1), [10, 0, 20]);
  close(instancePosition(c.crown, 1), [10, 3, 20]);

  editor.apply(draft({ removed: ["Trees_pine#0", "OC0101", "BLD_SCNU_E8"] }));
  const m = new Matrix4();
  c.crown.getMatrixAt(0, m);
  assert.equal(m.determinant(), 0);
  assert.equal(c.fence.visible, false);
  assert.equal(c.fence.children[0].layers.mask, 0);
  assert.equal(c.proxy.layers.mask, 0);
  assert.equal(editor.pick([{ object: c.trunk, instanceId: 0 }, { object: c.fence.children[0] }, { object: c.trunk, instanceId: 1 }]), "Trees_pine#1");

  editor.apply(draft());
  assert.equal(c.fence.visible, true);
  assert.equal(c.fence.children[0].layers.mask, 1);
  assert.equal(c.proxy.layers.mask, 1);
  close(instancePosition(c.crown, 0), [0, 3, 0]);
});

test("picking maps a hit to the object id: nodes, pick prisms and instances; anything else is no object", () => {
  const c = campus();
  const editor = createSceneEditor(c.scene);
  assert.equal(editor.pick([{ object: c.fence.children[0] }]), "OC0101");
  assert.equal(editor.pick([{ object: c.proxy }]), "BLD_SCNU_E8");
  assert.equal(editor.pick([{ object: c.pools, instanceId: 0 }]), null);
  assert.equal(editor.pick([]), null);
});

test("added objects are copies of their prototype under the same parent, and leave when the draft drops them", () => {
  const c = campus();
  const editor = createSceneEditor(c.scene);
  const placed = { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
  editor.apply(draft({ added: [
    { id: "ADD_a", prototype: "OC0101", ...placed },
    { id: "ADD_b", prototype: "Trees_pine#1", ...placed },
    { id: "ADD_c", prototype: "gone", ...placed },
  ] }));
  const fenceCopy = editor.entries.get("ADD_a");
  assert.equal(fenceCopy.target.parent, c.fence.parent);
  close(fenceCopy.target.position.toArray(), [1, 2, 3]);
  assert.equal(fenceCopy.target.children[0].geometry, c.fence.children[0].geometry);
  assert.equal(editor.pick([{ object: fenceCopy.target.children[0] }]), "ADD_a");
  const treeCopy = editor.entries.get("ADD_b");
  assert.equal(treeCopy.target.children.length, 2);
  // tree materials are patched for instanced drawing, so a copy is a one-instance mesh with the same material
  assert.ok(treeCopy.target.children.every((mesh) => mesh.isInstancedMesh && mesh.count === 1));
  assert.equal(treeCopy.target.children[1].material, c.crown.material);
  close(instancePosition(treeCopy.target.children[1], 0), [0, 3, 0]);
  assert.equal(editor.pick([{ object: treeCopy.target.children[1], instanceId: 0 }]), "ADD_b");
  assert.deepEqual(editor.missingPrototypes(), ["gone"]);

  editor.apply(draft());
  assert.equal(editor.entries.has("ADD_a"), false);
  assert.equal(fenceCopy.target.parent, null);
});

test("a new copy placed at a world point keeps the prototype's turn and size in its parent's frame", () => {
  const c = campus();
  const editor = createSceneEditor(c.scene);
  editor.apply(draft({ transforms: { OC0101: { position: [5, 1, 5], quaternion: turnY, scale: [1, 2, 1] } } }));
  const placed = editor.placement("OC0101", [20, 0, 3]);
  close(placed.position, [10, 0, 3]);
  close(placed.quaternion, turnY);
  assert.deepEqual(placed.scale, [1, 2, 1]);
  close(editor.placement("Trees_pine#1", [4, 0, 4]).position, [4, 0, 4]);
});

test("a second editor on the cached scene starts from the original model, without the first one's copies", () => {
  const c = campus();
  const first = createSceneEditor(c.scene);
  const placed = { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
  first.apply(draft({
    transforms: { OC0101: { ...placed, position: [9, 9, 9] }, "Trees_pine#0": placed, SL01: placed },
    removed: ["BLD_SCNU_E8"], added: [{ id: "ADD_a", prototype: "OC0101", ...placed }],
  }));
  void first.entries.get("Trees_pine#0").target;
  const second = createSceneEditor(c.scene);
  assert.deepEqual(second.entries.get("OC0101").original.position, [5, 1, 5]);
  close(instancePosition(c.crown, 0), [0, 3, 0]);
  close(instancePosition(c.pools, 0), [-4, 0.1, 4]);
  assert.equal(c.proxy.layers.mask, 1);
  assert.equal(c.fence.parent.children.some((child) => child.name === "ADD_a"), false);
  assert.equal(c.trunk.children.length, 0);
  assert.equal(second.pick([{ object: c.pools, instanceId: 0 }]), null);
});

test("a click on the ground beside a thin object picks the nearest small object within reach", () => {
  const c = campus();
  const editor = createSceneEditor(c.scene);
  // fence box spans x 14.5..15.5, y 1..2, z 4.5..5.5 in world (Furniture group at x = 10)
  assert.equal(editor.pickNear([15, 0.9, 6.2], 1), "OC0101");
  assert.equal(editor.pickNear([15, 0.9, 8], 1), null);
  assert.equal(editor.pickNear([50, 0, 50], 1), null, "buildings and trees are picked by the ray only");
  editor.apply(draft({ removed: ["OC0101"] }));
  assert.equal(editor.pickNear([15, 0.9, 6.2], 1), null);
});

test("a click on coplanar ground layers picks the editable layer, a road marking before the pavement under it", () => {
  const c = campus();
  const layer = (name, editable) => {
    const mesh = new Mesh(box(), material());
    mesh.name = name;
    if (editable) mesh.userData.editable = editable;
    c.scene.add(mesh);
    return mesh;
  };
  const terrain = layer("Topography_joined");
  const asphalt = layer("Ground_Asphalt_W1", { id: "W1", kind: "asphalt", category: "ground" });
  const zebra = layer("Road_Markings_X1", { id: "X1", kind: "crosswalk", category: "marking" });
  c.scene.updateMatrixWorld(true);
  const editor = createSceneEditor(c.scene);
  assert.equal(editor.pick([{ object: terrain, distance: 50 }, { object: asphalt, distance: 50.01 }]), "W1");
  assert.equal(editor.pick([{ object: asphalt, distance: 50 }, { object: terrain, distance: 50.005 }, { object: zebra, distance: 50.01 }]), "X1");
  // a layer well below the first surface is a different thing, not the same ground
  assert.equal(editor.pick([{ object: terrain, distance: 50 }, { object: asphalt, distance: 53 }]), null);
  // an object standing on the ground still wins over the ground behind it
  assert.equal(editor.pick([{ object: c.fence.children[0], distance: 40 }, { object: asphalt, distance: 50 }]), "OC0101");
});

test("hidden objects are not picked, but the invisible pick prisms are", () => {
  const c = campus();
  const editor = createSceneEditor(c.scene);
  c.proxy.visible = false;
  c.pools.visible = false;
  assert.equal(editor.pick([{ object: c.pools, instanceId: 0 }, { object: c.proxy }]), "BLD_SCNU_E8");
});

test("a node whose geometry sits away from its origin turns and scales about its own base centre", () => {
  const c = campus();
  // like the BLD_* nodes: identity transform, vertices in scene coordinates
  const hall = new Group();
  hall.name = "BLD_A1";
  hall.userData.editable = { id: "BLD_A1", kind: "building", category: "building" };
  const walls = new Mesh(new BoxGeometry(10, 4, 6).translate(80, 2, -30), material());
  hall.add(walls);
  c.scene.add(hall);
  const editor = createSceneEditor(c.scene);
  const entry = editor.entries.get("BLD_A1");
  close(entry.transform.position, [80, 0, -30]);
  editor.apply(draft({ transforms: { BLD_A1: { position: [80, 0, -30], quaternion: turnY, scale: [2, 2, 2] } } }));
  const box = editor.boundsOf("BLD_A1", new Box3());
  close(box.getCenter(new Vector3()).toArray(), [80, 4, -30]);
  close(box.getSize(new Vector3()).toArray(), [12, 8, 20]);
  editor.apply(draft());
  close(editor.boundsOf("BLD_A1", new Box3()).getCenter(new Vector3()).toArray(), [80, 2, -30]);
  assert.equal(editor.pick([{ object: walls }]), "BLD_A1");
  const copy = editor.apply(draft({ added: [{ id: "ADD_h", prototype: "BLD_A1", position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] }] }));
  assert.equal(copy, true);
  close(editor.boundsOf("ADD_h", new Box3()).getCenter(new Vector3()).toArray(), [0, 2, 0]);
});

test("an edit that would sink an object rests it on the surface under it; buildings and floating poses are left alone", () => {
  const c = campus();
  const ground = new Mesh(new BoxGeometry(400, 0.2, 400).translate(0, -0.1, 0), material());
  ground.name = "Ground_Test";
  c.scene.add(ground);
  c.scene.updateMatrixWorld(true);
  const editor = createSceneEditor(c.scene);
  const sunk = editor.constrain("OC0101", { position: [5, -0.5, 5], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] });
  close(sunk.position, [5, 0, 5]);
  // one drag step can push it far below the surface: it still comes back on top
  close(editor.constrain("OC0101", { position: [5, -40, 5], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] }).position, [5, 0, 5]);
  const floating = { position: [5, 3, 5], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
  assert.deepEqual(editor.constrain("OC0101", floating), floating);
  const building = { position: [50, -4, 50], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
  assert.deepEqual(editor.constrain("BLD_SCNU_E8", building), building);
  // a tree instance is lifted too, and its own crown never counts as the surface under it
  close(editor.constrain("Trees_pine#1", { position: [10, -2, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] }).position, [10, 0, 0]);
  // another object under it is a surface as well: the lamp (top at y = 1) holds up a fence dropped onto it
  const stacked = editor.constrain("OC0101", { position: [-4, 0.5, 2], quaternion: [0, 0, 0, 1], scale: [0.4, 1, 0.4] });
  close(stacked.position, [-4, 1, 2]);
});

test("vertex moves reshape the object, a reload of the draft restores it, and a new editor starts from the original geometry", () => {
  const c = campus();
  const editor = createSceneEditor(c.scene);
  const mesh = c.fence.children[0];
  const original = mesh.geometry;
  const state = editor.vertexState("OC0101");
  const top = state.groups.find((g) => g.position[1] === 1);
  const key = state.keyOf(top);
  editor.apply(draft({ vertices: { OC0101: [{ ...key, offset: [0, 2, 0] }] } }));
  for (const member of top.members) assert.equal(mesh.geometry.attributes.position.getY(member.index), 3);
  editor.previewVertices("OC0101", []);
  editor.apply(draft({ vertices: { OC0101: [{ ...key, offset: [0, 2, 0] }] } }));
  assert.equal(mesh.geometry.attributes.position.getY(top.members[0].index), 3, "a preview never blocks the next apply");
  editor.apply(draft());
  assert.equal(mesh.geometry.attributes.position.getY(top.members[0].index), 1);
  editor.apply(draft({ vertices: { OC0101: [{ ...key, offset: [0, 2, 0] }] } }));
  createSceneEditor(c.scene);
  assert.equal(mesh.geometry, original);
  assert.equal(editor.vertexState("Trees_pine#0"), null);
});

test("re-centring keeps the camera's direction and distance", () => {
  const view = recenterView({ position: [10, 20, 30], target: [0, 0, 0] }, [5, 1, -2]);
  assert.deepEqual(view, { position: [15, 21, 28], target: [5, 1, -2] });
});

test("a live gizmo move updates followers before the move is committed", () => {
  const c = campus();
  const editor = createSceneEditor(c.scene);
  const entry = editor.entries.get("Trees_pine#0");
  entry.target.position.set(0, 0, 7);
  editor.sync("Trees_pine#0");
  close(instancePosition(c.crown, 0), [0, 3, 7]);
  assert.deepEqual(editor.readTransform("Trees_pine#0").position, [0, 0, 7]);
});

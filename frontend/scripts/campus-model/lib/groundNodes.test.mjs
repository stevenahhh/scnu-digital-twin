import assert from 'node:assert/strict';
import test from 'node:test';

import { GlbBuilder } from './glb.mjs';
import { MARKING_LIFT_M, PAINT_DECIMATE_TOLERANCE_M, emitGroundNode, groundRole, markingGroup, markingKind, nodeName, rebaseExact, snapPivot, surfaceGroup } from './groundNodes.mjs';

const square = (E, N, size = 2) => [[E, N], [E + size, N], [E + size, N + size], [E, N + size]];
const layer = (mesh, parcel, E = 243500, N = 263900, extra = {}) => ({ mesh, parcel, rings: [square(E, N)], ...extra });

test('groundRole: markings are paint on the ground; tactile bands, hump tops and every other ground node are base', () => {
  for (const name of ['Road_Markings_JA_b6b5553a334e7821_crossing', 'Road_Markings_LOT_E243476_N263851']) assert.equal(groundRole(name), 'paint', name);
  for (const name of ['Ground_Asphalt_PARCEL_ROAD_1', 'Ground_Walkway_WALKWAY_E243440_N263760', 'Ground_Tactile_TACTILE_E243440_N263760', 'Ground_HumpTop_RS_1_humps_0', 'Ground_RedRoad_ZONE17', 'Topography_3', 'OuterTerrain']) {
    assert.equal(groundRole(name), 'base', name);
  }
  // the collection node and the hump walls are not ground cover
  assert.equal(groundRole('Road_Markings'), null);
  assert.equal(groundRole('Ground_Hump_RS_1_humps_0'), null);
});

test('paint lies a few millimetres above the ground and decimates well within that gap', () => {
  assert.ok(MARKING_LIFT_M > 0 && MARKING_LIFT_M <= 0.01);
  assert.ok(PAINT_DECIMATE_TOLERANCE_M < MARKING_LIFT_M / 2);
});

test('nodeName keeps only the characters three.js leaves in a node name', () => {
  assert.equal(nodeName('Road_Markings', 'JA_b6b5553a334e7821/crossing'), 'Road_Markings_JA_b6b5553a334e7821_crossing');
  assert.equal(nodeName('Ground_Pavers', 'PARCEL_PAVING_1A2'), 'Ground_Pavers_PARCEL_PAVING_1A2');
  assert.equal(nodeName('Ground_Lot', 'a.b:c d-e'), 'Ground_Lot_a_b_c_d-e');
});

test('snapPivot rounds every axis to a 1/1024 unit grid', () => {
  const pivot = snapPivot([10.123456, -3.0001, 0.5]);
  for (const v of pivot) assert.equal(v * 1024, Math.round(v * 1024));
  assert.ok(pivot.every((v, k) => Math.abs(v - [10.123456, -3.0001, 0.5][k]) <= 0.5 / 1024));
});

test('rebaseExact: pivot plus the float32 local position gives back the float32 world position exactly', () => {
  const world = [512.123456789, 31.987654321, -265.4321987, 498.0000123, 30.5, -270.99999];
  const pivot = snapPivot([505.31, 30.5, -268.2]);
  const local = rebaseExact(world, pivot);
  assert.ok(local instanceof Float32Array);
  for (let i = 0; i < world.length; i += 1) assert.equal(local[i] + pivot[i % 3], Math.fround(world[i]));
});

test('surfaceGroup: one node per parcel for the small classes', () => {
  assert.deepEqual(surfaceGroup(layer('Ground_Pavers', 'PARCEL_PAVING_3A1')), { id: 'PARCEL_PAVING_3A1', kind: 'pavers', name: 'Ground_Pavers_PARCEL_PAVING_3A1' });
  assert.deepEqual(surfaceGroup(layer('Ground_Sports', 'PARCEL_SPORTS_WAY_367126960')).kind, 'sports');
  assert.equal(surfaceGroup(layer('Ground_Plaza', 'PARCEL_PAVING_PLAZA_X')).id, 'PARCEL_PAVING_PLAZA_X');
  assert.equal(surfaceGroup(layer('Ground_RedRoad', 'PARCEL_RED')).kind, 'red_road');
  assert.equal(surfaceGroup(layer('Ground_Bicycle', 'PARCEL_BIKE')).kind, 'bicycle');
});

test('surfaceGroup: a hump top is named after its hump, apart from the hump wall node', () => {
  const group = surfaceGroup({ mesh: 'Ground_Hump', hump: true, humpId: 'MX00105', rings: [square(243500, 263900)] });
  assert.deepEqual(group, { id: 'MX00105', kind: 'hump', name: 'Ground_HumpTop_MX00105' });
});

test('surfaceGroup: road asphalt and campus lots group the parts of one road, junction or lot', () => {
  assert.equal(surfaceGroup(layer('Ground_Asphalt', 'PARCEL_ASPHALT_WAY_123_4')).id, 'PARCEL_ASPHALT_WAY_123');
  assert.equal(surfaceGroup(layer('Ground_Asphalt', 'PARCEL_ASPHALT_WAY_123')).id, 'PARCEL_ASPHALT_WAY_123');
  assert.equal(surfaceGroup(layer('Ground_Asphalt', 'PARCEL_JUNCTION_7_PART_2')).id, 'PARCEL_JUNCTION_7');
  assert.equal(surfaceGroup(layer('Ground_Asphalt', 'PARCEL_SUPPORT_ROAD_5_3_PART_1')).id, 'PARCEL_SUPPORT_ROAD_5');
  assert.equal(surfaceGroup(layer('Ground_Lot', 'PARCEL_SUPPORT_LOT_9_2')).id, 'PARCEL_SUPPORT_LOT_9');
  assert.equal(surfaceGroup(layer('Ground_Lot', 'PARCEL_LOT_E243476_N263851_R1')).id, 'PARCEL_LOT_E243476_N263851');
  assert.equal(surfaceGroup(layer('Ground_Lot', 'PARCEL_LOT_E243476_N263851_R1')).kind, 'lot');
  assert.equal(surfaceGroup(layer('Ground_Asphalt', 'PARCEL_ASPHALT_ROAD_ZONE_12')).id, 'PARCEL_ASPHALT_ROAD_ZONE_12');
});

test('surfaceGroup: off-campus lots, aprons, walkways, gutters and tactile bands group by plan cell', () => {
  const a = surfaceGroup(layer('Ground_Lot', 'PARCEL_LOT_OFF_CAMPUS_LOT_0', 243071, 264531));
  const b = surfaceGroup(layer('Ground_Lot', 'PARCEL_LOT_OFF_CAMPUS_LOT_1', 243062, 264522));
  assert.equal(a.id, 'LOT_OFF_CAMPUS_E243000_N264450');
  assert.deepEqual(a, b);
  const apron = surfaceGroup(layer('Ground_Apron', 'PARCEL_PAVING_BUILDING_1', 243521, 263905));
  assert.deepEqual(apron, { id: 'APRON_E243520_N263840', kind: 'apron', name: 'Ground_Apron_APRON_E243520_N263840' });
  assert.equal(surfaceGroup(layer('Ground_Walkway', 'PARCEL_PAVING_EDGE_FB_1', 243521, 263905)).id, 'WALKWAY_E243520_N263840');
  assert.equal(surfaceGroup({ mesh: 'Ground_Gutter', rings: [square(243600, 263700)] }).id, 'GUTTER_E243600_N263680');
  assert.equal(surfaceGroup({ mesh: 'Ground_Tactile', tactile: true, rings: [square(243600, 263700)] }).kind, 'tactile');
});

test('surfaceGroup throws on a mesh class it has no rule for', () => {
  assert.throws(() => surfaceGroup(layer('Ground_Unknown', 'X')), /no node rule/);
});

test('markingGroup: road paint by its marking object, parking paint by its lot', () => {
  assert.deepEqual(markingGroup({ objectId: 'JA_b6/crossing', record: 'JA_b6/crossing', kind: 'zebra_bar' }), { id: 'JA_b6/crossing', parking: false });
  assert.deepEqual(markingGroup({ objectId: null, record: 'LOT_E243476_N263851/R1', id: 'LOT_E243476_N263851/R1/D0', kind: 'parking_line' }), { id: 'LOT_E243476_N263851', parking: true });
  assert.deepEqual(markingGroup({ record: 'LOT_E243476_N263851/R5/S0', kind: 'disabled_parking' }), { id: 'LOT_E243476_N263851', parking: true });
  assert.equal(markingGroup({ id: 'stall-0', kind: 'parking_line' }), null);
});

test('markingKind names the element by its pieces', () => {
  assert.equal(markingKind(['zebra_bar', 'zebra_bar'], false), 'crosswalk');
  assert.equal(markingKind(['arrow'], false), 'arrow');
  assert.equal(markingKind(['parking_line', 'disabled_parking'], true), 'parking');
  assert.equal(markingKind(['lane_line_dashed', 'lane_line_dashed', 'text'], false), 'lane_line_dashed');
});

test('emitGroundNode: base-centre pivot in the translation, local positions, TEXCOORD_1 and editable extras', () => {
  const glb = new GlbBuilder();
  const material = glb.addMaterial({ name: 'Ground_Pavers', extras: { polygonOffsetRank: 2 } });
  const positions = [10, 1, 20, 14, 1.5, 20, 14, 2, 26];
  const node = emitGroundNode(glb, {
    name: 'Ground_Pavers_P1', id: 'P1', kind: 'pavers', category: 'ground', collection: 'Ground/Surfaces/pavers',
    extras: { estimated: true },
    primitives: [{ positions, normals: [0, 1, 0, 0, 1, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 1, 1], uv1: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], indices: [0, 1, 2], material },
      { positions: [], normals: [], uvs: [], uv1: [], indices: [], material }],
  });
  const json = glb.json.nodes[node];
  assert.equal(json.name, 'Ground_Pavers_P1');
  assert.deepEqual(json.translation, [12, 1, 23]);
  assert.deepEqual(json.extras, { editable: { id: 'P1', kind: 'pavers', category: 'ground' }, estimated: true });
  const mesh = glb.json.meshes[json.mesh];
  assert.equal(mesh.name, 'Ground_Pavers_P1');
  assert.equal(mesh.primitives.length, 1);
  assert.equal(mesh.primitives[0].material, material);
  assert.deepEqual([...glb.readAccessor(mesh.primitives[0].attributes.POSITION)], [-2, 0, -3, 2, 0.5, -3, 2, 1, 3]);
  assert.deepEqual([...glb.readAccessor(mesh.primitives[0].attributes.TEXCOORD_1)].map((v) => Number(v.toFixed(6))), [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  assert.equal(glb.rootCollections.get(node), 'Ground/Surfaces/pavers');
});

test('emitGroundNode returns null and adds nothing when every primitive is empty', () => {
  const glb = new GlbBuilder();
  assert.equal(emitGroundNode(glb, { name: 'X', id: 'X', kind: 'k', category: 'ground', collection: 'c', primitives: [{ positions: [], normals: [], indices: [], material: 0 }] }), null);
  assert.equal(glb.json.nodes.length, 0);
});

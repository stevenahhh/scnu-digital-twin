import assert from "node:assert/strict";
import test from "node:test";
import { GlbBuilder } from "../lib/glb.mjs";
import { buildMarkings } from "./markings.mjs";
import { assertBuildInvariants, BuildInvariantError } from "../qa/invariants.mjs";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { MARKING_LIFT_M } from "../lib/groundNodes.mjs";
import { metres } from "../lib/frame.mjs";

// World-space triangles of every marking element node (Road_Markings_<id>: local float32 positions plus the node's
// translation, lib/groundNodes.mjs), in node order.
function emittedTriangles(glb) {
  const bytes = Buffer.concat(glb.chunks);
  const accessor = index => {
    const a = glb.json.accessors[index], v = glb.json.bufferViews[a.bufferView];
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const data = bytes.subarray(start, start + v.byteLength);
    return a.componentType === 5126
      ? Array.from({ length: data.length / 4 }, (_, i) => data.readFloatLE(i * 4))
      : Array.from({ length: a.count }, (_, i) => a.componentType === 5123 ? data.readUInt16LE(i * 2) : data.readUInt32LE(i * 4));
  };
  const actual = [];
  for (const node of glb.json.nodes.filter(n => n.name.startsWith("Road_Markings_"))) {
    const [tx, , tz] = node.translation;
    for (const primitive of glb.json.meshes[node.mesh].primitives) {
      const positions = accessor(primitive.attributes.POSITION), indices = accessor(primitive.indices);
      for (let i = 0; i < indices.length; i += 3) actual.push(indices.slice(i, i + 3).map(v => [positions[v * 3] + tx, positions[v * 3 + 2] + tz]));
    }
  }
  return actual;
}

test("paint lies MARKING_LIFT_M above the ground it is painted on, not flush with it", async () => {
  const glb = new GlbBuilder();
  await buildMarkings({
    glb, decimate: false, markings: { source: "test", pieces: [{
      id: "lifted", kind: "parking_line", colour: "white", estimated: true,
      rings: [[[200, -200], [204, -200], [204, -198], [200, -198]]],
    }] },
    baseOffset: () => 0.02,
    surface: { grid: { step: 20, x0: 0, z0: 0 }, height: () => 10, normal: () => [0, 1, 0] },
  });
  const node = glb.json.nodes.find(n => n.name === "Road_Markings_lifted");
  const accessor = glb.json.accessors[glb.json.meshes[node.mesh].primitives[0].attributes.POSITION];
  const expected = 10 + metres(0.02 + MARKING_LIFT_M);
  for (const y of [accessor.min[1], accessor.max[1]]) assert.ok(Math.abs(node.translation[1] + y - expected) < 1e-5, `${node.translation[1] + y} vs ${expected}`);
});

test("paint crossing a hump's outline is split along it, so no paint face spans the hump's raised edge", async () => {
  const glb = new GlbBuilder();
  const hump = [[201, -201], [203, -201], [203, -197], [201, -197]];
  const inside = ([x, z]) => x >= 201 - 1e-9 && x <= 203 + 1e-9 && z >= -201 - 1e-9 && z <= -197 + 1e-9;
  await buildMarkings({
    glb, decimate: false, splits: [hump], markings: { source: "test", pieces: [{
      id: "edge", kind: "edge_line", colour: "white", estimated: true,
      rings: [[[200, -199.2], [204, -199.2], [204, -198.8], [200, -198.8]]],
    }] },
    surface: { grid: { step: 20, x0: 0, z0: 0 }, height: () => 0, normal: () => [0, 1, 0] },
  });
  const faces = emittedTriangles(glb);
  assert.ok(faces.length > 2);
  for (const face of faces) {
    const centre = face.reduce((p, q) => [p[0] + q[0] / 3, p[1] + q[1] / 3], [0, 0]);
    assert.ok(face.every((p) => inside(p) || !inside(centre)), `face ${JSON.stringify(face)} spans the hump outline`);
  }
  const area = faces.reduce((sum, [a, b, c]) => sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2, 0);
  // float32 positions near x = 200 (ulp 1.5e-5): the split keeps the area up to that rounding
  assert.ok(Math.abs(area - 1.6) < 1e-4, `area ${area}`);
});

test("mesh inventory records emitted crossing parts, not excluded or out-of-extent plans", async () => {
  const ids = ["JA_1111111111111111", "JA_2222222222222222", "JA_3333333333333333"];
  const pieces = [200, 210, 10000].map((x, i) => ({
    ownerId: ids[i], objectId: `${ids[i]}/crossing`, partId: `${ids[i]}/crossing/0/part/0`,
    record: `${ids[i]}/crossing/0`, kind: "zebra_bar", colour: "white", estimated: true,
    rings: [[[x, -200], [x + 4, -200], [x + 4, -198], [x, -198]]],
  }));
  const glb = new GlbBuilder();
  const result = await buildMarkings({
    glb, markings: { pieces, source: "test", pieceReport: { roadObjects: pieces.map(p => p.objectId) } },
    decimate: false, exclusions: [[[[209, -201], [215, -201], [215, -197], [209, -197]]]],
    surface: { grid: { step: 20, x0: 0, z0: 0 }, height: () => 0, normal: () => [0, 1, 0] },
  });
  assert.deepEqual(result.roadEmission.parts.map(p => p.partId), [pieces[0].partId]);
  assert.equal(result.roadEmission.parts[0].emittedAreaScene, 8);
  assert.deepEqual(result.roadEmission.dropped.map(p => [p.partId, p.reason]), [
    [pieces[1].partId, "no-emitted-triangles"], [pieces[2].partId, "outside-extent"],
  ]);
  const report = glb.json.nodes.find(n => n.name === "Road_Markings").extras.report;
  assert.deepEqual(report.emittedRoadObjects, [pieces[0].objectId]);
  assert.deepEqual(report.roadObjects, pieces.map(p => p.objectId), "legacy planned inventory remains additive");
});

test("paint invariant receipt includes parking without road ownership and excludes clipped paint", async () => {
  const pieces = [200, 210].map((x, i) => ({
    id: `stall-${i}`, kind: "parking_line", colour: "white", estimated: true,
    rings: [[[x, -200], [x + 4, -200], [x + 4, -198], [x, -198]]],
  }));
  const result = await buildMarkings({
    glb: new GlbBuilder(), markings: { pieces, source: "test" }, decimate: false,
    exclusions: [[[[209, -201], [215, -201], [215, -197], [209, -197]]]],
    surface: { grid: { step: 20, x0: 0, z0: 0 }, height: () => 0, normal: () => [0, 1, 0] },
  });
  assert.deepEqual(result.paintEmission.map(p => p.id), ["stall-0"]);
  const area = result.paintEmission[0].triangles.reduce((sum, [a, b, c]) =>
    sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2, 0);
  assert.equal(area, 8);
});

for (const decimate of [false, true]) {
  test(`paint receipt matches final Float32 indexed topology (decimate=${decimate})`, async () => {
    const glb = new GlbBuilder();
    const result = await buildMarkings({
      glb, decimate, markings: { source: "test", pieces: [{
        id: "quantized-paint", kind: "parking_line", colour: "white", estimated: true,
        rings: [[[200.000001, -200.000003], [204.000002, -200.000003],
          [204.000002, -198.000001], [200.000001, -198.000001]]],
      }] },
      claim: triangle => {
        const centre = triangle.reduce((p, q) => [p[0] + q[0] / 3, p[1] + q[1] / 3], [0, 0]);
        return triangle.map((p, i) => [p, triangle[(i + 1) % 3], centre]);
      },
      surface: { grid: { step: 0.5, x0: 0, z0: 0 }, height: () => 0, normal: () => [0, 1, 0] },
    });
    assert.deepEqual(result.paintEmission, [{ id: "quantized-paint", triangles: emittedTriangles(glb) }]);
  });
}

// task-28-paint-diagnosis.json: actual pre-final coordinates, not invented epsilons.
for (const [id, ring, retained] of [
  ["LOT_E243922_N263696/R1/S10/aisle3", [[309.96721355814174, -166.0794910394401], [309.7524874183762, -166.130444771255], [309.75248738439507, -166.130444750307]], false],
  ["LOT_E244071_N263790/R2/S0/wheelchair3", [[402.01662999169736, -214.33469775180924], [402.0000000000078, -214.35242588701513], [402.00000127582484, -214.35242420434872]], true],
  ["LOT_E243821_N263586/R1/front", [[245.78475334862108, -87.78475334019933], [245.78475335149074, -87.78475335148545], [245.7678881054286, -87.76788810542837]], false],
]) {
  test(`receipt follows welded and quantized final face for ${id}`, async () => {
    const glb = new GlbBuilder();
    const pieces = [
      { id, rings: [ring] },
      { id: "control", rings: [[[200, -200], [204, -200], [204, -198], [200, -198]]] },
    ].map(p => ({ ...p, kind: "parking_line", colour: "white", estimated: true }));
    const result = await buildMarkings({
      glb, markings: { source: "test", pieces },
      surface: { grid: { step: 20, x0: 0, z0: 0 }, height: () => 0, normal: () => [0, 1, 0] },
    });
    assert.equal(result.paintEmission.some(p => p.id === id), retained);
    const key = triangle => JSON.stringify(triangle);
    assert.deepEqual(result.paintEmission.flatMap(p => p.triangles).map(key).sort(), emittedTriangles(glb).map(key).sort());
  });
}

test("final topology receipt still reports real paint on lawn by original id", async () => {
  const result = await buildMarkings({
    glb: new GlbBuilder(), markings: { source: "test", pieces: [{
      id: "lawn-paint", kind: "parking_line", colour: "white", estimated: true,
      rings: [[[200, -200], [204, -200], [204, -198], [200, -198]]],
    }] },
    surface: { grid: { step: 1, x0: 0, z0: 0 }, height: () => 0, normal: () => [0, 1, 0] },
  });
  const input = {
    groundFootprints: [], anchors: [], footprints: {}, evidenceRecords: [], packApplications: [],
    determinism: { id: "raw", firstHash: "same", secondHash: "same" },
    parcels: [{
      id: "lawn", ring: [[190, -210], [210, -210], [210, -190], [190, -190]].map(p => sceneToTm(...p)),
      holes: [], precedence: 1, paintAllowed: false,
    }],
    paintPieces: result.paintEmission.map(p => ({ ...p, triangles: p.triangles.map(t => t.map(q => sceneToTm(...q))) })),
  };
  assert.throws(() => assertBuildInvariants(input), error =>
    error instanceof BuildInvariantError && error.report.findings.some(f =>
      f.id === "lawn-paint" && f.reason.includes("lawn")));
});

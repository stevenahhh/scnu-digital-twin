import assert from "node:assert/strict";
import test from "node:test";
import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { roadMarkingPlan } from "./roadMarkings.mjs";
import { buildMarkings } from "./markings.mjs";
import { GlbBuilder } from "../lib/glb.mjs";
import { SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";
import { humpLayers } from "./surfaces.mjs";

const origin = [243800, 263800];
const context = {
  segments: [{ id: "RD_TEST", paths: [{ line: [origin, [243840, 263800]], lengthM: 40 }] }],
  nodes: ["ND_TEST"],
};
const evidence = { tier: "T1", refs: ["synthetic fixture"] };
const section = (patch = {}) => ({
  fromM: 0, toM: 40, lanes: [{ dir: "fwd", widthM: 3 }, { dir: "bwd", widthM: 4 }],
  centre: { type: "none", widthM: 0.15 }, edges: { left: "none", right: "none" },
  lateralOffsetM: 0, kerbOffsetsM: { left: 4, right: 3 },
  kerbNoParking: { left: false, right: false }, humps: [], evidence, estimated: true, ...patch,
});
const approach = (patch = {}) => ({
  segment: "RD_TEST", end: "to", stopLineSetbackM: null, crossing: null,
  arrows: [], text: [], humps: [], signalArms: [], yieldTriangles: [], guideLines: [],
  evidence, estimated: true, ...patch,
});
function plan(s, a = null, ctx = context) {
  return roadMarkingPlan({
    sections: { RD_TEST: { sections: Array.isArray(s) ? s : [s] } },
    junctions: a ? { ND_TEST: { approaches: [a] } } : {}, context: ctx,
  });
}
const local = (piece) => piece.rings[0].map(([x, z]) => {
  const [e, n] = sceneToTm(x, z);
  return [e - origin[0], n - origin[1]];
});
const bounds = (piece) => {
  const ring = local(piece);
  return [Math.min(...ring.map(p => p[0])), Math.max(...ring.map(p => p[0])),
    Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[1]))];
};
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("section dash phase starts at fromM and clips both ends without restarting at vertices", () => {
  const ctx = {
    ...context,
    segments: [{ id: "RD_TEST", paths: [{ line: [origin, [243805, 263800], [243840, 263800]], lengthM: 40 }] }],
  };
  const result = plan(section({
    fromM: 2, toM: 16, dashPhaseM: 1,
    centre: { type: "yellow_dashed", widthM: 0.15 },
  }), null, ctx);
  const intervals = result.pieces.map(p => bounds(p).slice(0, 2));
  assert.equal(intervals.length, 3);
  [[2, 4], [7, 10], [13, 16]].forEach((pair, i) => pair.forEach((v, j) => close(intervals[i][j], v)));
});

test("double centre lines keep a 0.15 m clear gap and the recorded lateral offset", () => {
  const result = plan(section({ lateralOffsetM: 0.4, centre: { type: "yellow_double", widthM: 0.15 } }));
  const ys = result.pieces.map(p => bounds(p).slice(2)).sort((a, b) => a[0] - b[0]);
  assert.equal(ys.length, 2);
  close(ys[0][0], 0.175);
  close(ys[0][1], 0.325);
  close(ys[1][0], 0.475);
  close(ys[1][1], 0.625);
});

test("offset curves retain the corner miter instead of narrowing at a bend", () => {
  const ctx = {
    ...context,
    segments: [{ id: "RD_TEST", paths: [{ line: [origin, [243820, 263800], [243820, 263820]], lengthM: 40 }] }],
  };
  const result = plan(section({ edges: { left: "white_solid", right: "none" } }), null, ctx);
  const ring = local(result.pieces[0]);
  assert.ok(ring.some(([e, n]) => Math.abs(e - 15.925) < 1e-7 && Math.abs(n - 4.075) < 1e-7));
});

test("stop lines span only approaching lanes at either end of an asymmetric road", () => {
  for (const [end, expected] of [
    ["to", [37.8, 38.2, -3, 0]],
    ["from", [1.8, 2.2, 0, 4]],
  ]) {
    const result = plan(section(), approach({ end, stopLineSetbackM: 2 }));
    assert.equal(result.pieces.length, 1);
    bounds(result.pieces[0]).forEach((v, i) => close(v, expected[i]));
  }
});

test("crossing bars stay inside the recorded rectangle at the requested period and width", () => {
  const result = plan(section(), approach({
    crossing: { widthM: 4.57, offsetM: 8, zebraPeriodM: 0.903, barWidthM: 0.5 },
  }));
  assert.equal(result.pieces.length, 8);
  const boxes = result.pieces.map(bounds).sort((a, b) => a[2] - b[2]);
  for (const box of boxes) {
    close(box[0], 29.715);
    close(box[1], 34.285);
    close(box[3] - box[2], 0.5);
    assert.ok(box[2] >= -3 && box[3] <= 4);
  }
  for (let i = 1; i < boxes.length; i += 1) close(boxes[i][2] - boxes[i - 1][2], 0.903);
});

test("arrows use the incoming lane and distance upstream of its stop line", () => {
  const result = plan(section(), approach({
    end: "from", stopLineSetbackM: 2, arrows: [{ type: "straight", lane: 1, atM: 8 }],
  }));
  const arrow = result.pieces.filter(p => p.kind === "arrow");
  const pts = arrow.flatMap(local);
  close(Math.min(...pts.map(p => p[0])), 7.5);
  close(Math.max(...pts.map(p => p[0])), 12.5);
  close((Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2, 2);
  assert.equal(arrow.length, 2);
  assert.ok(arrow.every(p => p.record === "ND_TEST/RD_TEST/0/from/arrows/0" && p.evidence.tier === "T1"));
});

test("hump records control height, footprint, bands and the near predicate", () => {
  const result = plan(section({ humps: [{ atM: 15, lengthM: 4, heightM: 0.12, bands: true }] }));
  const sample = (e, n) => result.heightAt(...tmToScene(origin[0] + e, origin[1] + n));
  close(sample(15, 0), 0.12);
  close(sample(16, 0), 0.09);
  close(sample(17, 0), 0);
  close(sample(15, 4.01), 0);
  assert.equal(result.humps.length, 1);
  close(result.humps[0].widthM, 7);
  const centre = tmToScene(origin[0] + 15, origin[1] + 0.5);
  assert.equal(result.heightAt.near(...centre, ...centre), true);
  const far = tmToScene(origin[0] + 30, origin[1] + 20);
  assert.equal(result.heightAt.near(...far, ...far), false);
  assert.equal(result.pieces.length, 9);
  assert.ok(result.pieces.every(p => p.kind === "speed_bump" && p.record === "RD_TEST/sections/0/humps/0"));
});

test("unrecorded paint is absent and separate sections restart their dash phase", () => {
  assert.deepEqual(plan(section()).pieces, []);
  const result = plan([
    section({ fromM: 0, toM: 10, centre: { type: "yellow_dashed", widthM: 0.15 } }),
    section({ fromM: 10, toM: 20, centre: { type: "yellow_dashed", widthM: 0.15 } }),
  ]);
  const intervals = result.pieces.map(p => bounds(p).slice(0, 2));
  assert.equal(intervals.length, 4);
  [[0, 3], [6, 9], [10, 13], [16, 19]].forEach((v, i) => v.forEach((n, j) => close(intervals[i][j], n)));
});

test("unknown line types and missing or outgoing glyph lanes fail with the record id", () => {
  assert.throws(() => plan(section({ centre: { type: "purple", widthM: 0.15 } })), /RD_TEST.*centre/);
  for (const lane of [0, 2]) {
    assert.throws(() => plan(section(), approach({
      end: "from", arrows: [{ type: "straight", lane, atM: 2 }],
    })), /ND_TEST.*lane/);
  }
});

test("lane records reject reversed direction order and a separator with no adjacent lane", () => {
  for (const lanes of [
    [{ dir: "bwd", widthM: 3 }, { dir: "fwd", widthM: 3 }],
    [{ dir: "fwd", widthM: 3, line: "white_dashed" }],
    [{ dir: "fwd", widthM: 3, line: "purple" }],
  ]) assert.throws(() => plan(section({ lanes })), /RD_TEST.*lane/i);
});

test("a junction cannot silently span a gap in section coverage", () => {
  assert.throws(() => plan(section({ fromM: 0, toM: 10 }), approach({ stopLineSetbackM: 2 })), /ND_TEST.*section/);
});

test("recorded same-direction lane separators use three metre dashes and five metre gaps", () => {
  const result = plan(section({
    toM: 20,
    lanes: [{ dir: "fwd", widthM: 3, line: "white_dashed" }, { dir: "fwd", widthM: 3 }],
  }));
  assert.equal(result.pieces.length, 3);
  [[0, 3], [8, 11], [16, 19]].forEach((pair, i) => {
    const box = bounds(result.pieces[i]);
    pair.forEach((v, j) => close(box[j], v));
    close(box[2], -0.0625);
    close(box[3], 0.0625);
  });
});

test("junction road text uses the recorded words and rejects unsupported characters", () => {
  const result = plan(section(), approach({ text: [{ text: "천천히", lane: 0, atM: 10 }] }));
  const text = result.pieces.filter(p => p.kind === "text");
  assert.ok(text.length > 0);
  for (const piece of text) {
    const [minX, maxX, minY, maxY] = bounds(piece);
    assert.ok(minX >= 27.5 && maxX <= 32.5 && minY >= -2.7 && maxY <= -0.3);
    assert.equal(piece.record, "ND_TEST/RD_TEST/0/to/text/0");
  }
  assert.throws(() => plan(section(), approach({ text: [{ text: "☃", lane: 0, atM: 10 }] })), /ND_TEST.*glyph/);
});

test("record geometry reaches the Road_Markings GLB mesh with hump elevation", async () => {
  const markings = plan(section({ humps: [{ atM: 15, lengthM: 4, heightM: 0.12, bands: true }] }));
  const glb = new GlbBuilder();
  await buildMarkings({
    glb, markings, extraHeight: markings.heightAt, decimate: false,
    surface: { grid: { step: 20, x0: 0, z0: 0 }, height: () => 10, normal: () => [0, 1, 0] },
  });
  const node = glb.json.nodes.find(n => n.name === "Road_Markings");
  assert.ok(node);
  const primitive = glb.json.meshes[node.mesh].primitives[0];
  const accessor = glb.json.accessors[primitive.attributes.POSITION];
  const bytes = Buffer.concat(glb.chunks);
  const view = glb.json.bufferViews[accessor.bufferView];
  let peak = 0;
  for (let i = 0; i < accessor.count; i += 1) {
    const offset = view.byteOffset + i * 12;
    const x = bytes.readFloatLE(offset), y = bytes.readFloatLE(offset + 4), z = bytes.readFloatLE(offset + 8);
    // The GLB stores float32: an across-road edge can round just outside the
    // footprint, where heightAt correctly returns zero. Test the independently
    // specified arc, not a second discontinuous containment test at that edge.
    const [e] = sceneToTm(x, z);
    const expected = 0.12 * Math.max(0, 1 - ((e - origin[0] - 15) / 2) ** 2);
    assert.ok(Math.abs(y - 10 - expected * SCENE_UNITS_PER_METRE) < 1e-5);
    peak = Math.max(peak, (y - 10) / SCENE_UNITS_PER_METRE);
  }
  assert.ok(peak > 0.119 && peak <= 0.12001);
  assert.equal(glb.json.materials[primitive.material].name, "Road_Marking");
});

test("hump ground layers use each record length rather than the legacy shared length", () => {
  const markings = plan(section({ humps: [{ atM: 15, lengthM: 4, heightM: 0.12, bands: false }] }));
  const layer = humpLayers(markings.humps, 3.6)[0];
  const [a, b] = layer.rings[0].map(p => tmToScene(...p));
  close(Math.hypot(...subPair(b, a)) / SCENE_UNITS_PER_METRE, 4);
  assert.equal(layer.source_ref, "hump RD_TEST/sections/0/humps/0");
});

const subPair = (a, b) => [a[0] - b[0], a[1] - b[1]];

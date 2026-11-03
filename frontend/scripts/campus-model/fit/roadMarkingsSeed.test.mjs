import assert from "node:assert/strict";
import test from "node:test";
import { tmToScene, sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { evidencePrimitives, seedRoadMarkings } from "./roadMarkingsSeed.mjs";
import { roadMarkingPlan } from "../stages/roadMarkings.mjs";
import { SCENE_UNITS_PER_METRE as U } from "../lib/frame.mjs";
import { validate } from "../lib/schemas.mjs";

const context = {
  segments: [{ id: "RD_TEST", paths: [{ line: [[243800, 263800], [243900, 263800]], lengthM: 100 }] }],
  nodes: ["ND_TEST"], junctionPoints: [{ id: "ND_TEST", point: [243900, 263800] }],
};
const origin = tmToScene(243820, 263802);
const forward = (() => {
  const p = tmToScene(243821, 263802);
  const dx = p[0] - origin[0], dz = p[1] - origin[1], d = Math.hypot(dx, dz);
  return [dx / d, dz / d];
})();
const primitive = (shape) => ({
  centre: origin, forward, shape, kind: "centre_line_yellow", colour: "yellow",
  refs: ["synthetic accepted paint"], legacyId: "MK_TEST",
});

test("seed stores a road-local station and produces its stroke with recorded width", () => {
  const docs = seedRoadMarkings([primitive({ type: "stroke", path: [[0, -3], [0, 3]], widthM: 0.2 })], [], context);
  const detail = docs.sections.RD_TEST.sections[0].details[0];
  assert.ok(Math.abs(detail.atM - 20) < 1e-8);
  assert.ok(Math.abs(detail.lateralOffsetM - 2) < 1e-8);
  const result = roadMarkingPlan({ ...docs, context });
  assert.equal(result.pieces.length, 1);
  assert.equal(result.pieces[0].record, detail.id);
  assert.equal(result.pieces[0].id, "MK_TEST");
  const ring = result.pieces[0].rings[0];
  assert.ok(Math.abs(Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]) / U - 6) < 1e-8);
  assert.ok(Math.abs(Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]) / U - 0.2) < 1e-8);
});

test("moving the network moves seeded paint rather than replaying absolute polygons", () => {
  const docs = seedRoadMarkings([primitive({ type: "rectangle", lengthM: 6, widthM: 0.2 })], [], context);
  const moved = { ...context, segments: [{ id: "RD_TEST", paths: [{
    line: [[243800, 263807], [243900, 263807]], lengthM: 100,
  }] }] };
  const result = roadMarkingPlan({ ...docs, context: moved });
  const points = result.pieces[0].rings[0].map(([x, z]) => sceneToTm(x, z));
  const centre = points.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
  assert.ok(Math.abs(centre[0] - 243820) < 1e-8);
  assert.ok(Math.abs(centre[1] - 263809) < 1e-8);
});

test("crossings are records with a bar count and only their explicitly kept slots are drawn", () => {
  const docs = seedRoadMarkings([{
    ...primitive({ type: "crossing", lengthM: 4.57, widthM: 0.5, periodM: 0.903, count: 5, slots: [0, 1, 3, 4] }),
    kind: "zebra_bar", colour: "white",
  }], [], context);
  assert.equal(docs.junctions.ND_TEST.approaches[0].details.length, 1);
  const result = roadMarkingPlan({ ...docs, context });
  assert.equal(result.pieces.length, 4);
  assert.ok(result.pieces.every(p => p.kind === "zebra_bar" && p.estimated));
  docs.junctions.ND_TEST.approaches[0].details = [];
  assert.equal(roadMarkingPlan({ ...docs, context }).pieces.length, 0);
});

test("missing road references and unknown primitive types name the offending record", () => {
  const docs = seedRoadMarkings([primitive({ type: "rectangle", lengthM: 6, widthM: 0.2 })], [], context);
  const detail = docs.sections.RD_TEST.sections[0].details[0];
  detail.shape.type = "unknown";
  assert.throws(() => roadMarkingPlan({ ...docs, context }), /RD_TEST.*unknown/);
});

test("evidence rectangles become dimensions, and shared glyph constructions become one record", () => {
  const rectangle = { kind: "hatch", colour: "white", id: "MK_RECT",
    rings: [[[0, 0], [4 * U, 0], [4 * U, U], [0, U]]] };
  const construction = { centre: [2 * U, U], forward: [1, 0],
    shape: { type: "glyph", template: "arrow", args: ["arrow_straight", 5, 1], centered: true }, refs: ["MK_ARROW"] };
  const glyph = { kind: "arrow", colour: "white", construction };
  const records = evidencePrimitives([rectangle, glyph, glyph]);
  assert.equal(records.length, 2);
  assert.equal(records[0].shape.type, "rectangle");
  assert.equal(records[0].shape.lengthM, 4);
  assert.equal(records[0].shape.widthM, 1);
  assert.equal(records[1].shape.template, "arrow");
  assert.throws(() => evidencePrimitives([{ ...rectangle, kind: "text" }]), /text.*construction/);
});

test("published road schema rejects unknown detail primitives and out-of-path anchors by record id", () => {
  for (const mutate of [
    d => { d.shape.type = "unknown"; },
    d => { d.atM = 101; },
    d => { d.shape.widthM = -1; },
  ]) {
    const docs = seedRoadMarkings([primitive({ type: "rectangle", lengthM: 6, widthM: 0.2 })], [], context);
    const d = docs.sections.RD_TEST.sections[0].details[0];
    mutate(d);
    const result = validate("roadSections", docs.sections, context);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes(d.id)));
  }
});

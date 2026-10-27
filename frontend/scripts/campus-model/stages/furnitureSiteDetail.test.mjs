// Checks for the VR site-detail builders of stages/furniture.mjs (hedges and shrub masses, car-park stall rows) on flat
// ground.
import assert from "node:assert/strict";
import test from "node:test";
import { metres } from "../lib/frame.mjs";
import { B, makeContext, stallRow } from "./furniture.mjs";

const M = metres;
const sites = { inArea: () => false, labelAt: () => null, classes: { PAVING: 1, ASPHALT: 2 } };
const flatContext = () => makeContext({ groundAt: () => 0, objects: [], roads: { arterials: [], connectors: [], zoneRings: [] }, sites, fieldCentre: null });
const line = (lengthM) => [[0, 0], [M(lengthM), 0]];
function build(kind, geometry, p) {
  const ctx = flatContext();
  B[kind](ctx, { id: "SD-T1", kind, surveyKind: kind, heightM: 0, ...geometry, p });
  return ctx;
}
const ys = (ctx) => ctx.solid.mesh.positions.filter((_, i) => i % 3 === 1).map((y) => y / M(1));
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);

test("stall row: one stall per 2.5 m, dividers on the chosen side or bearing, wheel stops 0.9 m in from the back", () => {
  const row = stallRow(line(25), { side: "left" });
  assert.equal(row.n, 10);
  assert.equal(row.dividers.length, 11);
  near(row.dividers[0][1][1] / M(1), -5, "left of an eastward line is north (-z)");
  near(stallRow(line(25), { side: "right" }).dividers[0][1][1] / M(1), 5, "right is south");
  near(stallRow(line(25), { bearingDeg: 180, depthM: 4 }).dividers[0][1][1] / M(1), 4, "a bearing of 180 runs south");
  near(row.stops[0].centre[1] / M(1), -4.1, "stop");
  assert.equal(stallRow(line(25), { stalls: 9 }).n, 9);
  near(Math.max(...ys(build("stall_row", { line: line(25) }, { side: "left" }))), 0.045, "paint lies just over the ground");
  near(Math.max(...ys(build("stall_row", { line: line(25) }, { side: "left", wheel_stops: true }))), 0.12, "wheel stop top");
  const stopsOnly = build("stall_row", { line: line(25) }, { side: "left", dividers: false, wheel_stops: true });
  assert.equal(Math.min(...ys(stopsOnly)), -0.03, "without dividers only the wheel stops are drawn");
});

test("hedges and shrub masses reach their height", () => {
  near(Math.max(...ys(build("hedge", { line: line(6) }, { height_m: 1.2 }))), 1.2, "hedge");
  near(Math.max(...ys(build("hedge", { point: [0, 0] }, { radius_m: 0.7, height_m: 0.9 }))), 0.9, "round shrub");
  const ring = [[0, 0], [M(3), 0], [M(3), M(2)], [0, M(2)]];
  near(Math.max(...ys(build("hedge", { ring }, {}))), 1.0, "clipped mass, default height");
});

// Checks for the small landscape builders of stages/furniture.mjs (bench rows, low walls, planters, garden walls,
// signboards) and the rest-space duplicate rule, on flat ground.
import assert from "node:assert/strict";
import test from "node:test";
import { metres } from "../lib/frame.mjs";
import { B, duplicatesOf, makeContext } from "./furniture.mjs";

const M = metres;
const sites = { inArea: () => false, labelAt: () => null, classes: { PAVING: 1, ASPHALT: 2 } };
const flatContext = () => makeContext({ groundAt: () => 0, objects: [], roads: { arterials: [], connectors: [], zoneRings: [] }, sites, fieldCentre: null });
const line = (lengthM) => [[0, 0], [M(lengthM), 0]];
function build(kind, geometry, p) {
  const ctx = flatContext();
  const result = B[kind](ctx, { id: "T1", kind, surveyKind: kind, ...geometry, p });
  return { ctx, result };
}
const maxHeightM = (ctx) => Math.max(...ctx.solid.mesh.positions.filter((_, i) => i % 3 === 1)) / M(1);

test("bench rows: one bench every spacing_m; survey benches keep their own count", () => {
  assert.equal(build("bench", { line: line(10) }, { dims: {}, spacing_m: 2.5 }).result.benches, 5);
  assert.equal(build("bench", { line: line(10) }, { dims: { lengthM: 2.4 }, spacing_m: 3, style: "box" }).result.benches, 4);
  assert.equal(build("bench", { line: line(10) }, {}).result.benches, Math.round(10 / 2.4));
});

test("low walls, planters and garden walls take catalogue heights", () => {
  near(maxHeightM(build("low_wall", { line: line(6) }, { dims: { heightM: 0.8 }, colour: "brick" }).ctx), 0.8, "low wall");
  const square = [[0, 0], [M(2), 0], [M(2), M(2)], [0, M(2)]];
  near(maxHeightM(build("planter", { ring: square }, { dims: { kerbHeightM: 0.15 }, fill: "gravel" }).ctx), 0.15, "planter kerb");
  assert.throws(() => build("planter", { ring: square }, { dims: {}, fill: "moss" }), /fill moss is not lawn, soil, gravel or shrub/);
  const walled = maxHeightM(build("garden_wall", { line: line(8) }, { dims: { heightM: 0.9 }, lattice_m: 0.9, colour: "#e6e2da" }).ctx);
  assert.ok(walled >= 1.8 && walled <= 1.85, `wall + lattice top ${walled} (the lattice top rail sits on 1.8 m)`);
  near(maxHeightM(build("garden_wall", { line: line(8) }, { dims: { heightM: 1.2 } }).ctx), 1.2, "wall without lattice");
  assert.throws(() => build("garden_wall", { point: [0, 0] }, { dims: {} }), /garden_wall T1 needs a LineString/);
  assert.throws(() => build("garden_wall", { line: line(8) }, { dims: { heightM: 2.5 } }), /garden_wall\.heightM 2\.5 lies outside the catalogue range 0\.9-1\.8/);
});

test("signboard: legs and panel up to clearance + panel; the hood just above", () => {
  near(maxHeightM(build("signboard", { point: [0, 0] }, { width_m: 2, panel_m: 1.2, clearance_m: 0.6 }).ctx), 0.6 + 1.2 + 0.05, "board");
  near(maxHeightM(build("signboard", { point: [0, 0] }, { panel_m: 1.2, clearance_m: 0.6, hood: true }).ctx), 0.6 + 1.2 + 0.2, "board with hood");
});

test("duplicate rule: a planted lamp 2 m from a surveyed lamp is caught, 4 m away is not; roofed kinds are one class", () => {
  const surveyLamp = { id: "OB-LAMP", kind: "street_lamp", point: [0, 0] };
  const gazebo = { id: "OC-GAZEBO", kind: "gazebo", ring: [[0, 0], [M(4), 0], [M(4), M(4)], [0, M(4)]] };
  const near2 = { id: "RS-L1", kind: "street_lamp", point: [M(2), 0] };
  const far4 = { id: "RS-L2", kind: "street_lamp", point: [M(4), 0] };
  const pavilion = { id: "RS-P1", kind: "pavilion_hip", point: [M(5), M(2)] };
  const bench = { id: "RS-B1", kind: "bench", line: [[M(1), M(1)], [M(2), M(1)]] };
  const found = duplicatesOf([near2, far4, pavilion, bench], [surveyLamp, gazebo]);
  assert.deepEqual(found.map(({ id, other }) => `${id}~${other}`), ["RS-L1~OB-LAMP", "RS-P1~OC-GAZEBO"]);
  assert.equal(found[0].distanceM, 2);
});

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
}

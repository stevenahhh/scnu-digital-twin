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

test("terraced_steps: the flights rise by their own risers from the bottom edge, whatever the edge order", () => {
  const flights = [{ steps: 4, rise_m: 0.15, tread_m: 0.35, landing_m: 2 }, { steps: 3, rise_m: 0.16, tread_m: 0.3, landing_m: 1 }];
  const edge = [[0, 0], [0, M(6)]];
  const { ctx } = build("terraced_steps", { line: edge }, { up_bearing_deg: 270, colour: "#b0b0b0", flights });
  near(maxHeightM(ctx), 4 * 0.15 + 3 * 0.16, "top landing");
  const xs = ctx.solid.mesh.positions.filter((_, i) => i % 3 === 0);
  // bearing 270 climbs west (-x): every solid lies on that side of the edge, 4 x 0.35 + 2 + 3 x 0.3 + 1 m deep
  near(Math.max(...xs) / M(1), 0, "bottom edge");
  near(Math.min(...xs) / M(1), -(4 * 0.35 + 2 + 3 * 0.3 + 1), "depth");
  const reversed = build("terraced_steps", { line: [...edge].reverse() }, { up_bearing_deg: 270, colour: "#b0b0b0", flights }).ctx;
  near(Math.min(...reversed.solid.mesh.positions.filter((_, i) => i % 3 === 0)) / M(1), -(4 * 0.35 + 2 + 3 * 0.3 + 1), "reversed edge");
  // a landing that runs back to the ground ends at 0.02 m above it
  const ramp = build("terraced_steps", { line: edge }, { up_bearing_deg: 270, colour: "#b0b0b0", flights: [{ steps: 4, rise_m: 0.15, tread_m: 0.35, landing_m: 10, landing_to_ground: true }] }).ctx;
  const pos = ramp.solid.mesh.positions;
  const farTops = [];
  for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i] / M(1) + 11.4) < 1e-6 && pos[i + 1] > 0) farTops.push(pos[i + 1] / M(1));
  near(Math.max(...farTops), 0.02, "forecourt end");
});

test("pond_basin: coping to its height, jets above it", () => {
  const ring = [[0, 0], [M(10), 0], [M(10), M(6)], [0, M(6)]];
  const { ctx } = build("pond_basin", { ring }, { coping: { thicknessM: 0.4, heightM: 0.45 }, copingColour: "#c9c3b6", jets: [[127.48, 34.968, 1.6]] });
  near(maxHeightM(ctx), 0.45, "coping");
  near(Math.max(...ctx.glass.mesh.positions.filter((_, i) => i % 3 === 1)) / M(1), 1.6, "jet");
});

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
}

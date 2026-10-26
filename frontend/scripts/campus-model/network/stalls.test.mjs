import assert from "node:assert/strict";
import test from "node:test";

import { SCENE_UNITS_PER_METRE, modelToGeo } from "../lib/frame.mjs";
import { HUMP_HEIGHT_M, buildHumps, buildStalls, humpProfile } from "./stalls.mjs";

const U = SCENE_UNITS_PER_METRE;
// A divider: 5 m long along +z, 0.12 m wide, at x (model units).
const divider = (x, z0 = -200) => ({ rings: [[[x - 0.06 * U / 2, z0], [x + 0.06 * U / 2, z0], [x + 0.06 * U / 2, z0 + 5 * U], [x - 0.06 * U / 2, z0 + 5 * U]]] });
const lot = (id, x0, x1) => ({ id, ring: [[x0, -205], [x1, -205], [x1, -190], [x0, -190]] });

test("a row of 5 stalls with the 3rd divider missing gets exactly one estimated divider at the neighbours' pitch", () => {
  // dividers every 2.5 m: 6 lines bound 5 stalls; the one between stalls 2 and 3 is missing
  const xs = [0, 1, 2, 4, 5].map((k) => 100 + k * 2.5 * U);
  const { pieces, rows } = buildStalls({ lots: [lot("way/1", 95, 125)], markingsParkingLines: xs.map((x) => divider(x)), log: () => {} });
  assert.equal(pieces.length, 1);
  assert.ok(Math.abs(pieces[0].centre[0] - (100 + 3 * 2.5 * U)) < 1e-6, "at the pitch");
  assert.equal(pieces[0].estimated, true);
  assert.deepEqual(rows.map((r) => [r.pitchM, r.bay, r.filled]), [[2.5, "general", 1]]);
});

test("a lot with no detected stall paint gets no pieces and a log line", () => {
  const lines = [];
  const { pieces } = buildStalls({ lots: [lot("way/2", 300, 320)], markingsParkingLines: [], log: (m) => lines.push(m) });
  assert.equal(pieces.length, 0);
  assert.deepEqual(lines, ["lot way/2: no stall paint detected, left unmarked"]);
});

test("the hump profile peaks at 0.10 m at s = 0 and is 0 at |s| = 1.8 m", () => {
  assert.equal(humpProfile(0), HUMP_HEIGHT_M);
  assert.equal(humpProfile(1.8), 0);
  assert.equal(humpProfile(-1.8), 0);
  assert.ok(Math.abs(humpProfile(0.9) - 0.075) < 1e-12);
});

test("a speed bump off every road polygon is skipped and logged", () => {
  const ring = [[200, -200], [200 + 6 * U, -200], [200 + 6 * U, -200 + 3.6 * U], [200, -200 + 3.6 * U], [200, -200]].map(([x, z]) => modelToGeo(x, z));
  const feature = { properties: { id: "MX_T", kind: "speed_bump", area_m2: 21.6 }, geometry: { type: "Polygon", coordinates: [ring] } };
  const lines = [];
  const off = buildHumps({ features: [feature], onRoad: () => false, log: (m) => lines.push(m) });
  assert.equal(off.humps.length, 0);
  assert.deepEqual(lines, ["hump MX_T skipped (off road)"]);
  const on = buildHumps({ features: [feature], onRoad: () => true, log: () => {} });
  assert.equal(on.humps.length, 1);
  assert.ok(Math.abs(on.humps[0].widthM - 6) < 1e-6, "across the outline's long side (the road width)");
  assert.ok(Math.abs(on.heightAt(200 + 3 * U, -200 + 1.8 * U) - HUMP_HEIGHT_M) < 1e-9, "peak at the centre");
});

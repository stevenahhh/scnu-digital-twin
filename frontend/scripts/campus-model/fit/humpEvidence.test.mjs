import assert from "node:assert/strict";
import test from "node:test";

import { SCENE_UNITS_PER_METRE, modelToGeo } from "../lib/frame.mjs";
import { HUMP_HEIGHT_M, buildHumps, humpProfile } from "./humpEvidence.mjs";

const U = SCENE_UNITS_PER_METRE;
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

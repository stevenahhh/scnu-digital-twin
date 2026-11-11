import assert from "node:assert/strict";
import test from "node:test";

import { SCENE_UNITS_PER_METRE, modelToGeo } from "../lib/frame.mjs";
import { humpBands } from "../stages/roadMarkings.mjs";
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

test("a striped hump takes its frame, painted rectangle and band lean from its bands, not from a loose outline", () => {
  // bands of a 3.1 x 7.2 m hump turned 25 degrees in the model, 0.45 m pitch leaning 14 degrees left of travel
  const centre = [180, -240], a = (25 * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
  const truth = { lengthM: 3.1, widthM: 7.2, bandWidthM: 0.45, angleDeg: 14, offsetM: 0.17 };
  // local [s, t]: s metres along travel, t metres to its left (the model's v points right of travel)
  const toModel = ([s, t]) => [centre[0] + (u[0] * s - v[0] * t) * U, centre[1] + (u[1] * s - v[1] * t) * U];
  const geo = (ring) => [...ring, ring[0]].map((p) => modelToGeo(...toModel(p)));
  const features = humpBands(truth).map(({ index, ring }, k) => ({
    properties: { id: `MX_B${k}`, kind: "speed_bump", colour: Math.abs(index) % 2 ? "white" : "yellow", group: "hump MX_H", area_m2: 1.4 },
    geometry: { type: "Polygon", coordinates: [geo(ring)] },
  }));
  // the loose outline: an axis-aligned box well beyond the bands
  const box = [[-260, -260], [-260, 260], [260, 260], [260, -260]].map(([x, z]) => modelToGeo(centre[0] + x / 100 * U * 3, centre[1] + z / 100 * U * 3));
  features.push({ properties: { id: "MX_H", kind: "speed_bump", colour: "yellow", area_m2: 60 }, geometry: { type: "Polygon", coordinates: [[...box, box[0]]] } });
  const [hump] = buildHumps({ features, onRoad: () => true, log: () => {} }).humps;
  assert.ok(Math.hypot(hump.centre[0] - centre[0], hump.centre[1] - centre[1]) / U < 0.01, "centre of the painted rectangle");
  assert.ok(Math.abs(Math.abs(hump.u[0] * u[0] + hump.u[1] * u[1]) - 1) < 1e-6, "travel across the band stack");
  assert.ok(Math.abs(hump.widthM - 7.2) < 0.01 && Math.abs(hump.lengthM - 3.1) < 0.01, `${hump.widthM} x ${hump.lengthM}`);
  assert.ok(Math.abs(hump.bandWidthM - 0.45) < 0.005, `pitch ${hump.bandWidthM}`);
  const hv = [-hump.u[1], hump.u[0]];
  const lean = Math.atan2(-(hump.stripe[0] * hv[0] + hump.stripe[1] * hv[1]), hump.stripe[0] * hump.u[0] + hump.stripe[1] * hump.u[1]) * 180 / Math.PI;
  assert.ok(Math.abs(lean - 14) < 0.2, `lean ${lean}`);
  // the measured pitch, phase and first colour paint every point of the hump as the photo's bands do
  const colourAt = (p, frame, params, start) => {
    const d = [(p[0] - frame.centre[0]) / U, (p[1] - frame.centre[1]) / U];
    const s = d[0] * frame.u[0] + d[1] * frame.u[1], t = -(d[0] * frame.v[0] + d[1] * frame.v[1]);
    const k = Math.tan((params.angleDeg * Math.PI) / 180), x = (t - s * k + params.widthM / 2 - params.offsetM) / params.bandWidthM;
    return { colour: Math.abs(Math.floor(x)) % 2 ? (start === "yellow" ? "white" : "yellow") : start, edge: Math.abs(x - Math.round(x)) * params.bandWidthM };
  };
  const measured = { lengthM: hump.lengthM, widthM: hump.widthM, bandWidthM: hump.bandWidthM, angleDeg: lean, offsetM: hump.bandOffsetM };
  let compared = 0;
  for (let s = -1.4; s <= 1.4; s += 0.35) for (let t = -3.4; t <= 3.4; t += 0.13) {
    const p = toModel([s, t]);
    const want = colourAt(p, { centre, u, v }, truth, "yellow"), got = colourAt(p, { centre: hump.centre, u: hump.u, v: hv }, measured, hump.bandStartColour);
    if (want.edge < 0.05 || got.edge < 0.05) continue;
    assert.equal(got.colour, want.colour, `colour at s ${s.toFixed(2)} t ${t.toFixed(2)}`);
    compared += 1;
  }
  assert.ok(compared > 100);
});

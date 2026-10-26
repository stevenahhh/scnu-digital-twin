import assert from "node:assert/strict";
import test from "node:test";

import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";
import { pointInRing } from "../lib/geometry.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";
import { planKerbs } from "./kerbs.mjs";
import { GUIDANCE_M, TACTILE_BAND_M, planTactile } from "./tactile.mjs";

const U = SCENE_UNITS_PER_METRE;
const tm = (ring) => ring.map(([x, z]) => sceneToTm(x, z));
const RING = [[100, -200], [120, -200], [120, -190], [100, -190]];
const plan = planKerbs({
  walkways: [[tm(RING)]],
  outlines: [{ ufid: "A003-T", closed: true, line: tm([...RING, RING[0]]) }],
  crossings: [{ id: "CW_T01", ring: tm([[108, -206], [112, -206], [112, -200.3], [108, -200.3]]) }],
  labelAt: () => SURFACE_CLASS.ASPHALT,
  terrainAt: () => 12,
  warn: () => {},
});
const { layers, bands, dropped } = planTactile(plan, { warn: () => {} });
const model = (layer) => layer.rings[0].map(([E, N]) => tmToScene(E, N));
const uvOf = (layer, [x, z]) => {
  const { origin, u, v, sizeM } = layer.uvFrame;
  const d = [x - origin[0], z - origin[1]];
  return [(d[0] * u[0] + d[1] * u[1]) / (sizeM * U), (d[0] * v[0] + d[1] * v[1]) / (sizeM * U)];
};

test("one dropped kerb gives one 0.30 m band across the crossing width and one 1.2 m guidance strip", () => {
  assert.equal(dropped, 1);
  assert.equal(bands, 1);
  assert.equal(layers.length, 2);
  const [band, guidance] = layers;
  assert.ok(Math.abs(band.widthM - 4 / U) < 1e-6, `band width ${band.widthM} m vs the 4-unit crossing`);
  const corners = model(band);
  const depth = Math.min(...corners.map(([, z]) => z)) - -200;
  assert.ok(Math.abs(depth / U - 1.8) < 1e-6, "band starts at the top of the 1.8 m ramp");
  const zs = corners.map(([, z]) => z);
  assert.ok(Math.abs((Math.max(...zs) - Math.min(...zs)) / U - TACTILE_BAND_M) < 1e-6, "band is 0.30 m deep");
  assert.ok(Math.abs(guidance.lengthM - GUIDANCE_M) < 1e-12);
});

test("band and guidance strip lie inside the walkway polygon", () => {
  for (const layer of layers) for (const p of model(layer)) assert.ok(pointInRing(p, RING), `${layer.source_ref} corner ${p} outside`);
});

test("UV u spans exactly 1.0 per 0.30 m along the band (and along the guidance strip)", () => {
  const [band, guidance] = layers;
  const corners = model(band);
  const us = corners.map((p) => uvOf(band, p)[0]);
  assert.ok(Math.abs(Math.max(...us) - Math.min(...us) - band.widthM / 0.3) < 1e-6);
  const gs = model(guidance).map((p) => uvOf(guidance, p)[0]);
  assert.ok(Math.abs(Math.max(...gs) - Math.min(...gs) - GUIDANCE_M / 0.3) < 1e-6);
});

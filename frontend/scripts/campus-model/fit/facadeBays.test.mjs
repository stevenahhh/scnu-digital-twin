import assert from "node:assert/strict";
import test from "node:test";
import { estimateFacadeBays } from "./facadeBays.mjs";

test("unrolled column autocorrelation recovers six 3 metre bays and the row rhythm", () => {
  const width = 80, height = 48;
  const pixels = new Uint8Array(width * height * 3).fill(180);
  for (let y = 8; y < 44; y++) for (let x = 4; x < 76; x++) {
    if ((x - 4) % 12 >= 3 && (x - 4) % 12 < 9 && y % 16 >= 4 && y % 16 < 12) pixels.fill(40, (y * width + x) * 3, (y * width + x) * 3 + 3);
  }
  const fit = estimateFacadeBays({ pixels, width, height, metresPerPixel: 0.25, storeys: 3, minPitchM: 2, maxPitchM: 5 });
  assert.equal(fit.bays.count, 6);
  assert.equal(fit.bays.pitchM, 3);
  assert.equal(fit.bays.offsetM, 1);
  assert.deepEqual(fit.storeys.map(s => s.hM), [4, 4, 4]);
  assert.equal(fit.estimated, true);
});

test("flat, undersampled and malformed images cannot invent a facade rhythm", () => {
  assert.throws(() => estimateFacadeBays({ pixels: new Uint8Array(60 * 40 * 3).fill(120), width: 60, height: 40, metresPerPixel: 0.25, storeys: 2 }), /contrast|rhythm/);
  assert.throws(() => estimateFacadeBays({ pixels: new Uint8Array(3), width: 60, height: 40, metresPerPixel: 0.25, storeys: 2 }), /pixels/);
});

test("reflections splitting each window do not double the structural bay count", () => {
  const width = 80, height = 32;
  const pixels = new Uint8Array(width * height * 3).fill(180);
  for (let y = 4; y < 28; y++) for (let x = 4; x < 76; x++) {
    const phase = (x - 4) % 12;
    if ((phase >= 3 && phase < 5) || (phase >= 7 && phase < 9)) pixels.fill(40, (y * width + x) * 3, (y * width + x) * 3 + 3);
  }
  const fit = estimateFacadeBays({ pixels, width, height, metresPerPixel: 0.25, storeys: 2, minPitchM: 2, maxPitchM: 5 });
  assert.equal(fit.bays.count, 6);
  assert.equal(fit.bays.pitchM, 3);
  assert.ok(Math.abs(fit.bays.offsetM - 1) < 1e-9);
});

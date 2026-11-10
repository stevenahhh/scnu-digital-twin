import assert from 'node:assert/strict';
import test from 'node:test';

import { fitLean, leanRecord } from './buildingLean.mjs';

// Synthetic grey window: 0.25 m pixels, origin (1000, 2000) top-left. A bright box roof (value 200) on dark ground
// (60), drawn with 4 x 4 supersampling and a 1-2-1 blur so edges are anti-aliased like the photo.
const WIN = { w: 160, h: 160, origin: [1000, 2000], gsdM: 0.25 };
function render(boxes, { ground = 60, roof = 200 } = {}) {
  const raw = new Float32Array(WIN.w * WIN.h).fill(ground);
  for (let j = 0; j < WIN.h; j += 1) {
    for (let i = 0; i < WIN.w; i += 1) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const E = WIN.origin[0] + (i + (sx + 0.5) / 4) * WIN.gsdM;
          const N = WIN.origin[1] - (j + (sy + 0.5) / 4) * WIN.gsdM;
          if (boxes.some(([e0, n0, e1, n1]) => E >= e0 && E < e1 && N >= n0 && N < n1)) hits += 1;
        }
      }
      raw[j * WIN.w + i] = ground + ((roof - ground) * hits) / 16;
    }
  }
  const out = new Float32Array(raw.length);
  for (let j = 0; j < WIN.h; j += 1) {
    for (let i = 0; i < WIN.w; i += 1) {
      let s = 0;
      let wsum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = Math.min(WIN.w - 1, Math.max(0, i + dx));
          const y = Math.min(WIN.h - 1, Math.max(0, j + dy));
          const k = (2 - Math.abs(dx)) * (2 - Math.abs(dy));
          s += k * raw[y * WIN.w + x];
          wsum += k;
        }
      }
      out[j * WIN.w + i] = s / wsum;
    }
  }
  return out;
}
const FOOT = [[1010, 1970], [1022, 1970], [1022, 1982], [1010, 1982]];

test('a leaned box recovers its lean within 0.005 m/m', () => {
  for (const lean of [[0.031, -0.087], [-0.044, 0.012], [0.0, 0.0]]) {
    const h = 24;
    const d = [lean[0] * h, lean[1] * h];
    const grey = render([[1010 + d[0], 1970 + d[1], 1022 + d[0], 1982 + d[1]]]);
    const fit = fitLean(grey, WIN, { masses: [{ ring: FOOT, topM: h }], prior: [0.0, -0.05] });
    assert.equal(fit.method, 'roof-edge');
    assert.equal(fit.estimated, false);
    assert.ok(Math.abs(fit.lean[0] - lean[0]) < 0.005 && Math.abs(fit.lean[1] - lean[1]) < 0.005, `${lean} -> ${fit.lean}`);
    assert.ok(fit.residual_m < 0.25, `residual ${fit.residual_m}`);
  }
});

test('no visible roof edge falls back to the prior, marked estimated', () => {
  const flat = new Float32Array(WIN.w * WIN.h).fill(90);
  const fit = fitLean(flat, WIN, { masses: [{ ring: FOOT, topM: 24 }], prior: [0.01, -0.05] });
  assert.equal(fit.method, 'prior');
  assert.equal(fit.estimated, true);
  assert.deepEqual(fit.lean, [0.01, -0.05]);
  assert.equal(fit.residual_m, null);
});

test('a roof the same grey as the ground (edges elsewhere only) is not fitted from noise', () => {
  const grey = render([[1030, 1985, 1036, 1991]]); // an unrelated box outside the search reach
  const fit = fitLean(grey, WIN, { masses: [{ ring: FOOT, topM: 24 }], prior: [0.0, 0.0] });
  assert.equal(fit.method, 'prior');
  assert.equal(fit.estimated, true);
});

test('leanRecord rounds and keeps the documented fields', () => {
  const r = leanRecord('BLD_X', { lean: [0.0123456, -0.1], residual_m: 0.123456, method: 'roof-edge', estimated: false });
  assert.deepEqual(r, { id: 'BLD_X', lean: [0.0123, -0.1], residual_m: 0.123, method: 'roof-edge', estimated: false });
});

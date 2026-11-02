import assert from 'node:assert/strict';
import test from 'node:test';

import { TOLERANCES, classify, scoreObjects } from './mapCompare.mjs';

// 40 x 40 m window at 0.25 m, top-left corner (1000, 2040): pixel (i, j) centre = (1000 + (i + 0.5) / 4, 2040 - (j + 0.5) / 4).
const GSD = 0.25;
const W = 160;
const H = 160;
const WIN = { w: W, h: H, origin: [1000, 2040], gsdM: GSD };
const blank = () => new Uint8Array(W * H);
const centre = (i, j) => [1000 + (i + 0.5) * GSD, 2040 - (j + 0.5) * GSD];
const paintWhere = (inside) => {
  const m = blank();
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) if (inside(...centre(i, j))) m[j * W + i] = 1;
  return m;
};
const sheetWith = (white, extra = {}) => ({ ...WIN, paint: { white, yellow: blank(), blue: blank() }, ...extra });

// A painted N-S line two pixels wide (pixel centres E = 1020.125 and 1020.375, ridge 1020.25); the drawn line sits on
// E = 1020.05, 0.2 m west of the paint ridge.
const paintedLine = paintWhere((E, N) => Math.abs(E - 1020.25) <= 0.25 && N > 2005 && N < 2035);
const drawnLine = { id: 'L1', kind: 'lane_line_solid', colour: 'white', geometry: { type: 'line', coords: [[1020.05, 2008], [1020.05, 2032]] } };

test('a line drawn 0.2 m off its paint reports a lateral residual of 0.2 m within 0.02 m', () => {
  const [r] = scoreObjects([drawnLine], sheetWith(paintedLine), {});
  assert.equal(r.id, 'L1');
  assert.equal(r.kind, 'lane_line_solid');
  assert.equal(r.tier, 'lane');
  assert.equal(r.occluded, false);
  assert.ok(Math.abs(r.residual_m - 0.2) <= 0.02, `residual ${r.residual_m}`);
  assert.ok(r.support >= 0.95, `support ${r.support}`);
  assert.equal(r.iou, null);
  assert.equal(r.over, false, '0.2 m is inside the 0.25 m lane tolerance');
});

test('the same line 0.45 m off is over the lane tolerance', () => {
  const far = paintWhere((E, N) => Math.abs(E - 1020.5) < 0.25 && N > 2005 && N < 2035);
  const [r] = scoreObjects([drawnLine], sheetWith(far), {});
  assert.ok(Math.abs(r.residual_m - 0.45) <= 0.02, `residual ${r.residual_m}`);
  assert.equal(r.over, true);
});

test('a line with no paint under it has support 0 and is over tolerance, not occluded', () => {
  const [r] = scoreObjects([drawnLine], sheetWith(blank()), {});
  assert.equal(r.support, 0);
  assert.equal(r.residual_m, null);
  assert.equal(r.occluded, false);
  assert.equal(r.over, true);
});

test('an object hidden by the occlusion mask is reported occluded, not failed', () => {
  const any = paintWhere((E) => E > 1015 && E < 1025);
  const [r] = scoreObjects([drawnLine], sheetWith(blank()), { any });
  assert.equal(r.occluded, true);
  assert.equal(r.over, false);
  assert.equal(r.residual_m, null);
});

test('occluded samples are left out of the support share', () => {
  // the northern half is hidden; the visible half is fully painted
  const any = paintWhere((E, N) => N > 2020);
  const half = paintWhere((E, N) => Math.abs(E - 1020.25) <= 0.25 && N > 2005 && N <= 2020);
  const [r] = scoreObjects([drawnLine], sheetWith(half), { any });
  assert.equal(r.occluded, false);
  assert.ok(r.support >= 0.95, `support ${r.support}`);
  assert.ok(Math.abs(r.residual_m - 0.2) <= 0.02, `residual ${r.residual_m}`);
});

test('areas are scored by IoU against the paint near them: exact 1, a 0.25 m shift lowers it', () => {
  const bar = [[1010, 2010], [1013, 2010], [1013, 2011], [1010, 2011]];
  const obj = { id: 'Z1', kind: 'zebra_bar', colour: 'white', geometry: { type: 'area', rings: [bar] } };
  const exact = paintWhere((E, N) => E > 1010 && E < 1013 && N > 2010 && N < 2011);
  const [a] = scoreObjects([obj], sheetWith(exact), {});
  assert.equal(a.tier, 'crossing_bar');
  assert.equal(a.iou, 1);
  assert.ok(a.residual_m <= 0.01);
  assert.equal(a.over, false);
  const shifted = paintWhere((E, N) => E > 1010 && E < 1013 && N > 2010.25 && N < 2011.25);
  const [b] = scoreObjects([obj], sheetWith(shifted), {});
  assert.ok(b.iou < 0.8 && b.iou > 0.5, `iou ${b.iou}`);
  assert.ok(Math.abs(b.residual_m - 0.25) <= 0.02, `residual ${b.residual_m}`);
  assert.equal(b.over, true, '0.25 m is over the 0.20 m crossing-bar tolerance');
});

test('blue zones read the blue mask and are judged by IoU only', () => {
  const ring = [[1005, 2005], [1007.5, 2005], [1007.5, 2010], [1005, 2010]];
  const blue = paintWhere((E, N) => E > 1005 && E < 1007.5 && N > 2005 && N < 2010);
  const obj = { id: 'B1', kind: 'disabled_parking', colour: 'blue', geometry: { type: 'area', rings: [ring] } };
  const [r] = scoreObjects([obj], { ...WIN, paint: { white: blank(), yellow: blank(), blue } }, {});
  assert.equal(r.tier, 'blue_zone');
  assert.equal(r.iou, 1);
  assert.equal(r.over, false);
});

test('points are scored by the distance to the nearest reference of their kind', () => {
  const obj = { id: 'P1', kind: 'lamp', geometry: { type: 'point', coords: [1010, 2010] } };
  const sheet = { ...WIN, paint: { white: blank(), yellow: blank(), blue: blank() }, points: { lamp: [[1010.3, 2010.4], [1030, 2030]] } };
  const [r] = scoreObjects([obj], sheet, {});
  assert.equal(r.tier, 'point');
  assert.ok(Math.abs(r.residual_m - 0.5) < 1e-9);
  assert.equal(r.support, 1);
  assert.equal(r.over, false, 'points have no §10.1 tolerance and are reported only');
  const [hidden] = scoreObjects([obj], sheet, { any: paintWhere((E, N) => Math.hypot(E - 1010, N - 2010) < 1) });
  assert.equal(hidden.occluded, true);
});

test('classify maps kinds onto the §10.1 tolerance table', () => {
  assert.equal(classify('parking_line', 'line'), 'parking_divider');
  assert.equal(classify('centre_line_yellow', 'line'), 'lane');
  assert.equal(classify('zebra_bar', 'area'), 'crossing_bar');
  assert.equal(classify('bike_lane_blue', 'area'), 'blue_zone');
  assert.equal(classify('kerb', 'line'), 'kerb');
  assert.equal(classify('text', 'area'), 'other');
  assert.deepEqual(TOLERANCES.parking_divider, { residualM: 0.3, support: 0.5 });
  assert.deepEqual(TOLERANCES.crossing_bar, { residualM: 0.2, iou: 0.6 });
});

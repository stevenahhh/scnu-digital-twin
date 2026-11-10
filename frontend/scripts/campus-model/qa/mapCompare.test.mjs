import assert from 'node:assert/strict';
import test from 'node:test';

import { TOLERANCES, classify, lotSummary, missingDividers, parkingObjects, rowSummary, scoreObjects } from './mapCompare.mjs';

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

test('a rotated crossing bar matches its photo component, not disconnected neighbouring stripes', () => {
  const u = Math.SQRT1_2;
  const at = (s, t) => [1020 + u * (s - t), 2020 + u * (s + t)];
  const obj = { id: 'rotated-bar', kind: 'zebra_bar', colour: 'white',
    geometry: { type: 'area', rings: [[at(-2, -.25), at(2, -.25), at(2, .25), at(-2, .25)]] } };
  const white = paintWhere((E, N) => {
    const s = u * (E - 1020 + N - 2020), t = u * (N - 2020 - E + 1020);
    return Math.abs(s) < 2 && [-.9, 0, .9].some(centre => Math.abs(t - centre) < .25);
  });
  const [result] = scoreObjects([obj], sheetWith(white));
  assert.equal(result.over, false, `exact middle stripe should pass; IoU=${result.iou}`);
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

// ---- generated parking rows (plan todo 13): the check has to read parking.json, and a line the record lost has to show
// A row along +E at N = 2030, stalls running south 5 m; painted on the photo at E = 1005 + k * 2.5, k = 0..4, with both rails.
const LINES = [0, 1, 2, 3, 4].map((k) => 1005 + k * 2.5);
const paintedRow = paintWhere((E, N) => (N < 2030 && N > 2025 && LINES.some((x) => Math.abs(E - x) <= 0.13)) || (E > 1004.9 && E < 1015.1 && (Math.abs(N - 2030) <= 0.13 || Math.abs(N - 2025) <= 0.13)));
const parkingRow = (over = {}) => ({
  id: 'LOT_A/R1', backLine: { abs: [[1005, 2030], [1015, 2030]] }, side: -1, pitchM: 2.5, depthM: 5, startOffsetM: 0, count: 5,
  divider: { style: 'single', widthM: 0.1, colour: 'white' }, endCaps: true, paintBack: true, paintFront: true, stalls: [], wheelStops: null,
  entryFrom: 'aisle', evidence: { tier: 'T1', refs: ['t'], photoSupport: 1 }, estimated: false, ...over,
});
const parkingDoc = (row = parkingRow(), lines = []) => ({ lots: [{ id: 'LOT_A', parcel: 'PARCEL_A', rows: [row], lines }] });

test('parkingObjects gives each divider and each painted end line of a row as a parking line, in the row\'s place', () => {
  const objects = parkingObjects(parkingDoc());
  assert.deepEqual(objects.map((o) => o.id), ['LOT_A/R1/D0', 'LOT_A/R1/D1', 'LOT_A/R1/D2', 'LOT_A/R1/D3', 'LOT_A/R1/D4', 'LOT_A/R1/back', 'LOT_A/R1/front']);
  assert.ok(objects.every((o) => classify(o.kind, o.geometry.type, o.colour) === 'parking_divider'));
  const d2 = objects[2].geometry.coords;
  assert.ok(Math.abs(d2[0][0] - 1010) < 1e-6 && Math.abs(d2[1][0] - 1010) < 1e-6);
  assert.ok(d2[0][1] < 2030 && d2[1][1] > 2025, 'the ends stop short of the rails, whose paint would read as the divider\'s');
});

test('parkingObjects draws no end line the record does not name, and a blue bay as an area without its hatch', () => {
  const stall = { id: 'LOT_A/R1/S0', index: 0, kind: 'accessible', widthM: 3, aisle: { side: 'start', widthM: 1 }, symbol: 'wheelchair' };
  const objects = parkingObjects(parkingDoc(parkingRow({ paintBack: false, paintFront: false, stalls: [stall] })));
  assert.equal(objects.filter((o) => /(back|front)$/.test(o.id)).length, 0);
  const [fill] = objects.filter((o) => o.colour === 'blue');
  assert.equal(fill.id, 'LOT_A/R1/S0/fill');
  assert.equal(classify(fill.kind, fill.geometry.type, fill.colour), 'blue_zone');
  const xs = fill.geometry.rings[0].map((p) => p[0]);
  assert.ok(Math.min(...xs) >= 1005 + 1, 'the hatched aisle is not blue');
});

test('a row on its paint scores within tolerance and misses nothing', () => {
  const doc = parkingDoc();
  const objects = parkingObjects(doc);
  const scored = scoreObjects(objects, sheetWith(paintedRow), {});
  assert.deepEqual(scored.filter((r) => r.over).map((r) => r.id), []);
  assert.ok(scored.every((r) => r.support >= 0.95 && r.residual_m <= 0.1), JSON.stringify(scored[0]));
  assert.deepEqual(missingDividers(doc, objects, sheetWith(paintedRow), {}), []);
});

test('deleting one bay from the record lists the divider it lost as over tolerance', () => {
  const doc = parkingDoc(parkingRow({ count: 4, backLine: { abs: [[1005, 2030], [1012.5, 2030]] } }));
  const missing = missingDividers(doc, parkingObjects(doc), sheetWith(paintedRow), {});
  assert.equal(missing.length, 1, JSON.stringify(missing));
  assert.equal(missing[0].tier, 'parking_divider');
  assert.equal(missing[0].over, true);
  assert.equal(missing[0].missing, true);
  assert.equal(missing[0].row, 'LOT_A/R1');
  assert.ok(Math.abs(missing[0].centreTm[0] - 1015) < 0.2, JSON.stringify(missing[0]));
});

test('a divider the record lost in the middle of a row is listed too', () => {
  // the record has 4 dividers with one 5 m stall: the line at E = 1010 is on the photo and nowhere in the record
  const stall = { index: 1, kind: 'general', widthM: 5 };
  const doc = parkingDoc(parkingRow({ count: 4, stalls: [stall] }));
  const missing = missingDividers(doc, parkingObjects(doc), sheetWith(paintedRow), {});
  assert.deepEqual(missing.map((m) => Math.round(m.centreTm[0])), [1010]);
});

test('paint under the occlusion mask is no evidence of a missing divider', () => {
  const doc = parkingDoc(parkingRow({ count: 4, backLine: { abs: [[1005, 2030], [1012.5, 2030]] } }));
  const any = paintWhere((E) => E > 1013);
  assert.deepEqual(missingDividers(doc, parkingObjects(doc), sheetWith(paintedRow), { any }), []);
});

test('a line drawn by a neighbouring record is not missing from this row', () => {
  const doc = parkingDoc(parkingRow({ count: 4, backLine: { abs: [[1005, 2030], [1012.5, 2030]] } }), [{ id: 'LOT_A/L1', abs: [[1015, 2030], [1015, 2025]], widthM: 0.1, colour: 'white', evidence: { tier: 'T1', refs: ['t'] } }]);
  assert.deepEqual(missingDividers(doc, parkingObjects(doc), sheetWith(paintedRow), {}), []);
});

test('rowSummary reports dividers, support and worst residual per row, and counts what is missing', () => {
  const doc = parkingDoc();
  const objects = parkingObjects(doc);
  const scored = scoreObjects(objects, sheetWith(paintedRow), {});
  const [s] = rowSummary(doc, [...scored, { id: 'LOT_A/R1/missing@7', row: 'LOT_A/R1', missing: true, over: true }]);
  assert.equal(s.row, 'LOT_A/R1');
  assert.equal(s.dividers, 5);
  assert.equal(s.stalls, 4);
  assert.equal(s.visibleDividers, 5);
  assert.ok(s.support >= 0.95);
  assert.ok(s.maxResidualM <= 0.1);
  assert.equal(s.missing, 1);
  assert.equal(s.endLines.back.over, false);
});

test('a wide accessible bay deleted from the end of a row still shows its far line: the walk reaches past the widest stall', () => {
  // painted lines 2.5 m apart and a last line 3.4 m on; the record stops one bay short
  const wide = paintWhere((E, N) => N < 2030 && N > 2025 && [1005, 1007.5, 1010, 1013.4].some((x) => Math.abs(E - x) <= 0.13));
  const doc = parkingDoc(parkingRow({ count: 3, backLine: { abs: [[1005, 2030], [1010, 2030]] } }));
  const missing = missingDividers(doc, parkingObjects(doc), sheetWith(wide), {});
  assert.deepEqual(missing.map((m) => Math.round(m.centreTm[0] * 10) / 10), [1013.4]);
});

test('rowSummary lists what the record calls estimated, for the table, with the seen part of an end line', () => {
  const doc = parkingDoc(parkingRow({ estimatedDividers: [1], estimatedFields: { depthM: { reason: 'x' }, paintBack: { reason: 'y', seenM: [5.7, 7.5] } } }));
  const [s] = rowSummary(doc, scoreObjects(parkingObjects(doc), sheetWith(paintedRow), {}));
  assert.deepEqual(s.estimatedValues, ['depthM', 'paintBack seen 5.7-7.5 m']);
  assert.deepEqual(s.estimatedDividers, [1]);
  assert.equal(s.tier, 'T1');
  const [clean] = rowSummary(parkingDoc(), []);
  assert.deepEqual(clean.estimatedValues, []);
  assert.deepEqual(clean.estimatedDividers, []);
});

test('parkingObjects marks the objects a flag covers', () => {
  const objects = parkingObjects(parkingDoc(parkingRow({ estimatedFields: { depthM: { reason: 'x' }, paintBack: { reason: 'y' } } })));
  const by = (id) => objects.find((o) => o.id === id);
  assert.equal(by('LOT_A/R1/D2').estimated, true);
  assert.equal(by('LOT_A/R1/back').estimated, true);
  assert.equal(by('LOT_A/R1/front').estimated, false);
});

test('rowSummary names a stall flag with its stall, and a flagged width marks the fill', () => {
  const stall = { id: 'LOT_A/R1/S0', index: 0, kind: 'accessible', widthM: 3, symbol: 'wheelchair', figure: { symbol: 'P', side: 'front' }, estimatedFields: { widthM: { reason: 'x' }, figureSide: { reason: 'y' } } };
  const doc = parkingDoc(parkingRow({ stalls: [stall] }));
  const [s] = rowSummary(doc, []);
  assert.deepEqual(s.estimatedValues, ['S0 widthM', 'S0 figureSide']);
  assert.equal(parkingObjects(doc).find((o) => o.id === 'LOT_A/R1/S0/fill').estimated, true);
  assert.equal(parkingObjects(parkingDoc(parkingRow({ stalls: [{ ...stall, estimatedFields: undefined }] }))).find((o) => o.id === 'LOT_A/R1/S0/fill').estimated, false);
});

test('lotSummary reads one line per lot: support of what the photo can judge, over and missing, and whether acceptance holds', () => {
  const lot = (id, extra = {}) => ({ id, rows: [{ id: `${id}/R1`, stalls: [], evidence: { tier: 'T1' }, estimated: false }], lines: [{ id: `${id}/L1` }], ...extra });
  const doc = { lots: [lot('LOT_A', { curated: 'todo 14' }), lot('LOT_B', { curated: 'todo 14' }), lot('LOT_C', { curated: 'todo 14', estimated: true, estimatedReason: 'shade' }), lot('LOT_D', { unreviewed: true }), lot('LOT_E', { curated: 'todo 14' })] };
  const r = (id, support, extra = {}) => ({ id, support, occluded: false, over: false, ...extra });
  const results = [
    r('LOT_A/R1/D0', 1), r('LOT_A/R1/D1', 0.8), r('LOT_A/L1', 1), r('LOT_A/R1/D2', null, { occluded: true }), r('LOT_A/R1/missing@1.0', 0, { over: true, missing: true }),
    r('LOT_B/R1/D0', 0.4), r('LOT_B/L1', 0.6, { over: true }),
    r('LOT_C/R1/D0', 0.2),
    r('LOT_D/R1/D0', 1),
    r('LOT_E/R1/D0', null, { occluded: true }),
  ];
  const by = Object.fromEntries(lotSummary(doc, results).map((x) => [x.lot, x]));
  assert.equal(by.LOT_A.support, 0.933);
  assert.equal(by.LOT_A.visible, 3);
  assert.deepEqual(by.LOT_A.over, ['LOT_A/R1/missing@1.0']);
  assert.equal(by.LOT_A.missing, 1);
  assert.equal(by.LOT_A.accepted, true);
  assert.equal(by.LOT_B.support, 0.5);
  assert.equal(by.LOT_B.accepted, false);
  assert.equal(by.LOT_C.accepted, true);
  assert.equal(by.LOT_C.estimatedReason, 'shade');
  assert.equal(by.LOT_D.accepted, false, 'a lot nobody reviewed is listed, whatever its paint says');
  assert.equal(by.LOT_E.support, null);
  assert.equal(by.LOT_E.accepted, false, 'nothing visible and not marked estimated');
});

test('a free line the record marks estimated says so in the objects', () => {
  const doc = { lots: [{ id: 'LOT_A', rows: [], lines: [{ id: 'LOT_A/L1', abs: [[0, 0], [1, 0]], widthM: 0.1, colour: 'white', estimated: true }, { id: 'LOT_A/L2', abs: [[0, 1], [1, 1]], widthM: 0.1, colour: 'white' }] }] };
  const out = parkingObjects(doc);
  assert.equal(out.find((o) => o.id === 'LOT_A/L1').estimated, true);
  assert.equal(out.find((o) => o.id === 'LOT_A/L2').estimated, false);
});

test('missingDividers lists a 1.0 m wide run of paint and not a 1.5 m band', () => {
  const row = { id: 'LOT_A/R1', backLine: { abs: [[1010, 2030], [1020, 2030]] }, side: -1, pitchM: 2.5, depthM: 5, startOffsetM: 0, count: 5, divider: { style: 'single', widthM: 0.1, colour: 'white' }, stalls: [], evidence: { tier: 'T1', refs: [], photoSupport: 1 }, estimated: false };
  const doc = { lots: [{ id: 'LOT_A', rows: [row] }] };
  const run = (width) => missingDividers(doc, [], sheetWith(paintWhere((E, N) => Math.abs(E - 1022.5) <= width / 2 && N <= 2030 && N >= 2025)));
  assert.equal(run(1.0).filter((m) => /missing@12\./.test(m.id)).length, 1);
  assert.equal(run(1.5).filter((m) => /missing@12\./.test(m.id)).length, 0);
});

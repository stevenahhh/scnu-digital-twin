import assert from 'node:assert/strict';
import test from 'node:test';

import { dividerCandidates, dominantAngleDeg, estimatePitch, proposeLot } from './parkingRows.mjs';
import { validate } from '../lib/schemas.mjs';

// Synthetic sheet: 0.05 m pixels, dark asphalt, white dividers 0.12 m wide and 5 m deep, pitch 2.5 m, along +E.
// The back line is y = 0 (north edge of the stalls at N = 0, stalls extend south to N = -5).
const GSD = 0.05;
const ORIGIN = [-6, 3];
const W = Math.round(45 / GSD);
const H = Math.round(11 / GSD);
const PITCH = 2.5;
const X0 = 1.0;
const COUNT = 12;
const SHADOWED = new Set([3, 4, 8, 9]);

function sheet({ shadowed = SHADOWED, canopy = false } = {}) {
  const rgb = new Uint8Array(W * H * 3).fill(70);
  const mask = new Uint8Array(W * H);
  for (let j = 0; j < H; j += 1) {
    for (let i = 0; i < W; i += 1) {
      const E = ORIGIN[0] + (i + 0.5) * GSD;
      const N = ORIGIN[1] - (j + 0.5) * GSD;
      if (N > 0 || N < -5) continue;
      for (let k = 0; k < COUNT; k += 1) {
        const x = X0 + k * PITCH;
        if (Math.abs(E - x) > 0.06) continue;
        const hidden = canopy || shadowed.has(k);
        rgb.fill(hidden ? 40 : 235, (j * W + i) * 3, (j * W + i) * 3 + 3);
      }
      const k = Math.round((E - X0) / PITCH);
      if (canopy || (shadowed.has(k) && Math.abs(E - (X0 + k * PITCH)) < 1.0)) mask[j * W + i] = 1;
    }
  }
  return { w: W, h: H, origin: ORIGIN, gsdM: GSD, rgb, mask };
}

const dividerPiece = (x) => [[x - 0.06, 0], [x + 0.06, 0], [x + 0.06, -5], [x - 0.06, -5]];
const LOT = { id: 'LOT_TEST', parcel: 'PARCEL_LOT_TEST', ring: [[-4, 2], [40, 2], [40, -8], [-4, -8]] };
const visiblePieces = (shadowed = SHADOWED) => Array.from({ length: COUNT }, (_, k) => k).filter((k) => !shadowed.has(k)).map((k) => ({ id: `MK${k}`, kind: 'parking_line', ring: dividerPiece(X0 + k * PITCH) }));

test('dividerCandidates keeps thin pieces only (aspect >= 8)', () => {
  const blob = { id: 'BLOB', kind: 'parking_line', ring: [[0, 0], [4, 0], [4, -5], [0, -5]] };
  const c = dividerCandidates([...visiblePieces(), blob]);
  assert.equal(c.length, 8);
  assert.ok(c.every((d) => d.id !== 'BLOB'));
});

test('dominant angle and pitch come from the visible dividers despite the gaps', () => {
  const c = dividerCandidates(visiblePieces());
  const theta = dominantAngleDeg(c);
  assert.ok(Math.abs(((theta % 180) + 180) % 180 - 90) <= 1, `theta ${theta}`);
  const { pitchM } = estimatePitch(c.map((d) => d.centre[0]));
  assert.ok(Math.abs(pitchM - PITCH) <= 0.05, `pitch ${pitchM}`);
});

test('a row with 4 of 12 dividers shadowed is proposed as one 12-divider row', () => {
  const lot = proposeLot(LOT, { pieces: visiblePieces(), window: sheet(), backHint: [10, 20] });
  assert.equal(lot.rows.length, 1);
  const [row] = lot.rows;
  assert.equal(row.id, 'LOT_TEST/R1');
  assert.equal(row.count, COUNT);
  assert.ok(Math.abs(row.pitchM - PITCH) <= 0.05);
  assert.ok(Math.abs(row.depthM - 5) <= 0.2, `depth ${row.depthM}`);
  assert.ok(row.evidence.photoSupport >= 0.7, `support ${row.evidence.photoSupport}`);
  assert.equal(row.evidence.tier, 'T1');
  assert.equal(row.estimated, false);
  // back line on N = 0 (the end nearer the hint), stalls on its south side
  for (const [, N] of row.backLine.abs) assert.ok(Math.abs(N) <= 0.15, `back N ${N}`);
  const [a, b] = row.backLine.abs;
  const ax = [b[0] - a[0], b[1] - a[1]];
  const left = [-ax[1], ax[0]];
  assert.equal(row.side, left[1] < 0 ? 1 : -1);
  // first divider sits at X0 along the axis
  const first = ax[0] > 0 ? a[0] + row.startOffsetM : a[0] - row.startOffsetM;
  assert.ok(Math.abs(first - X0) <= 0.15, `first divider ${first}`);
  assert.equal(row.divisions.filter((d) => d.occluded).length, SHADOWED.size);
  assert.deepEqual(row.stalls, []);
});

test('two visible dividers still make a row (no ">= 3 detected dividers" rule)', () => {
  const shadowed = new Set([0, 1, 2, 3, 4, 7, 8, 9, 10, 11]);
  const lot = proposeLot(LOT, { pieces: visiblePieces(shadowed), window: sheet({ shadowed }), backHint: [10, 20] });
  assert.equal(lot.rows.length, 1);
  assert.equal(lot.rows[0].count, COUNT);
});

test('a lot fully under canopy gets a T4 estimated proposal and no invented accessible bay', () => {
  const blue = { id: 'BLUE', kind: 'disabled_parking', ring: [[1.2, 0], [4.4, 0], [4.4, -5], [1.2, -5]] };
  const lot = proposeLot(LOT, { pieces: [blue], window: sheet({ canopy: true }), backHint: [10, 20] });
  assert.equal(lot.evidence.tier, 'T4');
  assert.equal(lot.estimated, true);
  assert.equal(lot.rows.length, 0);
  assert.ok(!JSON.stringify(lot).includes('accessible'));
});

test('a blue piece on a visible row marks the nearest stall accessible', () => {
  const blue = { id: 'BLUE', kind: 'disabled_parking', ring: [[1.1, 0], [3.4, 0], [3.4, -5], [1.1, -5]] };
  const lot = proposeLot(LOT, { pieces: [...visiblePieces(), blue], window: sheet(), backHint: [10, 20] });
  const [row] = lot.rows;
  assert.equal(row.stalls.length, 1);
  assert.equal(row.stalls[0].kind, 'accessible');
  assert.equal(row.stalls[0].index, 0);
  assert.equal(row.stalls[0].widthM, 2.5);
  assert.deepEqual(row.stalls[0].aisle, { side: 'end', widthM: 1.2 });
});

const goodRow = () => ({
  id: 'LOT_E3_S/R1', backLine: { abs: [[0, 0], [30, 0]] }, side: -1, pitchM: 2.5, depthM: 5, startOffsetM: 0, count: 12,
  divider: { style: 'single', widthM: 0.1, colour: 'white' }, endCaps: true, stalls: [],
  wheelStops: { offsetFromBackM: 0.7, lengthM: 0.6, colour: '#d9b43a', every: 1 }, entryFrom: 'aisle',
  evidence: { tier: 'T1', refs: ['x'], photoSupport: 0.8 }, estimated: false,
});

test("validate('parking'): an accessible bay outside any row is an error naming the bay", () => {
  const lot = (extra, rows = [goodRow()]) => ({ lots: [{ id: 'LOT_E3_S', parcel: null, rows, ...extra }] });
  const loose = validate('parking', lot({ bays: [{ id: 'LOT_E3_S/B7', kind: 'accessible', centre: [0, 0] }] }));
  assert.equal(loose.ok, false);
  assert.ok(loose.errors.some((e) => e.startsWith('LOT_E3_S: accessible bay LOT_E3_S/B7 is outside any row')), loose.errors.join('\n'));
  const past = validate('parking', lot({}, [{ ...goodRow(), stalls: [{ id: 'LOT_E3_S/R1/S40', index: 40, kind: 'accessible', symbol: 'wheelchair' }] }]));
  assert.ok(past.errors.some((e) => e.startsWith('LOT_E3_S/R1: stalls[0] accessible bay LOT_E3_S/R1/S40 is outside the row')), past.errors.join('\n'));
  assert.deepEqual(validate('parking', lot({}, [{ ...goodRow(), stalls: [{ id: 'LOT_E3_S/R1/S2', index: 2, kind: 'accessible', widthM: 3.3, aisle: { side: 'back', widthM: 1, outside: true }, symbol: 'wheelchair', upBearingDeg: 10, figure: { symbol: 'scooter', side: 'back', frontBearingDeg: 90 } }, { index: 3, kind: 'pm', symbol: 'P' }] }])).errors, []);
});

test("validate('parking') checks free lines and the optional row fields by id", () => {
  const lot = (extra, row = {}) => ({ lots: [{ id: 'LOT_E3_S', parcel: null, rows: [{ ...goodRow(), ...row }], ...extra }] });
  assert.deepEqual(validate('parking', lot({ lines: [{ id: 'LOT_E3_S/L1', abs: [[0, 0], [1, 0]], widthM: 0.1, colour: 'white', evidence: { tier: 'T1', refs: ['x'] } }, { id: 'LOT_E3_S/L2', ring: [[0, 0], [1, 0], [1, 1]], colour: 'yellow', evidence: { tier: 'T1', refs: ['x'] } }] }, { paintBack: true, paintFront: false, dividerBearingDeg: 10, estimatedDividers: [1] })).errors, []);
  const bad = validate('parking', lot({ lines: [{ id: 'LOT_E3_S/L1', abs: [[0, 0]], colour: 'red', evidence: {} }] }, { dividerBearingDeg: 'n', estimatedDividers: [99], divider: { style: 'none', widthM: 0.1 } }));
  for (const start of ['LOT_E3_S/L1: needs abs', 'LOT_E3_S/L1: colour', 'LOT_E3_S/L1: evidence.tier', 'LOT_E3_S/R1: dividerBearingDeg', 'LOT_E3_S/R1: estimatedDividers']) assert.ok(bad.errors.some((e) => e.startsWith(start)), `${start}\n${bad.errors.join('\n')}`);
  assert.ok(!bad.errors.some((e) => e.includes('divider needs style')), 'style none is a wheel-stop-only row');
});

test("validate('parking') accepts a well-formed lot and names lot and row ids in errors", () => {
  assert.deepEqual(validate('parking', { lots: [{ id: 'LOT_E3_S', parcel: null, rows: [goodRow()] }] }), { ok: true, errors: [] });
  const bad = goodRow();
  bad.pitchM = 0;
  bad.stalls = [{ index: 12, kind: 'disabled' }];
  bad.evidence = { tier: 'T4', refs: [], photoSupport: 2 };
  const { ok, errors } = validate('parking', { lots: [{ id: 'LOT_E3_S', parcel: 'PARCEL_X', rows: [bad, { ...goodRow(), id: 'LOT_OTHER/R1' }] }, { id: 'bad id', rows: [] }] });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith('LOT_E3_S/R1: pitchM')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('LOT_E3_S/R1: stalls[0]')));
  assert.ok(errors.some((e) => e.startsWith('LOT_E3_S/R1: estimated must be true')));
  assert.ok(errors.some((e) => e.startsWith('LOT_E3_S/R1: evidence.photoSupport')));
  assert.ok(errors.some((e) => e.startsWith('LOT_OTHER/R1: row id must start with LOT_E3_S/')));
  assert.ok(errors.some((e) => e.startsWith('bad id: id must match')));
});

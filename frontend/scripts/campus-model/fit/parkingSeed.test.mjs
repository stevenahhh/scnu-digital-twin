import assert from "node:assert/strict";
import test from "node:test";

import { validate } from "../lib/schemas.mjs";
import { parkingPlan } from "../stages/parking.mjs";
import { seedLots, stallRowRecord } from "./parkingSeed.mjs";

// A divider piece at across position x (E), running north-south from y0 to y1.
const line = (x, y0 = 0, y1 = -5, id = `P${x}`) => ({ id, colour: "white", ring: [[x - 0.05, y0], [x + 0.05, y0], [x + 0.05, y1], [x - 0.05, y1]] });
const seed = (input) => seedLots({ lines: [], cells: [], stallRows: [], ...input });
const onlyRow = (doc) => { assert.equal(doc.lots.flatMap((l) => l.rows).length, 1); return doc.lots[0].rows[0]; };

test("dividers become one uniform row; the result validates", () => {
  const doc = seed({ lines: [0, 2.5, 5, 7.5, 10].map((x) => line(x)) });
  const row = onlyRow(doc);
  assert.equal(row.count, 5);
  assert.ok(Math.abs(row.pitchM - 2.5) < 1e-6);
  assert.ok(Math.abs(row.depthM - 5) < 1e-6);
  assert.deepEqual(row.stalls, []);
  assert.deepEqual(validate("parking", doc).errors, []);
  assert.equal(row.estimated, false);
});

test("a missing divider under the mask stays in the row as estimated; two visible empties split it", () => {
  const xs = [0, 2.5, 7.5, 10];
  const masked = seed({ lines: xs.map((x) => line(x)), probe: () => ({ visible: 0, support: 0 }) });
  const row = onlyRow(masked);
  assert.equal(row.count, 5);
  assert.deepEqual(row.estimatedDividers, [2]);
  const gap = [0, 2.5, 10, 12.5];
  const split = seed({ lines: gap.map((x) => line(x)), probe: () => ({ visible: 1, support: 0 }) });
  assert.equal(split.lots.flatMap((l) => l.rows).length, 2);
});

test("one wider stall is an exception, so the dividers stay on their paint", () => {
  const row = onlyRow(seed({ lines: [0, 2.5, 5, 8.3, 10.8].map((x) => line(x)) }));
  assert.equal(row.count, 5);
  assert.deepEqual(row.stalls.map((s) => [s.index, s.kind, Number(s.widthM.toFixed(2))]), [[2, "general", 3.3]]);
});

test("back-to-back rows stay apart; fragments of one divider merge; a lone piece and a long line are free lines", () => {
  const doc = seed({ lines: [
    ...[0, 2.5, 5].map((x) => line(x, 0, -5)),
    ...[0, 2.5, 5].map((x) => line(x, -5.5, -10.5, `Q${x}`)),
    line(2.55, -1, -3, "frag"),
    line(100),
    { id: "LONG", colour: "white", ring: [[0, 40], [30, 40], [30, 40.1], [0, 40.1]] },
  ] });
  const rows = doc.lots.flatMap((l) => l.rows);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.count === 3));
  const lines = doc.lots.flatMap((l) => l.lines ?? []);
  assert.deepEqual(lines.flatMap((l) => l.evidence.refs).sort(), ["LONG", "P100"]);
});

test("a skewed row records its divider bearing and its axis follows the back ends", () => {
  // dividers run due south; the back ends step 0.6 m south per 2.5 m east
  const row = onlyRow(seed({ lines: [0, 2.5, 5, 7.5].map((x, k) => line(x, -0.6 * k, -0.6 * k - 5)) }));
  assert.ok(Number.isFinite(row.dividerBearingDeg));
  const [[E0, N0], [E1, N1]] = row.backLine.abs;
  assert.ok(Math.abs((N1 - N0) / (E1 - E0) + 0.24) < 0.02, "the back line runs along the ends");
  assert.ok(Math.abs(row.dividerBearingDeg - 180) < 2);
});

test("a blue cell in a row marks that stall; beyond its end it extends the row; alone it is a row of its own", () => {
  const cell = (centre, ids, extra = {}) => ({ ids, centre, cell: 0, widthM: 2.5, deepM: 5, acrossBearingDeg: 90, upBearingDeg: 0, symbol: "wheelchair", rule: {}, ...extra });
  const inRow = onlyRow(seed({ lines: [0, 2.5, 5, 7.5].map((x) => line(x)), cells: [cell([3.75, -2.5], ["B1"])] }));
  assert.deepEqual(inRow.stalls.map((s) => [s.index, s.kind, s.symbol]), [[1, "accessible", "wheelchair"]]);
  assert.ok(inRow.evidence.refs.some((r) => r.includes("B1")));

  const after = onlyRow(seed({ lines: [0, 2.5, 5].map((x) => line(x)), cells: [cell([6.5, -2.5], ["B2"], { widthM: 3 })] }));
  assert.equal(after.count, 4);
  assert.deepEqual(after.stalls.map((s) => s.index), [2]);
  assert.ok(Math.abs(after.stalls[0].widthM - 3) < 1e-6);

  const before = onlyRow(seed({ lines: [10, 12.5, 15].map((x) => line(x)), cells: [cell([8.5, -2.5], ["B3"], { widthM: 3 })] }));
  assert.deepEqual([before.count, before.stalls[0].index], [4, 0]);
  assert.ok(Math.abs(before.backLine.abs[0][0] - 7) < 1e-6, "the row starts at the bay's far edge");

  const alone = onlyRow(seed({ cells: [cell([50, 50], ["B4"], { symbol: "P", rule: { figure: { symbol: "scooter", endBearingDeg: 0, frontBearingDeg: 90 }, aisle: { bearingDeg: 90, widthM: 1.2 } } })] }));
  assert.equal(alone.count, 2);
  assert.equal(alone.stalls[0].kind, "pm");
  assert.equal(alone.stalls[0].figure.symbol, "scooter");
  assert.equal(alone.stalls[0].figure.side, "back");
  assert.equal(alone.stalls[0].aisle.side, "end");
  assert.ok(Math.abs(alone.backLine.abs[0][1] - 52.5) < 1e-6, "the back lies towards the symbol's top");
});

test("the stall_row record: dividers, bearing, lines and wheel stops move to the row and stay at the same place", () => {
  const record = stallRowRecord({
    line: [[0, 0], [25, 0]], id: "SD-X", properties: { kind: "stall_row", stalls: 10, side: "left", depth_m: 5, wheel_stops: true, stopColour: "#000000", back_line: true, front_line: true, vr_scene: "scene_x", vr_face: "f", note: "seen" },
  });
  assert.equal(record.count, 11);
  assert.deepEqual(record.backLine.abs, [[0, 5], [25, 5]], "left of an eastward line is north; the back is the far end");
  assert.equal(record.side, -1);
  assert.deepEqual(record.wheelStops, { offsetFromBackM: 0.9, lengthM: 1.6, colour: "#000000", every: 1 });
  assert.equal(record.paintBack, true);
  assert.equal(record.paintFront, true);
  assert.ok(record.evidence.refs.some((r) => r.includes("SD-X") && r.includes("scene_x")));
  const skew = stallRowRecord({ line: [[0, 0], [10, 0]], id: "SD-Y", properties: { kind: "stall_row", stalls: 4, divider_bearing_deg: 180, depth_m: 4 } });
  assert.deepEqual(skew.backLine.abs, [[0, -4], [10, -4]]);
  assert.ok(Math.abs(skew.dividerBearingDeg) < 1e-9, "from the back towards the aisle");
});

test("photo dividers inside a stall_row footprint are claimed: they set its grid and form no second row", () => {
  const doc = seed({
    lines: [0.4, 2.8, 5.2, 7.6].map((x) => line(x)),
    stallRows: [{ line: [[0, -5], [7.5, -5]], id: "SD-Z", properties: { kind: "stall_row", stalls: 3, side: "left", depth_m: 5, dividers: false, wheel_stops: true } }],
  });
  const row = onlyRow(doc);
  assert.equal(row.count, 4);
  assert.ok(Math.abs(row.pitchM - 2.4) < 1e-6, `pitch from the paint, got ${row.pitchM}`);
  assert.ok(Math.abs(row.backLine.abs[0][0] - 0.4) < 1e-6, "the grid starts on the first divider");
  assert.equal(row.evidence.tier, "T1");
  assert.ok(row.wheelStops);
});

test("a stall_row with no paint under it keeps its record, as an estimate", () => {
  const row = onlyRow(seed({ stallRows: [{ line: [[0, 0], [10, 0]], id: "SD-V", properties: { kind: "stall_row", stalls: 4, side: "left" } }] }));
  assert.equal(row.estimated, true);
  assert.equal(row.evidence.tier, "T2");
  assert.deepEqual(row.estimatedDividers, [0, 1, 2, 3, 4]);
});

test("a wheel-stop record whose dividers the photo does not show draws no dividers", () => {
  const row = onlyRow(seed({ stallRows: [{ line: [[0, 0], [60, 0]], id: "SD-U", properties: { kind: "stall_row", stalls: 6, side: "left", depth_m: 1.2, dividers: false, wheel_stops: true } }] }));
  assert.equal(row.divider.style, "none");
  assert.equal(row.estimatedDividers, undefined);
  assert.equal(row.wheelStops.offsetFromBackM, 0.9);
});

test("where no drawn paint backs a stall_row the estimator is asked; its row takes the stops and blue bays refit its pitch", () => {
  const proposed = { backLine: { abs: [[0, 0], [31.8, 0]] }, side: -1, pitchM: 2.65, depthM: 5, startOffsetM: 0, count: 13, divider: { style: "single", widthM: 0.1, colour: "white" }, endCaps: true, stalls: [], wheelStops: null, entryFrom: "aisle", evidence: { tier: "T1", refs: ["estimator"], photoSupport: 1 }, estimated: false };
  const cell = (s) => ({ ids: ["B"], centre: [s, -2.5], cell: 0, widthM: 3.3, deepM: 5, acrossBearingDeg: 90, upBearingDeg: 0, symbol: "wheelchair", rule: {} });
  const asked = [];
  const row = onlyRow(seed({
    cells: [cell(1.65), cell(30.15)],
    // traced 5 m in front of the row, 16 degrees off its dividers
    stallRows: [{ line: [[2, -5], [30, -5]], id: "SD-W", properties: { kind: "stall_row", stalls: 11, divider_bearing_deg: 16, depth_m: 5, dividers: false, wheel_stops: true } }],
    propose: (id, ring, hint) => { asked.push(id); assert.ok(hint[1] > 0, "the hint lies behind the row"); return [structuredClone(proposed)]; },
  }));
  assert.deepEqual(asked, ["SD-W"]);
  assert.ok(row.wheelStops, "the stops belong to the estimator row");
  assert.deepEqual(row.stalls.map((s) => [s.index, s.widthM]), [[0, 3.3], [11, 3.3]]);
  assert.ok(Math.abs(row.pitchM - (31.8 - 6.6) / 10) < 1e-3, `pitch ${row.pitchM}`);
  assert.equal(row.count, 13);
});

test("rows near each other share a lot; far rows do not; a named ring names its lot", () => {
  const doc = seed({ lines: [...[0, 2.5, 5], ...[12, 14.5, 17], ...[500, 502.5, 505]].map((x) => line(x)), named: { LOT_E3_S: { ring: [[-1, 1], [6, 1], [6, -6], [-1, -6]] } } });
  assert.deepEqual(doc.lots.map((l) => l.rows.length), [2, 1]);
  assert.equal(doc.lots[0].id, "LOT_E3_S");
  assert.ok(doc.lots[1].id.startsWith("LOT_E"));
  assert.deepEqual(validate("parking", doc).errors, []);
  assert.deepEqual(doc.lots[0].rows.map((r) => r.id), ["LOT_E3_S/R1", "LOT_E3_S/R2"]);
});

// ---- gate review of 8c1b9f62, blockers B1 and B2
const blueCell = (centre, across, up, extra = {}) => ({ ids: ["B"], cell: 0, centre, widthM: 2.96, deepM: 4.55, acrossBearingDeg: across, upBearingDeg: up, symbol: "wheelchair", rule: {}, ...extra });
const fillOf = (doc) => parkingPlan(doc, { toScene: (E, N) => [E, N] }).pieces.find((p) => p.colour === "blue").rings[0];
const meanOf = (ring) => ring.reduce((a, q) => [a[0] + q[0] / ring.length, a[1] + q[1] / ring.length], [0, 0]);

test("a lone blue cell keeps its centre and size whatever way its symbol points", () => {
  for (const [across, up] of [[104.8, 194.8], [194.8, 194.8], [194.8, 14.8], [90, 0], [90, 90], [90, 270], [90, 135]]) {
    const doc = seed({ cells: [blueCell([1000, 1000], across, up)] });
    const fill = fillOf(doc);
    const c = meanOf(fill);
    assert.ok(Math.hypot(c[0] - 1000, c[1] - 1000) < 0.01, `across ${across} up ${up}: moved ${Math.hypot(c[0] - 1000, c[1] - 1000)}`);
    const row = onlyRow(doc);
    assert.equal(row.stalls[0].upBearingDeg, up, "the bearing stays the symbol's");
    const a = bearingVector(across);
    const span = (v) => { const d = fill.map((q) => q[0] * v[0] + q[1] * v[1]); return Math.max(...d) - Math.min(...d); };
    assert.ok(Math.abs(span(a) - (2.96 - 0.2)) < 0.01, "width along across");
    assert.ok(Math.abs(span([-a[1], a[0]]) - (4.55 - 0.2)) < 0.01, "depth square to across");
  }
});

const bearingVector = (deg) => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
// A photo stub: paint at the given E positions, nothing else, everything visible unless masked.
const photoWith = (paintedAt, { masked = () => false, blue = () => 1 } = {}) => ({
  line: ({ from, across, lengthM }) => {
    const hit = paintedAt.find((x) => Math.abs(x - from[0]) <= 0.3);
    return { visible: masked(from) ? 0 : 1, contrast: hit === undefined ? 0 : 40, offsetM: hit === undefined ? 0 : (hit - from[0]) / across[0], lengthM };
  },
  blue: (ring) => ({ visible: 1, share: blue(ring) }),
});

test("photoSupport measures the photo: a detected piece with no paint under it does not count", () => {
  const xs = [0, 2.5, 5, 7.5, 10];
  const good = onlyRow(seed({ lines: xs.map((x) => line(x)), photo: photoWith(xs) }));
  assert.equal(good.evidence.photoSupport, 1);
  assert.equal(good.evidence.tier, "T1");
  const none = onlyRow(seed({ lines: xs.map((x) => line(x)), photo: photoWith([]) }));
  assert.ok(none.evidence.photoSupport === 0 || none.evidence.photoSupport === null, `support ${none.evidence.photoSupport}`);
  assert.notEqual(none.evidence.tier, "T1");
  assert.equal(none.estimated, true);
  assert.ok(none.evidence.refs.some((r) => /no paint/.test(r)), "the reason is recorded");
  assert.deepEqual(validate("parking", seed({ lines: xs.map((x) => line(x)), photo: photoWith([]) })).errors, []);
});

test("a false stroke between real dividers is dropped: the ladder stays regular", () => {
  const real = [0, 2.6, 5.2, 7.8, 10.4, 13];
  const row = onlyRow(seed({ lines: [...real.map((x) => line(x)), line(3.6), line(4.3), line(9.1)], photo: photoWith(real) }));
  assert.equal(row.count, 6);
  assert.ok(Math.abs(row.pitchM - 2.6) < 1e-3);
  assert.deepEqual(row.stalls, []);
  assert.equal(row.estimatedDividers, undefined);
  assert.equal(row.evidence.photoSupport, 1);
  assert.ok(row.evidence.refs.some((r) => /no paint/.test(r) && r.includes("P3.6")), "the dropped piece is named");
});

test("pieces closer than the shortest stall are not two dividers even with no photo to ask: the longer stays", () => {
  const row = onlyRow(seed({ lines: [...[0, 2.5, 5, 7.5].map((x) => line(x)), line(3.4, -1, -3)] }));
  assert.equal(row.count, 4);
  assert.deepEqual(row.stalls, []);
});

test("a divider the photo cannot confirm is flagged; one the photo shows between pieces is not", () => {
  const row = onlyRow(seed({ lines: [0, 2.5, 7.5, 10].map((x) => line(x)), photo: photoWith([0, 2.5, 5, 7.5]) }));
  assert.equal(row.count, 5);
  assert.deepEqual(row.estimatedDividers, [4]);
  assert.equal(row.evidence.photoSupport, 0.8);
});

test("masked dividers do not count against the row but a row with nothing visible is not T1", () => {
  const xs = [0, 2.5, 5, 7.5];
  const row = onlyRow(seed({ lines: xs.map((x) => line(x)), photo: photoWith(xs, { masked: (p) => p[0] < 4 }) }));
  assert.equal(row.evidence.photoSupport, 1, "both visible dividers show paint");
  assert.equal(row.evidence.tier, "T1");
  assert.deepEqual(row.estimatedDividers, [0, 1]);
  const hidden = onlyRow(seed({ lines: xs.map((x) => line(x)), photo: photoWith(xs, { masked: () => true }) }));
  assert.equal(hidden.evidence.photoSupport, null);
  assert.equal(hidden.estimated, true);
  assert.notEqual(hidden.evidence.tier, "T1");
});

test("an accessible stall carries the blue share measured under its fill; a row of blue cells is graded on it", () => {
  const on = onlyRow(seed({ cells: [blueCell([50, 50], 90, 0)], photo: photoWith([], { blue: () => 0.8 }) }));
  assert.equal(on.stalls[0].paintSupport, 0.8);
  assert.equal(on.evidence.photoSupport, 0.8);
  assert.equal(on.evidence.tier, "T1");
  const off = onlyRow(seed({ cells: [blueCell([50, 50], 90, 0)], photo: photoWith([], { blue: () => 0.08 }) }));
  assert.equal(off.evidence.photoSupport, 0.08);
  assert.equal(off.stalls[0].estimated, true);
  assert.notEqual(off.evidence.tier, "T1");
  assert.equal(off.estimated, true);
  assert.deepEqual(validate("parking", seed({ cells: [blueCell([50, 50], 90, 0)], photo: photoWith([], { blue: () => 0.08 }) })).errors, []);
});

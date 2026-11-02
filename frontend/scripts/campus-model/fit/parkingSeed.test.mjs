import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validate } from "../lib/schemas.mjs";
import { parkingPlan } from "../stages/parking.mjs";
import { applyCuration, seedLots, stallRowRecord } from "./parkingSeed.mjs";

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

// ---- gate review 2 of 27283390, blocker B3: rails of other rows read as dividers
// A rail piece running east-west at north y, from E x0 to x1.
const rail = (y, x0 = 5, x1 = 11, id = `RAIL${y}`) => ({ id, colour: "white", ring: [[x0, y + 0.05], [x1, y + 0.05], [x1, y - 0.05], [x0, y - 0.05]] });
const ladder = (y0, n = 11, x0 = 0, tag = "A") => Array.from({ length: n }, (_, k) => line(x0 + k * 2.5, y0, y0 - 5, `${tag}${k}`));

test("rails of other rows do not make a row: they become those rows' end lines", () => {
  const doc = seed({ lines: [...ladder(0), ...ladder(-12, 11, 0, "B"), rail(0), rail(-5), rail(-12)] });
  const rows = doc.lots.flatMap((l) => l.rows);
  assert.equal(rows.length, 2, rows.map((r) => `${r.count}@${r.pitchM}`).join(" "));
  assert.ok(rows.every((r) => r.count === 11 && Math.abs(r.pitchM - 2.5) < 1e-3));
  const north = rows.find((r) => r.backLine.abs[0][1] > -3 || r.backLine.abs[0][1] === -5);
  assert.ok(north.paintBack && north.paintFront, "both rails of the ladder are its end lines");
  const south = rows.find((r) => r !== north);
  assert.ok(south.paintBack || south.paintFront, "the third rail is the other ladder's");
  assert.deepEqual(doc.lots.flatMap((l) => l.lines ?? []), [], "no piece is left over");
  assert.deepEqual(validate("parking", doc).errors, []);
});

test("a rail row is not rescued by the photo: paint under a rail is the rail", () => {
  const doc = seed({ lines: [...ladder(0), ...ladder(-12, 11, 0, "B"), rail(0), rail(-5), rail(-12)], photo: { line: () => ({ visible: 1, contrast: 40, offsetM: 0 }), blue: () => ({ visible: 1, share: 1 }) } });
  assert.deepEqual(doc.lots.flatMap((l) => l.rows).map((r) => r.count), [11, 11]);
});

test("a row keeps its place when only one of its dividers lies on a bigger row's rail", () => {
  // a four-line ladder running north from the back rail of the east-west row, its first line on that rail
  const logs = [];
  const doc = seed({ lines: [...ladder(0), ...[0, 2.5, 5, 7.5].map((d, k) => rail(d, 5, 10, `C${k}`))], log: (m) => logs.push(m) });
  const rows = doc.lots.flatMap((l) => l.rows);
  assert.deepEqual(rows.map((r) => r.count).sort((a, b) => a - b), [4, 11]);
  assert.equal(logs.filter((m) => m.startsWith("RAIL kept") && m.includes("1/4")).length, 1, "the guard really puts one divider on a rail");
});

test("a row with 2 of its 3 dividers on rails is dissolved, as the real row of gate review 2 was", () => {
  // the rails of two ladders 7 m apart, and one line of its own between them: one own divider is not a row
  const logs = [];
  const doc = seed({ lines: [...ladder(0), ...ladder(-12, 11, 0, "B"), rail(-5, 5, 11, "ON1"), rail(-8.5, 5, 11, "OWN"), rail(-12, 5, 11, "ON2")], log: (m) => logs.push(m) });
  assert.deepEqual(doc.lots.flatMap((l) => l.rows).map((r) => r.count), [11, 11]);
  assert.equal(logs.filter((m) => m.startsWith("RAIL dissolved") && m.includes("2/3")).length, 1, logs.join(" | "));
  assert.deepEqual(doc.lots.flatMap((l) => l.lines ?? []).map((l) => l.evidence.refs[0]), ["OWN"], "its own piece stays a free line");
});

test("a short ladder is not dissolved into a longer row that happens to run past it", () => {
  // two rows at right angles: neither's dividers lie on the other's back or front line
  const doc = seed({ lines: [...ladder(0), ...[0, 2.5, 5, 7.5].map((d, k) => rail(-20 - d, 5, 10, `S${k}`))] });
  assert.deepEqual(doc.lots.flatMap((l) => l.rows).map((r) => r.count).sort((a, b) => a - b), [4, 11]);
});

// ---- curation (plan todo 13): records a person reviewed live in data/ground/parking-curation.json and survive a reseed
const curatedRow = (over = {}) => ({
  id: "LOT_KEEP/R7", backLine: { abs: [[0, 0], [10, 0]] }, side: -1, pitchM: 2.5, depthM: 5, startOffsetM: 0, count: 5,
  divider: { style: "single", widthM: 0.1, colour: "white" }, endCaps: true, stalls: [], wheelStops: null, entryFrom: "aisle",
  evidence: { tier: "T1", refs: ["hand"] }, estimated: false, ...over,
});
const curation = (over = {}) => ({ lots: [{ id: "LOT_KEEP", anchor: [5, -2], curated: "todo 13", rows: [curatedRow()], lines: [], retired: ["LOT_KEEP/R1"], ...over }] });
const twoLots = (shift = 0) => seed({ lines: [...[0, 2.5, 5, 7.5, 10].map((x) => line(x + shift)), ...[100, 102.5, 105, 107.5].map((x) => line(x))] });

test("a curated lot replaces the seed's records at its anchor, whatever the seed called them", () => {
  const seeded = twoLots();
  const before = seeded.lots.map((l) => l.id);
  const doc = applyCuration(seeded, curation());
  const lot = doc.lots.find((l) => l.id === "LOT_KEEP");
  assert.ok(lot, `lots: ${doc.lots.map((l) => l.id)}`);
  assert.equal(lot.curated, "todo 13");
  assert.deepEqual(lot.rows.map((r) => r.id), ["LOT_KEEP/R7"]);
  assert.equal(doc.lots.length, before.length, "the other lot stays");
  assert.deepEqual(validate("parking", doc).errors, []);
});

test("curated ids do not move when the seed renumbers its lots", () => {
  const first = applyCuration(twoLots(), curation());
  const second = applyCuration(twoLots(3), curation());
  const ids = (doc) => doc.lots.find((l) => l.id === "LOT_KEEP").rows.map((r) => r.id);
  assert.notDeepEqual(twoLots().lots.map((l) => l.id), twoLots(3).lots.map((l) => l.id), "the seed's own names did move");
  assert.deepEqual(ids(first), ids(second));
});

test("applying a curation does not edit the curation records in place", () => {
  const input = curation();
  const frozen = JSON.stringify(input);
  applyCuration(twoLots(), input, { photo: { line: () => ({ visible: 1, contrast: 40, offsetM: 0 }), blue: () => ({ visible: 1, share: 1 }) } });
  assert.equal(JSON.stringify(input), frozen);
});

test("a curation names what it cannot place", () => {
  assert.throws(() => applyCuration(twoLots(), curation({ anchor: [500, 500] })), /LOT_KEEP: anchor \[500,500\] lies on no seeded lot/);
  assert.throws(() => applyCuration(twoLots(), { lots: [curation().lots[0], { ...curation().lots[0], id: "LOT_OTHER", rows: [], retired: [] }] }), /LOT_OTHER: anchor .* lies on a lot another curation took/);
});

test("an uncurated row on curated ground is an error, so nothing is drawn twice", () => {
  // the curated row sits over the second seeded lot too
  const over = curation({ rows: [curatedRow({ backLine: { abs: [[100, 0], [110, 0]] } })] });
  assert.throws(() => applyCuration(twoLots(), over), /LOT_E100_N\d+\/R1 lies on curated row LOT_KEEP\/R7/);
});

test("the photo grades a curated row but cannot rewrite the person's reading; a T1 row the photo refutes stops the seed", () => {
  const painted = { line: () => ({ visible: 1, contrast: 40, offsetM: 0 }), blue: () => ({ visible: 1, share: 1 }) };
  const [row] = applyCuration(twoLots(), curation(), { photo: painted }).lots.find((l) => l.id === "LOT_KEEP").rows;
  assert.equal(row.evidence.photoSupport, 1);
  assert.equal(row.evidence.tier, "T1");
  const bare = { ...painted, line: () => ({ visible: 1, contrast: 0, offsetM: 0 }) };
  assert.throws(() => applyCuration(twoLots(), curation(), { photo: bare }), /LOT_KEEP\/R7: curated T1 but photoSupport 0/);
  const hidden = { ...painted, line: () => ({ visible: 0, contrast: null, offsetM: 0 }) };
  const [shade] = applyCuration(twoLots(), curation(), { photo: hidden }).lots.find((l) => l.id === "LOT_KEEP").rows;
  assert.equal(shade.evidence.photoSupport, null, "hidden is no evidence, not a refutation");
  assert.equal(shade.evidence.tier, "T1");
});

test("the curation file's validator names malformed records", () => {
  const errors = (doc) => validate("parkingCuration", doc).errors.join(" | ");
  assert.equal(errors(curation({ rows: [curatedRow({ paintBack: true, paintFront: true })] })), "");
  assert.match(errors({}), /lots must be an array/);
  assert.match(errors(curation({ anchor: [1] })), /LOT_KEEP: anchor must be an \[E, N\] pair/);
  assert.match(errors(curation({ anchor: [1, "2"] })), /anchor must be/);
  assert.match(errors(curation({ curated: 3 })), /LOT_KEEP: curated must name the todo/);
  assert.match(errors(curation({ retired: "R1" })), /LOT_KEEP: retired must be an array of ids/);
  assert.match(errors(curation({ retired: ["LOT_KEEP/R7"] })), /LOT_KEEP\/R7 is retired and cannot be used again/);
  assert.match(errors(curation({ rows: [curatedRow({ id: "LOT_OTHER/R1" })] })), /row id must start with LOT_KEEP\//);
  assert.match(errors(curation({ rows: "x" })), /rows must be an array/);
  assert.match(errors(curation({ rows: [curatedRow({ pitchM: 1 })] })), /pitchM 1 m is under 2 m/);
  assert.match(errors({ lots: [curation().lots[0], curation().lots[0]] }), /LOT_KEEP: id repeats/);
  assert.match(errors(curation({ id: "lot keep" })), /id must match/);
});

test("parallel stalls are graded on their lines, not on blue paint they do not have", () => {
  const photo = { line: () => ({ visible: 1, contrast: 40, offsetM: 0 }), blue: () => ({ visible: 1, share: 0 }) };
  const stalls = [{ id: "LOT_KEEP/R7/S0", index: 0, kind: "parallel" }, { id: "LOT_KEEP/R7/S1", index: 1, kind: "parallel" }];
  const [row] = applyCuration(twoLots(), curation({ rows: [curatedRow({ count: 3, pitchM: 5, depthM: 2.1, stalls })] }), { photo }).lots.find((l) => l.id === "LOT_KEEP").rows;
  assert.equal(row.evidence.photoSupport, 1);
});

// ---- gate review of ce1b649c, B1: a value read by eye carries its own flag, or the row cannot be T1
const curationErrors = (row) => validate("parkingCuration", curation({ rows: [curatedRow(row)] })).errors.join(" | ");
const bothLines = { paintBack: true, paintFront: true };
const why = { reason: "read on the VR" };

test("a curated T1 row must flag a depth no pair of painted lines bounds", () => {
  assert.match(curationErrors({ paintFront: true }), /LOT_KEEP\/R7: depthM is not bounded by two painted lines: flag it in estimatedFields/);
  assert.match(curationErrors({}), /depthM is not bounded/);
  assert.equal(curationErrors(bothLines), "");
  assert.equal(curationErrors({ paintFront: true, estimatedFields: { depthM: why } }), "");
  assert.equal(curationErrors({ stalls: [{ id: "LOT_KEEP/R7/S0", index: 0, kind: "accessible" }] }), "", "a filled bay's own border bounds it");
  assert.equal(curationErrors({ estimated: true, evidence: { tier: "T2", refs: ["hand"] } }), "", "a row marked estimated needs no field flag");
});

test("a curated T1 row must flag its wheel stops: they are read on the VR, not measured on the photo", () => {
  const wheelStops = { offsetFromBackM: 0.1, lengthM: 0.7, every: 1 };
  assert.match(curationErrors({ ...bothLines, wheelStops }), /LOT_KEEP\/R7: wheelStops are read on the VR: flag them in estimatedFields/);
  assert.equal(curationErrors({ ...bothLines, wheelStops, estimatedFields: { wheelStops: why } }), "");
});

test("a ref that calls a value an estimate, read by eye or seen in part needs a flag", () => {
  for (const ref of ["depth is an estimate", "depth from R1 (추정)", "stops read by eye", "the back rail seen only at 5.7-7.5 m", "the back rail seen from 5 m on"]) {
    assert.match(curationErrors({ ...bothLines, evidence: { tier: "T1", refs: [ref] } }), /refs call a value estimated or partly seen: flag it in estimatedFields/, ref);
    assert.equal(curationErrors({ ...bothLines, evidence: { tier: "T1", refs: [ref] }, estimatedFields: { paintBack: why } }), "", ref);
  }
});

test("estimatedFields names real fields of the row, each with its reason", () => {
  const errors = (estimatedFields, over = bothLines) => validate("parking", { lots: [{ id: "LOT_KEEP", rows: [curatedRow({ ...over, estimatedFields })] }] }).errors.join(" | ");
  assert.equal(errors({ paintBack: { reason: "seen in part", seenM: [5, 9] } }), "");
  assert.match(errors("depthM"), /estimatedFields must be an object/);
  assert.match(errors(["depthM"]), /estimatedFields must be an object/);
  assert.match(errors({ pitchM: why }), /estimatedFields\.pitchM is not a field that can be flagged/);
  assert.match(errors({ depthM: {} }), /estimatedFields\.depthM needs a reason/);
  assert.match(errors({ depthM: "x" }), /estimatedFields\.depthM needs a reason/);
  assert.match(errors({ paintBack: { reason: "x", seenM: [9, 5] } }), /estimatedFields\.paintBack\.seenM must be \[from, to\]/);
  assert.match(errors({ paintBack: { reason: "x", seenM: [5] } }), /seenM must be/);
  assert.match(errors({ depthM: { reason: "x", seenM: [1, 2] } }), /seenM is only for an end line/);
  assert.match(errors({ wheelStops: why }), /estimatedFields\.wheelStops flags a value the row does not have/);
  assert.match(errors({ paintFront: why }, {}), /estimatedFields\.paintFront flags a value the row does not have/);
});

test("a curated list of estimated dividers cannot clear one the photo sees without paint; one the mask hides it may", () => {
  // divider 1 stands at E = 2.5
  const at = (read) => ({ line: ({ from }) => (Math.abs(from[0] - 2.5) < 0.01 ? read : { visible: 1, contrast: 40, offsetM: 0 }), blue: () => ({ visible: 1, share: 1 }) });
  const list = (estimatedDividers) => curation({ rows: [curatedRow({ estimatedDividers })] });
  const bare = at({ visible: 1, contrast: 3, offsetM: 0 });
  assert.throws(() => applyCuration(twoLots(), list([]), { photo: bare }), /LOT_KEEP\/R7: estimatedDividers leaves out divider 1, which the photo sees without paint/);
  const kept = applyCuration(twoLots(), list([1]), { photo: bare }).lots.find((l) => l.id === "LOT_KEEP").rows[0];
  assert.deepEqual(kept.estimatedDividers, [1]);
  const hidden = applyCuration(twoLots(), list([]), { photo: at({ visible: 0, contrast: null, offsetM: 0 }) }).lots.find((l) => l.id === "LOT_KEEP").rows[0];
  assert.deepEqual(hidden.estimatedDividers, [], "the person read what the mask hides");
});

test("the real curation passes those rules and its flags reach parking.json", () => {
  const load = (name) => JSON.parse(readFileSync(new URL(`../data/ground/${name}.json`, import.meta.url), "utf8"));
  const real = load("parking-curation");
  assert.deepEqual(validate("parkingCuration", real).errors, []);
  const seeded = new Map(load("parking").lots.flatMap((l) => l.rows).map((r) => [r.id, r]));
  const flagged = real.lots.flatMap((l) => l.rows).filter((r) => r.estimatedFields);
  assert.ok(flagged.length > 0, "nothing flagged");
  for (const row of flagged) assert.deepEqual(seeded.get(row.id).estimatedFields, row.estimatedFields, row.id);
});

import assert from "node:assert/strict";
import test from "node:test";

import { assertLotsOnParcels, describeParking, estimatedValueReport, implausibleStalls, parkingPlan, rowLayout, symbolPieceReport } from "./parking.mjs";

const identity = (E, N) => [E, N];
// A row along +E from (0, 0): side -1 is the right of the axis, so the stalls run south.
const row = (over = {}) => ({
  id: "LOT_A/R1", backLine: { abs: [[0, 0], [25, 0]] }, side: -1, pitchM: 2.5, depthM: 5, startOffsetM: 0, count: 11,
  divider: { style: "single", widthM: 0.1, colour: "white" }, endCaps: true, stalls: [], wheelStops: null, entryFrom: "aisle",
  evidence: { tier: "T1", refs: ["test"], photoSupport: 1 }, estimated: false, ...over,
});
const doc = (rows, extra = {}) => ({ lots: [{ id: "LOT_A", parcel: "PARCEL_A", rows, ...extra }] });
const plan = (rows, extra) => parkingPlan(doc(rows, extra), { toScene: identity });
const xs = (piece) => piece.rings[0].map((p) => p[0]);
const ys = (piece) => piece.rings[0].map((p) => p[1]);
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);

test("row geometry: dividers every pitch, depth towards the row's side, the given width", () => {
  const { pieces } = plan([row()]);
  const dividers = pieces.filter((p) => p.kind === "parking_line");
  assert.equal(dividers.length, 11);
  near(Math.min(...xs(dividers[3])), 7.45, "divider 3 west edge");
  near(Math.max(...xs(dividers[3])), 7.55, "divider 3 east edge");
  near(Math.max(...ys(dividers[3])), 0, "back end on the back line");
  near(Math.min(...ys(dividers[3])), -5, "depth runs to the right of the axis");
  assert.equal(dividers[3].id, "LOT_A/R1/D3");
  assert.equal(dividers[3].record, "LOT_A/R1");
  near(Math.max(...ys(plan([row({ side: 1 })]).pieces[0])), 5, "side +1 is left of the axis");
});

test("a count of null fits the back line from the start offset", () => {
  assert.equal(rowLayout(row({ count: null, startOffsetM: 1 })).dividers.length, 10);
});

test("a skewed row keeps its dividers on the recorded bearing", () => {
  const { pieces } = plan([row({ dividerBearingDeg: 225, depthM: Math.SQRT2 * 5, count: 2 })]);
  near(Math.min(...ys(pieces[0])), -5, "depth along the bearing; the ends stay parallel to the back line");
  assert.ok(Math.min(...xs(pieces[0])) < -4.9, "the divider leans west");
});

test("an accessible bay is a member at its index: it pushes the next divider and owns its fill and symbol", () => {
  const stalls = [{ id: "LOT_A/R1/S2", index: 2, kind: "accessible", widthM: 3.3, aisle: null, symbol: "wheelchair" }];
  const layout = rowLayout(row({ stalls }));
  assert.deepEqual(layout.dividers.slice(1, 5).map((d) => Number(d.s.toFixed(3))), [2.5, 5, 8.3, 10.8]);
  const { pieces } = plan([row({ stalls })]);
  const fill = pieces.find((p) => p.colour === "blue");
  near(Math.min(...xs(fill)), 5.1, "fill insets 0.1 m from the divider");
  near(Math.max(...xs(fill)), 8.2, "fill insets 0.1 m from the next divider");
  assert.equal(fill.kind, "disabled_parking");
  assert.equal(fill.record, "LOT_A/R1/S2");
  const border = pieces.find((p) => p.glyph === "border");
  assert.equal(border.rings.length, 2, "the white border is a ring with a hole");
  const symbol = pieces.filter((p) => p.glyph === "wheelchair");
  assert.ok(symbol.length >= 4, "the template has its head, body, arm and wheel");
  assert.ok(symbol.every((p) => p.record === "LOT_A/R1/S2"));
  const all = symbol.flatMap((p) => p.rings[0]);
  const c = all.reduce((a, q) => [a[0] + q[0] / all.length, a[1] + q[1] / all.length], [0, 0]);
  assert.ok(c[0] > 5.5 && c[0] < 7.9 && c[1] < -1 && c[1] > -4, "the symbol sits in its own bay");
});

test("no symbol, fill or hatch without a record", () => {
  const { pieces } = plan([row({ stalls: [{ id: "LOT_A/R1/S1", index: 1, kind: "general" }, { id: "LOT_A/R1/S2", index: 2, kind: "accessible", symbol: null, aisle: null }] })]);
  assert.equal(pieces.filter((p) => ["wheelchair", "P", "scooter", "aisle"].includes(p.glyph)).length, 0);
  assert.equal(pieces.filter((p) => p.colour === "blue").length, 1, "the accessible stall keeps its fill, the general one has none");
  assert.deepEqual(symbolPieceReport(pieces).unrecorded, 0);
});

test("the hatched aisle is drawn only where the bay records one, on the recorded side", () => {
  const stall = { id: "LOT_A/R1/S2", index: 2, kind: "accessible", widthM: 3.3, symbol: "wheelchair", aisle: { side: "end", widthM: 1.2 } };
  const hatch = plan([row({ stalls: [stall] })]).pieces.filter((p) => p.glyph === "aisle");
  assert.ok(hatch.length > 1);
  for (const p of hatch) assert.ok(Math.min(...xs(p)) >= 7.0 - 1e-6 && Math.max(...xs(p)) <= 8.3 + 1e-6, "inside the end side of the bay");
});

test("the symbol's top points to the back unless the record reads a bearing", () => {
  const top = (stall) => {
    const parts = plan([row({ stalls: [{ id: "LOT_A/R1/S0", index: 0, kind: "accessible", widthM: 3.3, aisle: null, ...stall }] })]).pieces.filter((p) => p.glyph === stall.symbol);
    const head = parts[0].rings[0];
    const all = parts.flatMap((p) => p.rings[0]);
    const mean = (r) => r.reduce((a, q) => [a[0] + q[0] / r.length, a[1] + q[1] / r.length], [0, 0]);
    return [mean(head)[0] - mean(all)[0], mean(head)[1] - mean(all)[1]];
  };
  assert.ok(top({ symbol: "wheelchair" })[1] > 0.1, "north, towards the back line");
  assert.ok(top({ symbol: "wheelchair", upBearingDeg: 180 })[1] < -0.1, "a read bearing wins");
});

test("wheel stops belong to the row: one per stall, parallel to it, at the offset from the back", () => {
  const { wheelStops } = plan([row({ count: 3, wheelStops: { offsetFromBackM: 0.7, lengthM: 1.6, colour: "#d9b43a", every: 1 } })]);
  assert.equal(wheelStops.length, 2);
  assert.deepEqual(wheelStops[1].centre, [3.75, -0.7]);
  assert.deepEqual(wheelStops[1].u, [1, 0]);
  assert.equal(wheelStops[1].colour, "#d9b43a");
  assert.equal(wheelStops[1].record, "LOT_A/R1");
  assert.equal(plan([row()]).wheelStops.length, 0);
});

test("the end lines and the outer dividers follow the record", () => {
  const line = plan([row({ count: 3, paintBack: true, paintFront: true })]).pieces.filter((p) => p.glyph === "end_line");
  assert.equal(line.length, 2);
  near(Math.min(...xs(line[0])), 0, "line starts at the first divider");
  near(Math.max(...xs(line[0])), 5, "line ends at the last divider");
  assert.equal(plan([row({ count: 3, endCaps: false })]).pieces.filter((p) => p.kind === "parking_line").length, 1);
});

test("divider styles add their tails", () => {
  const count = (style) => plan([row({ count: 2, divider: { style, widthM: 0.1, colour: "white" } })]).pieces.length;
  assert.equal(count("single"), 2);
  assert.equal(count("double"), 4);
  assert.equal(count("T"), 4);
  assert.equal(count("U"), 6);
});

test("estimated dividers and free lines carry their record", () => {
  const { pieces, rows } = plan([row({ count: 3, estimatedDividers: [1] })], { lines: [{ id: "LOT_A/L1", abs: [[0, 10], [0, 30]], widthM: 0.1, colour: "yellow", evidence: { tier: "T1", refs: ["MK1"] } }, { id: "LOT_A/L2", ring: [[0, 0], [1, 0], [1, 1]], colour: "white", evidence: { tier: "T1", refs: ["MK2"] } }] });
  assert.deepEqual(pieces.filter((p) => p.kind === "parking_line" && p.record === "LOT_A/R1").map((p) => p.estimated), [false, true, false]);
  const line = pieces.find((p) => p.record === "LOT_A/L1");
  assert.equal(line.colour, "yellow");
  near(Math.max(...ys(line)), 30, "line end");
  assert.equal(pieces.find((p) => p.record === "LOT_A/L2").rings[0].length, 3);
  assert.deepEqual(rows[0], { lot: "LOT_A", row: "LOT_A/R1", dividers: 3, estimatedDividers: 1, specialStalls: 0, wheelStops: 0, photoSupport: 1, tier: "T1" });
});

test("a wall anchor without a resolver names the row", () => {
  assert.throws(() => plan([row({ backLine: { anchor: { building: "BLD_X", wall: "W1", s0M: 0, s1M: 10, tM: 1 } } })]), /LOT_A\/R1: .*anchor/);
  const resolved = parkingPlan(doc([row({ backLine: { anchor: { building: "BLD_X", wall: "W1", s0M: 0, s1M: 10, tM: 1 } }, count: 2 })]), { toScene: identity, resolveAnchor: () => [[0, 1], [10, 1]] });
  near(Math.max(...ys(resolved.pieces[0])), 1, "the anchor's line is the back line");
});

test("an invalid file throws naming the row, a lot off the parcels throws naming the lot", () => {
  assert.throws(() => plan([row({ pitchM: -1 })]), /LOT_A\/R1: pitchM/);
  assert.throws(() => assertLotsOnParcels(doc([row()]), [{ id: "PARCEL_B" }]), /LOT_A: parcel PARCEL_A/);
  assert.doesNotThrow(() => assertLotsOnParcels(doc([row()]), [{ id: "PARCEL_A" }]));
  assert.throws(() => assertLotsOnParcels({ lots: [{ id: "LOT_B", parcel: null, rows: [] }] }, []), /LOT_B: parcel null/);
});

test("symbolPieceReport counts symbols by record and flags any without one", () => {
  const report = symbolPieceReport([
    { kind: "disabled_parking", glyph: "wheelchair", record: "LOT_A/R1/S0" },
    { kind: "disabled_parking", glyph: "aisle", record: "LOT_A/R1/S0" },
    { kind: "disabled_parking", glyph: "scooter" },
    { kind: "lane_line_solid" },
  ]);
  assert.deepEqual(report.byGlyph, { wheelchair: 1, aisle: 1, scooter: 1 });
  assert.equal(report.unrecorded, 1);
  assert.deepEqual(report.records, ["LOT_A/R1/S0"]);
});

test("implausibleStalls names the rows with stalls too narrow, or general stalls too wide, to be one stall", () => {
  const list = implausibleStalls(doc([
    row({ stalls: [{ id: "LOT_A/R1/S2", index: 2, kind: "general", widthM: 0.68 }, { id: "LOT_A/R1/S3", index: 3, kind: "general", widthM: 4.2 }, { id: "LOT_A/R1/S4", index: 4, kind: "accessible", widthM: 4.2 }] }),
    row({ id: "LOT_A/R2", pitchM: 1.09, divider: { style: "none" }, stalls: [] }),
  ]));
  assert.deepEqual(list.filter((x) => x.row === "LOT_A/R1").map((x) => [x.index, x.widthM]), [[2, 0.68], [3, 4.2]]);
  assert.ok(list.some((x) => x.row === "LOT_A/R2" && x.widthM === 1.09));
  assert.deepEqual(implausibleStalls(doc([row()])), []);
});

test("a bay with a P figure draws the P at its side and the wheelchair in the rest, each with its own bearing", () => {
  const stall = { id: "LOT_A/R1/S0", index: 0, kind: "accessible", widthM: 3, symbol: "wheelchair", upBearingDeg: 90, figure: { symbol: "P", side: "start", upBearingDeg: 90 } };
  const { pieces } = plan([row({ count: 2, pitchM: 6, stalls: [stall], backLine: { abs: [[0, 0], [6, 0]] } })]);
  const of = (glyph) => pieces.filter((p) => p.glyph === glyph).flatMap((p) => p.rings.flat());
  assert.ok(of("P").length > 0, "the P is drawn");
  assert.ok(of("wheelchair").length > 0, "the wheelchair is drawn");
  const midE = (pts) => pts.reduce((n, p) => n + p[0], 0) / pts.length;
  assert.ok(midE(of("P")) < 1.5, `the P lies in the start half: ${midE(of("P"))}`);
  assert.ok(midE(of("wheelchair")) > 1.5, `the wheelchair lies in the other half: ${midE(of("wheelchair"))}`);
});

test("a figure that is neither scooter nor P is refused", () => {
  const stall = { index: 0, kind: "accessible", widthM: 3, figure: { symbol: "Q", side: "start" } };
  assert.throws(() => plan([row({ count: 2, stalls: [stall] })]), /figure needs symbol scooter or P/);
});

const stops = { offsetFromBackM: 0.7, lengthM: 1.6, colour: "#d9b43a", every: 1 };
test("a flagged depth marks the row's dividers, not its measured end line, and keeps the row's tier", () => {
  const { pieces, rows } = plan([row({ count: 2, paintFront: true, estimatedFields: { depthM: { reason: "from the next row" } } })]);
  const by = (suffix) => pieces.find((p) => p.id === `LOT_A/R1/${suffix}`);
  assert.equal(by("D0").estimated, true);
  assert.deepEqual(by("D0").estimatedFields, ["depthM"]);
  assert.equal(by("front").estimated, false);
  assert.equal(by("front").estimatedFields, undefined);
  assert.equal(rows[0].tier, "T1");
  assert.equal(rows[0].estimatedValues, 1);
});

test("a flagged end line and flagged wheel stops carry the flag; unflagged ones do not", () => {
  const { pieces, wheelStops } = plan([row({ count: 2, paintBack: true, paintFront: true, wheelStops: stops, estimatedFields: { paintBack: { reason: "seen in part", seenM: [5, 7] }, wheelStops: { reason: "VR" } } })]);
  const back = pieces.find((p) => p.id === "LOT_A/R1/back");
  assert.equal(back.estimated, true);
  assert.deepEqual(back.estimatedFields, ["paintBack"]);
  assert.equal(pieces.find((p) => p.id === "LOT_A/R1/front").estimated, false);
  assert.equal(pieces.find((p) => p.id === "LOT_A/R1/D0").estimated, false);
  assert.equal(wheelStops[0].estimated, true);
  assert.equal(plan([row({ count: 2, wheelStops: stops })]).wheelStops[0].estimated, false);
});

test("a flag changes no geometry", () => {
  const rings = (p) => p.pieces.map((x) => x.rings);
  const over = { count: 3, paintBack: true, paintFront: true, wheelStops: stops };
  const flags = { depthM: { reason: "x" }, paintBack: { reason: "x", seenM: [1, 2] }, wheelStops: { reason: "x" } };
  assert.deepEqual(rings(plan([row({ ...over, estimatedFields: flags })])), rings(plan([row(over)])));
});

test("estimatedValueReport names every row with an estimated value, for the GLB extras", () => {
  const flags = { depthM: { reason: "from the next row" } };
  const report = estimatedValueReport(doc([row({ estimatedFields: flags, estimatedDividers: [1] }), row({ id: "LOT_A/R2" }), row({ id: "LOT_A/R3", estimated: true, evidence: { tier: "T2", refs: ["t"] } })]));
  assert.deepEqual(report, {
    "LOT_A/R1": { tier: "T1", estimated: false, dividers: [1], fields: flags },
    "LOT_A/R3": { tier: "T2", estimated: true, dividers: [], fields: {} },
  });
});

test("the build log counts the flagged values", () => {
  assert.match(describeParking(plan([row({ count: 2, paintBack: true, estimatedFields: { paintBack: { reason: "x" } } })])), /1 추정 값/);
});

import assert from "node:assert/strict";
import test from "node:test";
import * as compare from "./mapCompare.mjs";

const reference = {
  segments: [
    { id: "RD_A", expected: true, refs: ["aerial A"] },
    { id: "RD_B", expected: false, refs: ["aerial B"] },
    { id: "RD_C", expected: true, refs: ["VR C"] },
  ],
  crossings: [
    { id: "CW_A", expected: true, barIds: ["A/0", "A/1"], refs: ["aerial A crossing"] },
  ],
};
const generated = {
  segmentIds: ["RD_A", "RD_C"],
  crossings: [{ id: "CW_A", barIds: ["A/0", "A/1"] }],
};

test("independent segment labels distinguish missing, extra and correct absence", () => {
  const result = compare.compareRoadInventory(reference, {
    segmentIds: ["RD_A", "RD_B"],
    crossings: generated.crossings,
  });
  assert.deepEqual(result.segments.counts, { tp: 1, tn: 0, fp: 1, fn: 1, unknown: 0 });
  assert.equal(result.segments.accuracy, 1 / 3);
  assert.equal(result.segments.precision, 0.5);
  assert.equal(result.segments.recall, 0.5);
  assert.equal(result.segments.pass, false);
  assert.deepEqual(result.segments.rows.filter(r => r.over).map(r => r.id), ["RD_B", "RD_C"]);
});

test("segment acceptance uses the inclusive .95 boundary without rounding", () => {
  const segments = Array.from({ length: 1000 }, (_, i) => ({ id: `RD_${i}`, expected: true, refs: ["aerial"] }));
  for (const [count, pass] of [[950, true], [949, false]]) {
    const result = compare.compareRoadInventory({ segments, crossings: [] }, {
      segmentIds: segments.slice(0, count).map(r => r.id), crossings: [],
    });
    assert.equal(result.segments.accuracy, count / 1000);
    assert.equal(result.segments.pass, pass);
  }
});

test("unknown labels and missing reference evidence cannot become acceptance", () => {
  const result = compare.compareRoadInventory({
    segments: [
      { id: "RD_A", expected: null, refs: ["occluded"] },
      { id: "RD_C", expected: true, refs: [] },
    ],
    crossings: [{ id: "CW_A", expected: null, barIds: [], refs: ["occluded"] }],
  }, generated);
  assert.equal(result.segments.counts.unknown, 2);
  assert.equal(result.segments.denominator, 2);
  assert.equal(result.segments.accuracy, null);
  assert.equal(result.segments.lowerBound, 0);
  assert.equal(result.segments.pass, false);
  assert.equal(result.crossings.rows[0].status, "unknown");
  assert.equal(result.crossings.pass, false);
});

test("a documented out-of-scope candidate stays in the frozen acceptance denominator and the in-scope figure is a side metric", () => {
  const result = compare.compareRoadInventory({ ...reference, segments: [
    ...reference.segments.filter(r => r.id !== "RD_B"),
    { id: "RD_X", expected: true, refs: ["aerial X"], scope: { inScope: false, refs: ["design: context ground"], reason: "outside the export extent" } },
  ] }, generated);
  assert.deepEqual(result.segments.counts, { tp: 2, tn: 0, fp: 0, fn: 1, unknown: 0 });
  assert.equal(result.segments.denominator, 3);
  assert.equal(result.segments.lowerBound, 2 / 3);
  assert.equal(result.segments.pass, false);
  assert.equal(result.segments.frozen, undefined);
  assert.deepEqual(result.segments.outOfScope, ["RD_X"]);
  assert.deepEqual(result.segments.inScope, { denominator: 2, counts: { tp: 2, tn: 0, fp: 0, fn: 0, unknown: 0 }, lowerBound: 1 });
  assert.deepEqual(result.segments.rows.find(r => r.id === "RD_X"), { id: "RD_X", status: "out-of-scope", frozenStatus: "fn", over: false });
});

test("a scope exclusion without its own evidence is rejected", () => {
  assert.throws(() => compare.compareRoadInventory({ ...reference, segments: [
    { id: "RD_X", expected: true, refs: ["aerial X"], scope: { inScope: false, refs: [], reason: "" } },
  ] }, generated), /scope/);
});

test("dropping an entire crossing reports its independent id over tolerance", () => {
  const result = compare.compareRoadInventory(reference, { ...generated, crossings: [] });
  assert.deepEqual(result.crossings.rows.map(r => [r.id, r.status, r.over, r.missingBarIds]),
    [["CW_A", "missing", true, ["A/0", "A/1"]]]);
  assert.equal(result.crossings.pass, false);
});

test("dropping a crossing bar cannot pass through a retained crossing id", () => {
  const result = compare.compareRoadInventory(reference, {
    ...generated, crossings: [{ id: "CW_A", barIds: ["A/0"] }],
  });
  assert.equal(result.crossings.rows[0].status, "incomplete");
  assert.deepEqual(result.crossings.rows[0].missingBarIds, ["A/1"]);
  assert.equal(result.crossings.rows[0].over, true);
});

test("unreferenced generated segments and crossings remain visible failures", () => {
  const result = compare.compareRoadInventory(reference, {
    segmentIds: [...generated.segmentIds, "RD_EXTRA"],
    crossings: [...generated.crossings, { id: "CW_EXTRA", barIds: ["X/0"] }],
  });
  assert.equal(result.segments.denominator, 4);
  assert.deepEqual(result.segments.rows.at(-1), { id: "RD_EXTRA", status: "unreferenced", over: true });
  assert.equal(result.crossings.rows.at(-1).id, "CW_EXTRA");
  assert.equal(result.crossings.rows.at(-1).status, "unreferenced");
  assert.equal(result.crossings.pass, false);
});

test("matching inventories pass existence only, never claim geometric IoU", () => {
  const result = compare.compareRoadInventory(reference, generated);
  assert.equal(result.segments.pass, true);
  assert.equal(result.crossings.pass, true);
  assert.equal(result.crossings.rows[0].iou, null);
  assert.equal(result.crossings.rows[0].geometryAssessed, false);
});

test("empty segment references have no acceptance denominator", () => {
  const result = compare.compareRoadInventory({ segments: [], crossings: [] }, { segmentIds: [], crossings: [] });
  assert.equal(result.segments.accuracy, null);
  assert.equal(result.segments.pass, false);
});

test("crossing IoU .60 passes and .59 fails even when the centroid is aligned", () => {
  for (const [removed, expectedIou, over] of [[false, 0.6, false], [true, 0.59, true]]) {
    const white = new Uint8Array(14 * 14);
    for (let y = 4; y < 10; y += 1) for (let x = 2; x < 12; x += 1) white[y * 14 + x] = 1;
    if (removed) white[6 * 14 + 6] = 0;
    const [result] = compare.scoreObjects([{
      id: "bar", kind: "zebra_bar", colour: "white",
      geometry: { type: "area", rings: [[[0.5, 0.5], [3, 0.5], [3, 3], [0.5, 3]]] },
    }], { w: 14, h: 14, origin: [0, 3.5], gsdM: 0.25, paint: { white } });
    assert.equal(result.iou, expectedIou);
    assert.ok(result.residual_m < 0.01);
    assert.equal(result.over, over);
  }
});

test("duplicate independent labels cannot inflate existence accuracy", () => {
  const duplicate = { ...reference, segments: [...reference.segments, reference.segments[0]] };
  assert.throws(() => compare.compareRoadInventory(duplicate, generated), /duplicate.*RD_A/);
});

test("duplicate generated crossings cannot conceal an incomplete first result", () => {
  const duplicate = { ...generated, crossings: [{ id: "CW_A", barIds: ["A/0"] }, ...generated.crossings] };
  assert.throws(() => compare.compareRoadInventory(reference, duplicate), /duplicate.*CW_A/);
});

test("an observed crossing still fails deletion when its bar count is unmeasured", () => {
  const partial = { segments: [], crossings: [{ id: "CW_A", expected: true, barIds: [], refs: ["visible crossing, hidden end"] }] };
  const result = compare.compareRoadInventory(partial, { segmentIds: [], crossings: [] });
  assert.equal(result.crossings.rows[0].status, "missing");
  assert.equal(result.crossings.rows[0].over, true);
});

test("a retained crossing with unmeasured bars is incomplete evidence, never a pass", () => {
  const partial = { segments: [], crossings: [{ id: "CW_A", expected: true, barIds: [], refs: ["visible crossing, hidden end"] }] };
  const result = compare.compareRoadInventory(partial, { segmentIds: [], crossings: generated.crossings });
  assert.equal(result.crossings.rows[0].status, "unknown");
  assert.equal(result.crossings.pass, false);
});

test("unobserved crossing slots are neither proved absent nor accepted as measured bars", () => {
  const partial = { segments: [], crossings: [{
    id: "CW_A", expected: true, barIds: ["A/0"], unobservedBarIds: ["A/1"], refs: ["one visible bar; one hidden slot"],
  }] };
  for (const [barIds, status, over] of [
    [["A/0"], "unknown", false],
    [["A/0", "A/1"], "unknown", false],
    [["A/1"], "incomplete", true],
  ]) {
    const result = compare.compareRoadInventory(partial, { segmentIds: [], crossings: [{ id: "CW_A", barIds }] });
    assert.equal(result.crossings.rows[0].status, status);
    assert.equal(result.crossings.rows[0].over, over);
    assert.equal(result.crossings.pass, false);
  }
});

test("road acceptance requires complete references, ownership and measurable geometry, not only over=false", () => {
  const good = {
    referenceComplete: true, roadOwnership: { unassignedOwners: [] },
    roadExistence: { segments: { pass: true }, crossings: { pass: true } },
    objects: [
      { tier: "lane", residual_m: .1, support: 1, over: false, occluded: false },
      { tier: "crossing_bar", residual_m: .1, iou: .8, over: false, occluded: false },
    ],
    physicalCrossings: [{ iou: .8, over: false, occluded: false }],
  };
  assert.equal(compare.roadAcceptance(good).accepted, true);
  for (const patch of [
    { referenceComplete: false },
    { roadOwnership: { unassignedOwners: ["JA_unknown"] } },
    { physicalCrossings: [] },
    { physicalCrossings: [{ iou: null, over: false, occluded: true }] },
    { objects: good.objects.map(o => ({ ...o, unmeasurable: true })) },
    { roadExistence: { segments: { pass: true }, crossings: { pass: false } } },
  ]) assert.equal(compare.roadAcceptance({ ...good, ...patch }).accepted, false);
});

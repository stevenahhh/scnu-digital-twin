import assert from "node:assert/strict";
import test from "node:test";
import * as compare from "./mapCompare.mjs";

const section = "RS_0123456789abcdef";
const approach = "JA_fedcba9876543210";
const crossingId = `${approach}/crossing`;
const lineId = `${section}/centre`;
const piece = (objectId, ownerId, suffix) => ({
  objectId, ownerId, partId: `${objectId}/${suffix}`,
  id: "legacy-key-is-not-an-object-id",
});
const bars = [2, 4].map(i => piece(crossingId, approach, `${i}/part/0`));
const dashes = [0, 1].map(i => piece(lineId, section, `part/${i}`));
const bindings = [
  { ownerId: section, segmentId: "RD_001", verified: true, refs: ["reviewed road alignment"] },
  { ownerId: approach, segmentId: "RD_001", verified: true, refs: ["reviewed junction connection"] },
];

test("canonical parts group into logical lines and crossing bars without global indices", () => {
  const result = compare.roadObjectInventory([...bars, ...dashes, piece(crossingId, approach, "2/part/1")], bindings);
  assert.deepEqual(result.segmentIds, ["RD_001"]);
  assert.deepEqual(result.crossings, [{ id: crossingId, barIds: [`${crossingId}/2`, `${crossingId}/4`] }]);
  assert.deepEqual(result.objects.map(o => [o.id, o.ownerId, o.pieces.length]),
    [[crossingId, approach, 3], [lineId, section, 2]]);
  assert.deepEqual(result.unassignedOwners, []);
});

test("reordering pieces and adding an unrelated object preserves existing groups", () => {
  const other = "RS_aaaaaaaaaaaaaaaa";
  const input = [...bars, ...dashes];
  const result = compare.roadObjectInventory([piece(`${other}/edges/left`, other, "part/0"), ...input.toReversed()], bindings);
  const baseline = compare.roadObjectInventory(input, bindings);
  assert.deepEqual(result.objects.filter(o => o.ownerId !== other), baseline.objects);
  assert.deepEqual(result.crossings, baseline.crossings);
  assert.deepEqual(result.unassignedOwners, [other]);
});

test("an additional grid bar changes membership but not the logical crossing key", () => {
  const result = compare.roadObjectInventory([...bars, piece(crossingId, approach, "7/part/0")], bindings);
  assert.deepEqual(result.crossings, [{
    id: crossingId, barIds: [`${crossingId}/2`, `${crossingId}/4`, `${crossingId}/7`],
  }]);
});

test("RD reassignment changes only explicit ownership, never logical object ids", () => {
  const result = compare.roadObjectInventory(bars, [{ ...bindings[1], segmentId: "RD_074" }]);
  assert.deepEqual(result.segmentIds, ["RD_074"]);
  assert.equal(result.objects[0].id, crossingId);
});

test("dropping a crossing through the adapter fails without renumbering the remaining line", () => {
  const result = compare.compareRoadInventory({
    segments: [{ id: "RD_001", expected: true, refs: ["independent aerial"] }],
    crossings: [{ id: crossingId, expected: true, barIds: [`${crossingId}/2`, `${crossingId}/4`], refs: ["independent crossing"] }],
  }, compare.roadObjectInventory(dashes, bindings));
  assert.equal(result.segments.pass, true);
  assert.deepEqual(result.crossings.rows.map(r => [r.id, r.status, r.over]), [[crossingId, "missing", true]]);
});

test("an unassigned canonical owner prevents a false segment acceptance", () => {
  const result = compare.compareRoadInventory({
    segments: [{ id: "RD_001", expected: false, refs: ["observed absence"] }], crossings: [],
  }, compare.roadObjectInventory(bars, []));
  assert.equal(result.segments.accuracy, 1);
  assert.deepEqual(result.segments.unassignedOwners, [approach]);
  assert.equal(result.segments.pass, false);
});

test("legacy piece ids cannot substitute for canonical identity", () => {
  assert.throws(() => compare.roadObjectInventory([{ id: "RD_001/legacy", record: "old" }], []), /canonical identity/);
});

test("duplicate parts and inconsistent owner prefixes are rejected", () => {
  for (const [pieces, error] of [
    [[bars[0], bars[0]], /duplicate.*part/],
    [[{ ...bars[0], ownerId: section }], /owner/],
    [[{ ...bars[0], partId: `${lineId}/part/0` }], /part/],
    [[piece(crossingId, approach, "unknown/part/0")], /grid/],
  ]) assert.throws(() => compare.roadObjectInventory(pieces, bindings), error);
});

test("ambiguous explicit owner bindings are rejected instead of silently taking the last RD", () => {
  assert.throws(() => compare.roadObjectInventory(bars, [
    ...bindings, { ...bindings[1], segmentId: "RD_074" },
  ]), /duplicate.*owner/);
});

test("an estimated or evidence-free RD binding stays unassigned", () => {
  for (const binding of [
    { ownerId: approach, segmentId: "RD_074" },
    { ...bindings[1], verified: false },
    { ...bindings[1], refs: [] },
    { ...bindings[1], refs: [" "] },
  ]) {
    const result = compare.roadObjectInventory(bars, [binding]);
    assert.deepEqual(result.segmentIds, []);
    assert.deepEqual(result.unassignedOwners, [approach]);
    assert.equal(result.crossings[0].id, crossingId);
  }
});

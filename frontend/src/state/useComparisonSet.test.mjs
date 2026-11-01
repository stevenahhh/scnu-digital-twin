import assert from "node:assert/strict";
import test from "node:test";
import { COMPARISON_FULL, addToComparison, removeFromComparison } from "./useComparisonSet.mjs";

test("caps the set at three and refuses the fourth with a reason", () => {
  let ids = [];
  for (const id of ["BLD_C1", "BLD_E1", "BLD_A1"]) ids = addToComparison(ids, id).ids;
  const fourth = addToComparison(ids, "BLD_B2");
  assert.deepEqual(fourth.ids, ["BLD_C1", "BLD_E1", "BLD_A1"]);
  assert.equal(fourth.refused, COMPARISON_FULL);
});

test("dedupes an id that is already in the set", () => {
  const once = addToComparison(["BLD_C1"], "BLD_C1");
  assert.deepEqual(once.ids, ["BLD_C1"]);
  assert.equal(once.refused, null);
});

test("removes one item and keeps the order of the rest", () => {
  assert.deepEqual(removeFromComparison(["BLD_C1", "BLD_E1", "BLD_A1"], "BLD_E1"), ["BLD_C1", "BLD_A1"]);
});

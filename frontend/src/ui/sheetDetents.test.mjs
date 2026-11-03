import assert from "node:assert/strict";
import test from "node:test";
import { clampHeight, cycleDetent, detentHeights, nearestDetent, PEEK_HEIGHT, stepDetent } from "./sheetDetents.mjs";

const heights = detentHeights(844, 844);

test("detent heights: peek 96px, half 50 %, full = the sheet height", () => {
  assert.deepEqual(detentHeights(844, 800), { peek: PEEK_HEIGHT, half: 422, full: 800 });
});

test("a slow release snaps to the nearest detent", () => {
  assert.equal(nearestDetent(422 - 40, heights, -0.05), "half");
  assert.equal(nearestDetent(422 + 40, heights, 0.05), "half");
  assert.equal(nearestDetent(150, heights, 0), "peek");
  assert.equal(nearestDetent(700, heights, 0), "full");
});

test("a fast flick carries past the nearest detent", () => {
  assert.equal(nearestDetent(422 - 40, heights, -2), "peek");
  assert.equal(nearestDetent(422 + 40, heights, 2), "full");
});

test("heights are clamped between peek and full", () => {
  assert.equal(clampHeight(10, heights), 96);
  assert.equal(clampHeight(2000, heights), 844);
  assert.equal(clampHeight(300, heights), 300);
});

test("keyboard steps stop at the ends; a tap cycles back to peek from full", () => {
  assert.equal(stepDetent("peek", 1), "half");
  assert.equal(stepDetent("half", 1), "full");
  assert.equal(stepDetent("full", 1), "full");
  assert.equal(stepDetent("peek", -1), "peek");
  assert.equal(cycleDetent("half"), "full");
  assert.equal(cycleDetent("full"), "peek");
});

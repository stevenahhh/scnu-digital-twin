import assert from "node:assert/strict";
import test from "node:test";
import { guessedTextLanes, keepsDetectedDashes } from "./markingEvidenceFit.mjs";

test("a guessed word wider than a lane is drawn once per lane", () => {
  assert.equal(guessedTextLanes(2.4), 1);
  assert.equal(guessedTextLanes(4.4), 1);
  // ND_011 east of the central roundabout: worn text over two lanes was one 5.17 m wide word
  assert.equal(guessedTextLanes(5.17), 2);
  assert.equal(guessedTextLanes(9), 3);
});

test("a few dashes far shorter than the statute dash are drawn as the photo shows them", () => {
  // central roundabout ring (ND_006): two or three 1.1-1.6 m dashes per chain were drawn as 3 m statute dashes
  assert.equal(keepsDetectedDashes([1.1, 1.6], 3, null), true);
  assert.equal(keepsDetectedDashes([1.0, 1.2, 1.7], 3, null), true);
  // a measured period decides the pattern itself
  assert.equal(keepsDetectedDashes([1.1, 1.6], 3, 3.3), false);
  // worn pieces of real 3 m dashes keep the statute pattern
  assert.equal(keepsDetectedDashes([1.4, 2.6], 3, null), false);
  assert.equal(keepsDetectedDashes([], 3, null), false);
});

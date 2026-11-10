import assert from "node:assert/strict";
import test from "node:test";
import { guessedTextLanes } from "./markingEvidenceFit.mjs";

test("a guessed word wider than a lane is drawn once per lane", () => {
  assert.equal(guessedTextLanes(2.4), 1);
  assert.equal(guessedTextLanes(4.4), 1);
  // ND_011 east of the central roundabout: worn text over two lanes was one 5.17 m wide word
  assert.equal(guessedTextLanes(5.17), 2);
  assert.equal(guessedTextLanes(9), 3);
});

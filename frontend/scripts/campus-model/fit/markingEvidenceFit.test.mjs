import assert from "node:assert/strict";
import test from "node:test";
import { coversDetected, detectedDashLine, guessedTextLanes, keepsDetectedDashes, isHatchedZone } from "./markingEvidenceFit.mjs";

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

test("a laid dash pattern must paint every dash the photo shows", () => {
  // RD_035 / RD_109 lower lane line east of the central roundabout (MK00894, MK00893, MX00441): the 3 m / 5 m statute
  // pattern laid on these three 2.3 m dashes at about 6 m kept only the middle one
  const detected = [[0, 2.42], [5.69, 7.69], [12.1, 14.43]];
  assert.equal(coversDetected([[5.4, 8.4]], detected), false);
  assert.equal(coversDetected([[0, 1.7], [5.9, 8.2], [12.5, 14.43]], detected), true);
  // half of a dash painted is enough; less is not
  assert.equal(coversDetected([[0, 1.2]], [[0, 2.4]]), true);
  assert.equal(coversDetected([[0, 1.1]], [[0, 2.4]]), false);
});

test("dashes drawn as the photo shows them reach the seed one run each", () => {
  const line = detectedDashLine([[1, 2.2], [3.5, 4.6], [7, 8]], 10);
  assert.deepEqual(line.runs, [[1, 2.2], [3.5, 4.6], [7, 8]]);
  assert.deepEqual(line.paintRange, [1, 8]);
  // one dash as long as the line, from the start of each run: every run is painted whole
  assert.deepEqual(line.pattern, [10, 1]);
  assert.equal(line.phaseM, 0);
  // each run is one dash of the photo (the seed checks each one's ground)
  assert.equal(line.dashRuns, true);
  // a building or sidewalk cut stays a cut
  assert.deepEqual(detectedDashLine([[1, 2.2], [3.5, 4.6], [7, 8]], 10, [[0, 4], [7.5, 10]]).runs, [[1, 2.2], [3.5, 4], [7.5, 8]]);
});

test("a lone hatch outline wide enough to hold stripes is a hatched zone, a single stripe is not", () => {
  // MX00970 at the main gate: a 2.6 x 10.4 m traced median was painted as one solid yellow block
  assert.equal(isHatchedZone(10.38, 2.63), true);
  assert.equal(isHatchedZone(4.07, 1.85), true);
  // one rung of a ladder marking
  assert.equal(isHatchedZone(0.97, 0.2), false);
  assert.equal(isHatchedZone(6, 0.45), false);
});

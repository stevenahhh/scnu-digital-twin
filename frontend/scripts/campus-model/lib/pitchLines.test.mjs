import assert from "node:assert/strict";
import test from "node:test";
import { pitchRing, snapGoalToEndLine, trackPitchHalf } from "./pitchLines.mjs";

test("the pitch inside the main stadium track is the full 105 x 68 m field", () => {
  // 대운동장 (OSM way/366373753): oriented frame 98.3 x 62.8 m half extents
  assert.deepEqual(trackPitchHalf(98.3, 62.8), { length: 52.5, width: 34 });
  // a small track leaves a smaller field
  const small = trackPitchHalf(40, 30);
  assert.ok(small.width < 34 && small.length < 52.5 && small.width > 0);
});

test("a surveyed goal moves to the middle of the nearest end line and faces the pitch", () => {
  const pitch = { centre: [100, 50], axis: [1, 0], halfLength: 52.5 };
  // the south football goal of the survey: on the end line but 2.2 off the centre line
  const snapped = snapGoalToEndLine([152.1, 52.2], [pitch], 8);
  assert.deepEqual(snapped.mouth, [152.5, 50]);
  assert.deepEqual(snapped.inward, [-1, 0]);
  const other = snapGoalToEndLine([47, 49.9], [pitch], 8);
  assert.deepEqual(other.mouth, [47.5, 50]);
  assert.deepEqual(other.inward, [1, 0]);
});

test("a goal far from every end line keeps its surveyed place", () => {
  const futsal = { centre: [0, 0], axis: [0, 1], halfLength: 20 };
  assert.equal(snapGoalToEndLine([30, 20], [futsal], 8), null);
  assert.equal(snapGoalToEndLine([1, 22], [], 8), null);
  assert.deepEqual(snapGoalToEndLine([1.5, 22.2], [futsal], 8).mouth, [0, 20]);
});

test("the playing surface of a pitch is a rectangle along its axis (no tree stands inside it)", () => {
  assert.deepEqual(pitchRing({ centre: [10, 5], axis: [0, 1], halfLength: 20, halfWidth: 10 }), [[20, -15], [20, 25], [0, 25], [0, -15]]);
});

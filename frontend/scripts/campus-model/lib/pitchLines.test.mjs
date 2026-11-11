import assert from "node:assert/strict";
import test from "node:test";
import { TENNIS_COURT_HALF_M, TENNIS_COURT_OFFSET_M, courtOwner, pitchRing, playingSurfaces, snapGoalToEndLine, trackPitchHalf } from "./pitchLines.mjs";

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

test("a point inside a court area belongs to that court even when another label point is nearer", () => {
  const blue = { point: [0, 0], axis: [1, 0], area: { centre: [0, 0], halfLength: 14, halfWidth: 9 } };
  const green = { point: [0, 12], axis: [1, 0], area: { centre: [0, 20], halfLength: 20, halfWidth: 10.5 } };
  // (0, 8.5) lies 8.5 from the blue label and 3.5 from the green one, but inside the blue area only
  assert.equal(courtOwner([blue, green], [0, 8.5]), blue);
  assert.equal(courtOwner([blue, green], [0, 10]), green);
});

test("outside every court area a label without an area paints, else the nearest label", () => {
  const court = { point: [0, 0], axis: [0, 1], area: { centre: [0, 0], halfLength: 5, halfWidth: 5 } };
  const surround = { point: [40, 0], axis: [1, 0], area: null };
  assert.equal(courtOwner([court, surround], [7, 0]), surround, "the unbounded label takes the leftover");
  const other = { point: [30, 0], axis: [1, 0], area: { centre: [30, 0], halfLength: 2, halfWidth: 2 } };
  assert.equal(courtOwner([court, other], [10, 0]), court, "no unbounded label: the nearest one");
  assert.equal(courtOwner([court, other], [25, 0]), other);
  // labels without areas keep the nearest-label rule
  const a = { point: [0, 0], axis: [1, 0] };
  const b = { point: [10, 0], axis: [1, 0] };
  assert.equal(courtOwner([a, b], [6, 0]), b);
});

test("playing surfaces: a court area as drawn, the two tennis courts side by side, nothing for a lawn", () => {
  const area = { centre: [5, 1], halfLength: 14.45, halfWidth: 8.975 };
  assert.deepEqual(playingSurfaces([{ surface: "basketball", point: [4, 1], axis: [1, 0], area }]), [{ centre: [5, 1], axis: [1, 0], halfLength: 14.45, halfWidth: 8.975 }]);
  // tennis: centres TENNIS_COURT_OFFSET_M either side of the label across its axis; plan units of 2 per metre
  const tennis = playingSurfaces([{ surface: "tennis", point: [10, 0], axis: [0, 1], area: null }], 2);
  assert.deepEqual(tennis.map((c) => c.centre), [[10 + 2 * TENNIS_COURT_OFFSET_M, 0], [10 - 2 * TENNIS_COURT_OFFSET_M, 0]]);
  assert.ok(tennis.every((c) => c.halfLength === 2 * TENNIS_COURT_HALF_M.length && c.halfWidth === 2 * TENNIS_COURT_HALF_M.width && c.axis[1] === 1));
  assert.deepEqual(playingSurfaces([{ surface: "lawn", point: [0, 0], axis: [1, 0], area: null }]), []);
});

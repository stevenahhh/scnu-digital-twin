import assert from "node:assert/strict";
import test from "node:test";
import { cinematicProgress } from "./cinematicFlythrough.mjs";

test("default cinematic playback traverses the full route and honors explicit bounds", () => {
  const defaults = new URLSearchParams("cinematic=1&record=1");
  assert.equal(cinematicProgress(defaults, "from", 0), 0);
  assert.equal(cinematicProgress(defaults, "to", 1), 1);
  assert.equal(cinematicProgress(new URLSearchParams("to=0"), "to", 1), 0);
  assert.equal(cinematicProgress(new URLSearchParams("to=bad"), "to", 1), 1);
  assert.equal(cinematicProgress(new URLSearchParams("to=2"), "to", 1), 1);
});

import {
  CINEMATIC_ROUTE_LENGTH_METERS,
  CINEMATIC_WAYPOINTS,
  cinematicPose,
} from "./cinematicRoute.mjs";

const EXPECTED_LABELS = [
  "정문 외부 진입",
  "정문",
  "운동장 동측 진입",
  "운동장 상공",
  "운동장 서측",
  "기숙사",
  "서쪽 오르막",
  "공대 진입",
  "공대 3호관 서측",
  "캠퍼스 북서 선회",
  "공대 상단 훑기",
  "공대 1호관 우측",
  "공대 3호관 우측",
  "도서관",
  "생명대 접근",
  "생명대 하강",
];

function distanceMeters(start, end) {
  const latitudeRadians = ((start.latitude + end.latitude) / 2) * Math.PI / 180;
  const east = (end.longitude - start.longitude) * 111_320 * Math.cos(latitudeRadians);
  const north = (end.latitude - start.latitude) * 111_320;
  return Math.hypot(east, north);
}

test("drone route follows the requested campus road order", () => {
  assert.deepEqual(CINEMATIC_WAYPOINTS.map(({ label }) => label), EXPECTED_LABELS);
});

test("drone route approaches the main gate and ends approaching life sciences", () => {
  const start = cinematicPose(0);
  const end = cinematicPose(1);

  assert.equal(start.longitude, CINEMATIC_WAYPOINTS[0].longitude);
  assert.equal(start.latitude, CINEMATIC_WAYPOINTS[0].latitude);
  assert.ok(distanceMeters(end, CINEMATIC_WAYPOINTS.at(-1)) < 0.001);
  assert.ok(end.height < start.height);
  assert.ok(CINEMATIC_ROUTE_LENGTH_METERS > 1_000);
});

test("drone route passes every landmark without teleporting", () => {
  const poses = Array.from({ length: 1201 }, (_, index) => cinematicPose(index / 1200));
  for (const waypoint of CINEMATIC_WAYPOINTS) {
    const closest = Math.min(...poses.map((pose) => distanceMeters(pose, waypoint)));
    assert.ok(closest < 3, `${waypoint.label}: ${closest.toFixed(2)}m`);
  }
});

test("drone route maintains nearly constant ground speed and flight attitude", () => {
  const poses = Array.from({ length: 801 }, (_, index) => cinematicPose(index / 800));
  const microSteps = poses.slice(1).map((pose, index) => distanceMeters(poses[index], pose));
  const steps = Array.from({ length: 80 }, (_, index) => (
    microSteps.slice(index * 10, index * 10 + 10).reduce((sum, value) => sum + value, 0)
  ));
  const average = steps.reduce((sum, value) => sum + value, 0) / steps.length;

  assert.ok(Math.max(...steps) < average * 1.08);
  assert.ok(Math.min(...steps) > average * 0.92);
  assert.ok(poses.every((pose) => pose.height >= 115 && pose.height <= 145));
  assert.ok(poses.every((pose) => pose.pitchDegrees >= -42 && pose.pitchDegrees <= -28));
  assert.ok(poses[80].pitchDegrees > poses[0].pitchDegrees);
  assert.ok(poses.at(-1).pitchDegrees < poses[700].pitchDegrees);
  assert.ok(poses.every((pose) => Math.abs(pose.rollDegrees) <= 4));
});

test("drone route clamps progress beyond its endpoints", () => {
  assert.deepEqual(cinematicPose(-1), cinematicPose(0));
  assert.deepEqual(cinematicPose(2), cinematicPose(1));
});

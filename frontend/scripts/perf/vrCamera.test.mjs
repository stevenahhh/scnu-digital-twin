import assert from "node:assert/strict";
import test from "node:test";
import { bearingToDirection, columnToAngle, faceYaw, stationWorld } from "./lib/vrCamera.mjs";

test("faceYaw turns the scene yaw into the four horizontal face bearings", () => {
  assert.equal(faceYaw(306.9, "f"), 306.9);
  assert.equal(faceYaw(306.9, "r"), 36.9);
  assert.equal(faceYaw(306.9, "b"), 126.9);
  assert.equal(faceYaw(306.9, "l"), 216.9);
  assert.throws(() => faceYaw(306.9, "u"), /no horizontal bearing/);
});

test("bearingToDirection maps compass bearings to +x east, +z south", () => {
  assert.deepEqual(bearingToDirection(90), [1, 0, 0]);
  assert.deepEqual(bearingToDirection(180), [0, 0, 1]);
  assert.deepEqual(bearingToDirection(0), [0, 0, -1]);
});

test("columnToAngle follows column = 1024 + 1024 tan(a)", () => {
  assert.equal(columnToAngle(1024), 0);
  assert.equal(columnToAngle(2048), 45);
  assert.equal(columnToAngle(0), -45);
});

test("stationWorld adds the runtime offset and prefers refined positions", () => {
  assert.deepEqual(stationWorld({ station_x: 73.69, station_z: -266.37 }, { x: -10, z: 5 }), { x: 63.69, z: -261.37 });
  assert.deepEqual(
    stationWorld({ station_x: 1, station_z: 2, station_refined_x: 3, station_refined_z: 4 }, { x: 0, z: 0 }),
    { x: 3, z: 4 },
  );
});

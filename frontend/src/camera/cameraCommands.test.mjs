import assert from "node:assert/strict";
import test from "node:test";
import { ORBIT_LIMITS, panPositions, rotatePosition, zoomBy, zoomPosition } from "./cameraCommands.mjs";

const close = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, `${actual} vs ${expected}`));

test("zoom scales the distance to the target and stays inside the orbit limits", () => {
  close(zoomPosition([0, 0, 100], [0, 0, 0], 0.8), [0, 0, 80]);
  close(zoomPosition([0, 0, 100], [0, 0, 0], 10), [0, 0, ORBIT_LIMITS.maxDistance]);
  close(zoomPosition([0, 0, 40], [0, 0, 0], 0.1), [0, 0, ORBIT_LIMITS.minDistance]);
  close(zoomPosition([10, 10, 10], [10, 10, 10], 0.5), [10, 10, 10]);
});

test("rotation turns around the vertical axis through the target and keeps height and distance", () => {
  close(rotatePosition([10, 5, 0], [0, 0, 0], Math.PI / 2), [0, 5, -10]);
  const turned = rotatePosition([3, 7, 4], [1, 0, 1], 0.7);
  assert.ok(Math.abs(Math.hypot(turned[0] - 1, turned[2] - 1) - Math.hypot(2, 3)) < 1e-9);
  assert.equal(turned[1], 7);
});

test("pan moves position and target together along the ground-projected view", () => {
  const { position, target } = panPositions([0, 50, 100], [0, 0, 0], 0, 10);
  close(position, [0, 50, 90]);
  close(target, [0, 0, -10]);
  const side = panPositions([0, 50, 100], [0, 0, 0], 5, 0);
  close(side.target, [5, 0, 0]);
});

test("commands report start/end like a user orbit and refuse to run without controls", () => {
  const events = [];
  const vector = (x, y, z) => ({ x, y, z, set(nx, ny, nz) { Object.assign(this, { x: nx, y: ny, z: nz }); } });
  const controls = { object: { position: vector(0, 0, 100) }, target: vector(0, 0, 0), update: () => events.push("update"), dispatchEvent: (event) => events.push(event.type) };
  assert.equal(zoomBy(controls, 0.5), true);
  assert.deepEqual(events, ["start", "update", "end"]);
  assert.equal(controls.object.position.z, 50);
  assert.equal(zoomBy(null, 0.5), false);
});

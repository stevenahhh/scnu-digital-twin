import assert from "node:assert/strict";
import test from "node:test";
import { ORBIT_LIMITS, TILT_LIMITS, clearOrbitInertia, panPositions, rotatePosition, tiltPosition, zoomBy, zoomPosition } from "./cameraCommands.mjs";

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

test("tilt changes the polar angle around the target, keeps distance and heading, and stops at the orbit limits", () => {
  const start = [0, 100 * Math.cos(Math.PI / 4), 100 * Math.sin(Math.PI / 4)];
  const tilted = tiltPosition(start, [0, 0, 0], 0.2);
  assert.ok(Math.abs(Math.hypot(...tilted) - 100) < 1e-9);
  assert.ok(Math.abs(Math.atan2(Math.hypot(tilted[0], tilted[2]), tilted[1]) - (Math.PI / 4 + 0.2)) < 1e-9);
  assert.ok(Math.abs(tilted[0]) < 1e-9);
  const flat = tiltPosition(start, [0, 0, 0], 5);
  assert.ok(Math.abs(Math.atan2(Math.hypot(flat[0], flat[2]), flat[1]) - TILT_LIMITS.maxPolarAngle) < 1e-9);
  const top = tiltPosition(start, [0, 0, 0], -5);
  assert.ok(Math.abs(Math.atan2(Math.hypot(top[0], top[2]), top[1]) - TILT_LIMITS.minPolarAngle) < 1e-9);
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

test("clearOrbitInertia spends leftover damping once with damping off and restores it", () => {
  const seen = [];
  const controls = { enableDamping: true, update() { seen.push(this.enableDamping); } };
  assert.equal(clearOrbitInertia(controls), true);
  assert.deepEqual(seen, [false]);
  assert.equal(controls.enableDamping, true);
  assert.equal(clearOrbitInertia({ enableDamping: false, update() { throw new Error("no update without damping"); } }), false);
});

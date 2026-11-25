import assert from "node:assert/strict";
import test from "node:test";
import { CAMERA_WALL_MARGIN, createCameraArm, resolveArmLength } from "./buildingClearance.mjs";

// Hits are measured along the ray from the orbit target towards the camera; entering = the ray meets a front face.
test("a clear arm keeps the desired length", () => {
  assert.equal(resolveArmLength([], 80), 80);
  assert.equal(resolveArmLength([{ distance: 120, entering: true }], 80), 80);
});

test("a wall between target and camera pulls the camera in front of it", () => {
  assert.equal(resolveArmLength([{ distance: 50, entering: true }], 80), 50 - CAMERA_WALL_MARGIN);
});

test("leaving the target's own building does not block, the next building does", () => {
  const hits = [{ distance: 10, entering: false }, { distance: 40, entering: true }];
  assert.equal(resolveArmLength(hits, 80), 40 - CAMERA_WALL_MARGIN);
  // A gap narrower than the margin keeps the camera between the two walls.
  assert.equal(resolveArmLength([{ distance: 10, entering: false }, { distance: 10.4, entering: true }], 80), 10.2);
});

test("a camera inside the building it looks into is pushed out through the nearest wall behind it", () => {
  // The target sits inside a building whose wall is 12 units out; the camera zoomed in to 5.
  assert.equal(resolveArmLength([{ distance: 12, entering: false }], 5), 12 + CAMERA_WALL_MARGIN);
});

test("a wall very close to the target still leaves the camera on the target side", () => {
  assert.equal(resolveArmLength([{ distance: 0.6, entering: true }], 80), 0.3);
});

test("the arm restores the user's distance once the obstruction clears", () => {
  const arm = createCameraArm();
  assert.equal(arm.desired(80), 80);
  arm.placed(40); // a wall pulled the camera in
  assert.equal(arm.desired(40), 80, "orbiting at the pulled length keeps the wish");
  arm.placed(80);
  assert.equal(arm.desired(80), 80);
});

test("zooming or flying replaces the remembered distance", () => {
  const arm = createCameraArm();
  arm.desired(80);
  arm.placed(40);
  assert.equal(arm.desired(30), 30, "a zoom in while pulled becomes the new wish");
  arm.placed(30);
  assert.equal(arm.desired(120), 120);
});

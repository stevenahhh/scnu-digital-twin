import assert from "node:assert/strict";
import test from "node:test";
import { CAMERA_WALL_MARGIN, createCameraArm, resolveArmLength } from "./buildingClearance.mjs";

// Hits are measured along the ray from the orbit target towards the camera; entering = the ray meets a front face.
test("a clear arm keeps the desired length", () => {
  assert.equal(resolveArmLength([], 80), 80);
  assert.equal(resolveArmLength([{ distance: 120, entering: true }], 80), 80);
});

test("a building that only stands between target and camera leaves the camera where the user put it", () => {
  assert.equal(resolveArmLength([{ distance: 40, entering: true }, { distance: 55, entering: false }], 80), 80);
  const fromInside = [{ distance: 10, entering: false }, { distance: 40, entering: true }, { distance: 55, entering: false }];
  assert.equal(resolveArmLength(fromInside, 80), 80);
});

test("a camera inside a building moves out through the nearer wall", () => {
  const hits = [{ distance: 40, entering: true }, { distance: 90, entering: false }];
  assert.equal(resolveArmLength(hits, 45), 40 - CAMERA_WALL_MARGIN, "near the front wall: step back towards the target");
  assert.equal(resolveArmLength(hits, 85), 90 + CAMERA_WALL_MARGIN, "near the back wall: step out behind it");
  // No back wall within the search range: the front wall is the only way out.
  assert.equal(resolveArmLength([{ distance: 50, entering: true }], 80), 50 - CAMERA_WALL_MARGIN);
});

test("a gap narrower than the margin keeps the camera between the two walls", () => {
  const hits = [{ distance: 10, entering: false }, { distance: 10.4, entering: true }, { distance: 30, entering: false }];
  assert.equal(resolveArmLength(hits, 12), 10.2);
});

test("a camera inside the building it looks into is pushed out through the nearest wall behind it", () => {
  // The target sits inside a building whose wall is 12 units out; the camera zoomed in to 5.
  assert.equal(resolveArmLength([{ distance: 12, entering: false }], 5), 12 + CAMERA_WALL_MARGIN);
});

test("a wall very close to the target still leaves the camera on the target side", () => {
  assert.equal(resolveArmLength([{ distance: 0.6, entering: true }, { distance: 20, entering: false }], 3), 0.3);
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

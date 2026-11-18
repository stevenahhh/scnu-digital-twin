import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera } from "three";
import { CAMPUS_INITIAL_CAMERA } from "../camera/initialCamera.mjs";
import { fieldOriginInScene, initialPose, radialDistance, revealFrame, viewFromCamera, viewFromPose } from "./veilView.mjs";

const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);
const ORBITED = { position: [180, 140, -20], target: [40, 20, -120], fov: 50 };

test("before the scene exists the veil looks from the address camera, else from the campus's first camera", () => {
  assert.deepEqual(initialPose("?cam=180,140,-20,40,20,-120"), ORBITED);
  assert.deepEqual(initialPose("?tab=status"), { ...CAMPUS_INITIAL_CAMERA });
  assert.deepEqual(initialPose("?cam=1,2"), { ...CAMPUS_INITIAL_CAMERA });
});

test("rays built from a pose equal the rays of a three camera in that pose", () => {
  for (const pose of [CAMPUS_INITIAL_CAMERA, ORBITED]) {
    const camera = new PerspectiveCamera(pose.fov, 1.6, 0.1, 5000);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    const live = viewFromCamera(camera);
    const guessed = viewFromPose(pose, 1.6);
    for (const key of ["eye", "right", "up", "forward"]) assert.ok(near(live[key], guessed[key]), `${key} ${live[key]} vs ${guessed[key]}`);
    assert.ok(near([live.tanX, live.tanY], [guessed.tanX, guessed.tanY]));
  }
});

test("the reveal opens where the view axis meets the ground and its reach covers the screen corners", () => {
  const frame = revealFrame(viewFromPose(CAMPUS_INITIAL_CAMERA, 1.6), 24);
  assert.ok(near(frame.centre, [0, 24], 1e-3), `centre ${frame.centre}`);
  assert.equal(radialDistance(frame, frame.centre), 0);
  assert.ok(frame.maxR > 0.8 && frame.maxR < 0.9, `maxR ${frame.maxR}`);
  const gate = revealFrame(viewFromPose({ position: [240, 38, 15], target: [100, 4, -38], fov: 50 }, 1.6), 16);
  assert.equal(gate.maxR, 1);
});

// Measured in the running dashboard (2026-11-18): the recentring group of campus-v2.glb sits at (-260.536, 173.346).
test("the terrain grid starts where the scene draws the model's height origin", () => {
  const origin = fieldOriginInScene({ originX: -2, originZ: -376 });
  assert.ok(near(origin, [-262.536, -202.654], 2e-3), `origin ${origin}`);
});

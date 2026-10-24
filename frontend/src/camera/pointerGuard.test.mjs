import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMERA_SETTLE_MS,
  CLICK_MAX_DISTANCE_PX,
  CLICK_MAX_DURATION_MS,
  RELEASE_MATCH_MS,
  createPointerGuard,
  hasCameraMoved,
  isClickGesture,
} from "./pointerGuard.mjs";

function setup() {
  const clock = { t: 10_000 };
  const guard = createPointerGuard({ now: () => clock.t });
  const at = (pointerId, clientX, clientY) => ({ pointerId, clientX, clientY });
  return { clock, guard, at };
}

test("a click stays within the distance and duration thresholds (inclusive)", () => {
  const down = { x: 100, y: 100, time: 0 };
  assert.equal(isClickGesture(down, { x: 100, y: 100, time: 10 }), true);
  assert.equal(isClickGesture(down, { x: 100 + CLICK_MAX_DISTANCE_PX, y: 100, time: 10 }), true);
  assert.equal(isClickGesture(down, { x: 100 + CLICK_MAX_DISTANCE_PX + 1, y: 100, time: 10 }), false);
  assert.equal(isClickGesture(down, { x: 105, y: 105, time: 10 }), false);
  assert.equal(isClickGesture(down, { x: 100, y: 100, time: CLICK_MAX_DURATION_MS }), true);
  assert.equal(isClickGesture(down, { x: 100, y: 100, time: CLICK_MAX_DURATION_MS + 1 }), false);
  assert.equal(isClickGesture(null, { x: 0, y: 0, time: 0 }), false);
});

test("a plain press and release on the canvas is accepted by the mesh handler only", () => {
  const { clock, guard, at } = setup();
  guard.pointerDown(at(1, 200, 200), "canvas");
  clock.t += 80;
  guard.pointerMove(at(1, 202, 201));
  guard.pointerUp(at(1, 202, 201));
  assert.equal(guard.acceptClick({ pointerId: 1, origin: "canvas" }), true);
  assert.equal(guard.acceptClick({ pointerId: 1, origin: "label" }), false);
  assert.equal(guard.acceptClick({ pointerId: 2, origin: "canvas" }), false);
});

test("a drag that comes back to its start point is still a drag", () => {
  const { clock, guard, at } = setup();
  guard.pointerDown(at(1, 200, 200), "canvas");
  clock.t += 50;
  guard.pointerMove(at(1, 260, 200));
  assert.equal(guard.isDragging(), true);
  assert.equal(guard.isDragDriven(), true);
  guard.pointerMove(at(1, 200, 200));
  guard.pointerUp(at(1, 200, 200));
  assert.equal(guard.acceptClick({ pointerId: 1, origin: "canvas" }), false);
  assert.equal(guard.isDragging(), false);
});

test("a release that skipped pointermove is judged by its own position", () => {
  const { guard, at } = setup();
  guard.pointerDown(at(1, 200, 200), "label");
  guard.pointerUp(at(1, 240, 230));
  assert.equal(guard.acceptClick({ origin: "label" }), false);
});

test("a long press is not a click", () => {
  const { clock, guard, at } = setup();
  guard.pointerDown(at(1, 200, 200), "canvas");
  clock.t += CLICK_MAX_DURATION_MS + 1;
  guard.pointerUp(at(1, 200, 200));
  assert.equal(guard.acceptClick({ origin: "canvas" }), false);
});

test("a second finger turns the gesture into a drag (pinch)", () => {
  const { guard, at } = setup();
  guard.pointerDown(at(1, 200, 200), "canvas");
  guard.pointerDown(at(2, 300, 300), "canvas");
  guard.pointerUp(at(2, 300, 300));
  guard.pointerUp(at(1, 200, 200));
  assert.equal(guard.acceptClick({ pointerId: 1, origin: "canvas" }), false);
});

test("pointercancel and a stale release never count as clicks", () => {
  const { clock, guard, at } = setup();
  guard.pointerDown(at(1, 200, 200), "canvas");
  guard.pointerCancel();
  assert.equal(guard.acceptClick({ origin: "canvas" }), false);

  guard.pointerDown(at(1, 200, 200), "canvas");
  guard.pointerUp(at(1, 200, 200));
  clock.t += RELEASE_MATCH_MS + 1;
  assert.equal(guard.acceptClick({ origin: "canvas" }), false);
  assert.equal(guard.acceptClick(), false);
});

test("clicks during camera motion (fly-to, damping) and the settle window after it are ignored", () => {
  const { clock, guard, at } = setup();
  guard.noteCameraFrame(true);
  clock.t += 16;
  guard.pointerDown(at(1, 200, 200), "canvas");
  guard.pointerUp(at(1, 200, 200));
  assert.equal(guard.isCameraSettling(), true);
  assert.equal(guard.acceptClick({ origin: "canvas" }), false);

  clock.t += CAMERA_SETTLE_MS;
  guard.pointerDown(at(1, 200, 200), "canvas");
  guard.pointerUp(at(1, 200, 200));
  assert.equal(guard.isCameraSettling(), false);
  assert.equal(guard.acceptClick({ origin: "canvas" }), true);
});

test("keyboard activation of a label is always accepted", () => {
  const { guard } = setup();
  guard.noteCameraFrame(true);
  assert.equal(guard.acceptClick({ origin: "label", keyboard: true }), true);
});

test("drag-driven camera motion lasts through damping and ends once the camera settles", () => {
  const { clock, guard, at } = setup();
  guard.pointerDown(at(1, 200, 200), "canvas");
  guard.pointerMove(at(1, 300, 200));
  guard.noteCameraFrame(true);
  guard.pointerUp(at(1, 300, 200));
  // damping keeps moving the camera after the release
  for (let i = 0; i < 5; i += 1) {
    clock.t += 16;
    guard.noteCameraFrame(true);
    assert.equal(guard.isDragDriven(), true);
  }
  clock.t += CAMERA_SETTLE_MS + 1;
  assert.equal(guard.isDragDriven(), false);
  // a later wheel zoom (no press) is not drag driven
  guard.noteCameraFrame(true);
  assert.equal(guard.isDragDriven(), false);
});

test("a plain click is never drag driven and an idle camera frame clears an old drag", () => {
  const { clock, guard, at } = setup();
  guard.pointerDown(at(1, 200, 200), "canvas");
  assert.equal(guard.isPressed(), true);
  assert.equal(guard.isDragDriven(), false);
  guard.pointerUp(at(1, 200, 200));

  guard.pointerDown(at(1, 200, 200), "canvas");
  guard.pointerMove(at(1, 250, 200));
  guard.noteCameraFrame(true);
  guard.pointerUp(at(1, 250, 200));
  clock.t += CAMERA_SETTLE_MS + 1;
  guard.noteCameraFrame(false);
  assert.equal(guard.isDragDriven(), false);
});

test("camera motion is detected from position or rotation above the per-frame epsilon", () => {
  const still = { position: { x: 0, y: 10, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  assert.equal(hasCameraMoved(null, still), false);
  assert.equal(hasCameraMoved(still, still), false);
  assert.equal(hasCameraMoved(still, { ...still, position: { x: 0.001, y: 10, z: 0 } }), false);
  assert.equal(hasCameraMoved(still, { ...still, position: { x: 0.5, y: 10, z: 0 } }), true);
  const half = 0.01 / 2; // 0.01 rad yaw
  assert.equal(
    hasCameraMoved(still, { ...still, quaternion: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) } }),
    true,
  );
  const tiny = 0.0001 / 2;
  assert.equal(
    hasCameraMoved(still, { ...still, quaternion: { x: 0, y: Math.sin(tiny), z: 0, w: Math.cos(tiny) } }),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { attachCameraGestures, classifyWheel, wrapAngle } from "./cameraGestures.mjs";

const wheel = (init) => {
  const event = new Event("wheel", { cancelable: true });
  return Object.assign(event, { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, altKey: false, ...init });
};

test("wheel gestures: pinch zooms, horizontal swipe rotates, Option+vertical tilts, plain scroll is left to the engine", () => {
  const pinchIn = classifyWheel({ deltaY: -10, ctrlKey: true });
  assert.equal(pinchIn.type, "zoom");
  assert.ok(pinchIn.factor < 1);
  assert.ok(classifyWheel({ deltaY: 10, ctrlKey: true }).factor > 1);
  assert.deepEqual(classifyWheel({ deltaX: 40, deltaY: 5 }).type, "rotate");
  assert.ok(classifyWheel({ deltaX: -40, deltaY: 5 }).radians < 0);
  assert.equal(classifyWheel({ deltaY: 30, altKey: true }).type, "tilt");
  assert.equal(classifyWheel({ deltaY: 30 }), null);
  assert.equal(classifyWheel({ deltaX: 3, deltaY: 30 }), null);
  // Line-mode deltas (mouse wheels on some systems) count as 16 px per line.
  assert.ok(Math.abs(classifyWheel({ deltaX: 2, deltaMode: 1 }).radians - classifyWheel({ deltaX: 32 }).radians) < 1e-12);
});

test("wrapAngle folds a turn across the -pi/pi seam into the short way round", () => {
  assert.ok(Math.abs(wrapAngle(Math.PI * 1.9) + Math.PI * 0.1) < 1e-12);
  assert.ok(Math.abs(wrapAngle(-0.2) + 0.2) < 1e-12);
});

test("an attached element turns handled wheel gestures into commands and swallows them; plain scroll passes through", () => {
  const element = new EventTarget();
  const seen = [];
  const detach = attachCameraGestures(element, {
    start: () => seen.push("start"),
    zoom: (factor) => seen.push(["zoom", factor < 1]),
    rotate: (radians) => seen.push(["rotate", radians > 0]),
    tilt: (radians) => seen.push(["tilt", radians > 0]),
  });
  let engineSaw = 0;
  element.addEventListener("wheel", () => engineSaw++);

  const pinch = wheel({ deltaY: -8, ctrlKey: true });
  element.dispatchEvent(pinch);
  assert.equal(pinch.defaultPrevented, true);
  element.dispatchEvent(wheel({ deltaX: 30 }));
  element.dispatchEvent(wheel({ deltaY: -30, altKey: true }));
  const scroll = wheel({ deltaY: 30 });
  element.dispatchEvent(scroll);
  assert.equal(scroll.defaultPrevented, false);
  assert.deepEqual(seen, ["start", ["zoom", true], "start", ["rotate", true], "start", ["tilt", false]]);
  assert.equal(engineSaw, 1);

  detach();
  element.dispatchEvent(wheel({ deltaX: 30 }));
  assert.equal(seen.length, 6);
});

test("wheelZoom false leaves pinch wheels to the engine; Safari gesture events zoom and twist", () => {
  const element = new EventTarget();
  const seen = [];
  attachCameraGestures(element, { wheelZoom: false, zoom: (f) => seen.push(["zoom", +f.toFixed(3)]), rotate: (r) => seen.push(["rotate", +r.toFixed(3)]) });
  const pinch = wheel({ deltaY: -8, ctrlKey: true });
  element.dispatchEvent(pinch);
  assert.equal(pinch.defaultPrevented, false);

  const gesture = (type, scale, rotation) => Object.assign(new Event(type, { cancelable: true }), { scale, rotation });
  element.dispatchEvent(gesture("gesturestart", 1, 0));
  element.dispatchEvent(gesture("gesturechange", 2, 90));
  element.dispatchEvent(gesture("gestureend", 2, 90));
  assert.deepEqual(seen, [["zoom", 0.5], ["rotate", +(Math.PI / 2).toFixed(3)]]);
});

test("touch twist with two fingers rotates by the change in the line between them", () => {
  const element = new EventTarget();
  const turns = [];
  attachCameraGestures(element, { twist: true, rotate: (radians, { continuous }) => turns.push([radians, continuous]) });
  const pointer = (type, pointerId, clientX, clientY) => Object.assign(new Event(type), { pointerType: "touch", pointerId, clientX, clientY });
  element.dispatchEvent(pointer("pointerdown", 1, 0, 0));
  element.dispatchEvent(pointer("pointerdown", 2, 100, 0));
  element.dispatchEvent(pointer("pointermove", 2, 0, 100));
  assert.equal(turns.length, 1);
  assert.ok(Math.abs(turns[0][0] - Math.PI / 2) < 1e-12);
  assert.equal(turns[0][1], true);
  element.dispatchEvent(pointer("pointerup", 2, 0, 100));
  element.dispatchEvent(pointer("pointermove", 1, 50, 50));
  assert.equal(turns.length, 1);
});

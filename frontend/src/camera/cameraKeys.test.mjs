import assert from "node:assert/strict";
import test from "node:test";
import { cameraKeyAction } from "./useCameraKeys.mjs";
import { PAN_STEP, ROTATE_STEP, ZOOM_STEP } from "./cameraCommands.mjs";

const key = (value, extra = {}) => cameraKeyAction({ key: value, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });

test("arrows orbit, shift+arrows pan, +/- zoom, H goes home and / asks for search", () => {
  assert.deepEqual(key("ArrowLeft"), { type: "rotate", radians: ROTATE_STEP, tilt: 0 });
  assert.deepEqual(key("ArrowRight", { shiftKey: true }), { type: "pan", right: PAN_STEP, forward: 0 });
  assert.deepEqual(key("+"), { type: "zoom", factor: ZOOM_STEP });
  assert.deepEqual(key("-"), { type: "zoom", factor: 1 / ZOOM_STEP });
  assert.deepEqual(key("h"), { type: "home" });
  assert.deepEqual(key("/"), { type: "search" });
});

test("Space and browser shortcuts are left alone", () => {
  assert.equal(key(" "), null);
  assert.equal(key("+", { ctrlKey: true }), null);
  assert.equal(key("ArrowLeft", { metaKey: true }), null);
  assert.equal(key("h", { altKey: true }), null);
});

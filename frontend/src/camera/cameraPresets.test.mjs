import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMERA_PRESETS,
  D4_CAMERA_OFFSET,
  D4_PRESET_ID,
  OVERVIEW_PRESET_ID,
  easeInOutQuad,
  findCameraPreset,
  lerpView,
  nextPresetId,
  resolveCameraPreset,
} from "./cameraPresets.mjs";

const D4_BOUNDS = { min: [-232, 10, -126], max: [-197, 28, -61] };

test("preset list starts with the overview and every entry has a unique id, title and fixed view", () => {
  assert.equal(CAMERA_PRESETS[0].id, OVERVIEW_PRESET_ID);
  assert.deepEqual(CAMERA_PRESETS[0].position, [0, 260, 260]);
  assert.deepEqual(CAMERA_PRESETS[0].target, [0, 0, 0]);
  const ids = CAMERA_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const preset of CAMERA_PRESETS) {
    assert.ok(preset.title.length > 0, `${preset.id} has a title`);
    assert.equal(preset.position.length, 3, `${preset.id} fixed position`);
    assert.equal(preset.target.length, 3, `${preset.id} fixed target`);
  }
  assert.deepEqual(findCameraPreset(D4_PRESET_ID).offset, [60, 50, 60]);
  assert.deepEqual(findCameraPreset(D4_PRESET_ID).focus, ["BLD_D4"]);
});

test("the D4 preset frames anchor + (60, 50, 60) from the live BLD_D4 bounds", () => {
  const view = resolveCameraPreset(findCameraPreset(D4_PRESET_ID), { boundsOf: (name) => (name === "BLD_D4" ? D4_BOUNDS : null) });
  assert.deepEqual(view.target, [-214.5, 19, -93.5]);
  assert.deepEqual(view.position, [-214.5 + D4_CAMERA_OFFSET[0], 19 + D4_CAMERA_OFFSET[1], -93.5 + D4_CAMERA_OFFSET[2]]);
});

test("cluster presets use the union of the buildings that resolve and fall back to fixed coordinates", () => {
  const engineering = findCameraPreset("engineering");
  const boxes = {
    BLD_D3: { min: [-180, 8, -90], max: [-140, 20, -50] },
    BLD_D4: D4_BOUNDS,
  };
  const partial = resolveCameraPreset(engineering, { boundsOf: (name) => boxes[name] ?? null });
  assert.deepEqual(partial.target, [(-232 - 140) / 2, (8 + 28) / 2, (-126 - 50) / 2]);
  assert.deepEqual(partial.position, partial.target.map((value, axis) => value + engineering.offset[axis]));

  const fallback = resolveCameraPreset(engineering, { boundsOf: () => null });
  assert.deepEqual(fallback.position, engineering.position);
  assert.deepEqual(fallback.target, engineering.target);
  assert.notEqual(fallback.position, engineering.position, "fallback returns copies");
});

test("ground-relative presets lift both camera and target by the terrain height", () => {
  const gate = findCameraPreset("gate");
  const lifted = resolveCameraPreset(gate, { groundAt: (x, z) => (x === gate.target[0] && z === gate.target[2] ? 14.5 : null) });
  assert.deepEqual(lifted.target, [gate.target[0], gate.target[1] + 14.5, gate.target[2]]);
  assert.deepEqual(lifted.position, [gate.position[0], gate.position[1] + 14.5, gate.position[2]]);
  assert.deepEqual(resolveCameraPreset(gate, { groundAt: () => null }).position, gate.position);
  assert.deepEqual(resolveCameraPreset(gate).position, gate.position);
});

test("the tour cycles through presets in order and wraps", () => {
  const ids = CAMERA_PRESETS.map((preset) => preset.id);
  assert.equal(nextPresetId(ids[0]), ids[1]);
  assert.equal(nextPresetId(ids.at(-1)), ids[0]);
  assert.equal(nextPresetId(null), ids[0]);
  assert.equal(nextPresetId("missing"), ids[0]);
  assert.equal(nextPresetId("x", []), null);
});

test("quadratic in-out easing is symmetric and clamped", () => {
  assert.equal(easeInOutQuad(0), 0);
  assert.equal(easeInOutQuad(0.5), 0.5);
  assert.equal(easeInOutQuad(1), 1);
  assert.equal(easeInOutQuad(-1), 0);
  assert.equal(easeInOutQuad(2), 1);
  assert.ok(easeInOutQuad(0.25) < 0.25);
  assert.ok(easeInOutQuad(0.75) > 0.75);
  assert.equal(easeInOutQuad(0.25) + easeInOutQuad(0.75), 1);
});

test("lerpView interpolates position and target together", () => {
  const from = { position: [0, 0, 0], target: [10, 10, 10] };
  const to = { position: [100, 50, -100], target: [20, 0, 0] };
  assert.deepEqual(lerpView(from, to, 0.5), { position: [50, 25, -50], target: [15, 5, 5] });
  assert.deepEqual(lerpView(from, to, 1), to);
});

import assert from "node:assert/strict";
import test from "node:test";
import { applyCampusZoomLimits, campusZoomLimitsMeters } from "./cameraLimits.mjs";

test("VWorld zoom range equals the Main orbit range converted to metres", () => {
  const { min, max } = campusZoomLimitsMeters(1.602);
  assert.ok(Math.abs(min - 48.06) < 1e-9);
  assert.ok(Math.abs(max - 833.04) < 1e-9);
});

test("applies the limits to the Cesium camera controller and tolerates a scene without one", () => {
  const scene = { screenSpaceCameraController: { minimumZoomDistance: 1, maximumZoomDistance: Infinity } };
  assert.equal(applyCampusZoomLimits(scene), true);
  assert.ok(scene.screenSpaceCameraController.maximumZoomDistance < 900);
  assert.ok(scene.screenSpaceCameraController.minimumZoomDistance > 40);
  assert.equal(applyCampusZoomLimits({}), false);
});

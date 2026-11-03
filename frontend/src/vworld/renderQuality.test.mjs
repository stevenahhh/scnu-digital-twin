import assert from "node:assert/strict";
import test from "node:test";
import { applyVWorldQuality, vworldShadowsEnabled } from "./renderQuality.mjs";

function fakeWindow() {
  let renders = 0;
  const viewer = {
    resolutionScale: 1,
    shadows: true,
    scene: {
      postProcessStages: { fxaa: { enabled: false } },
      shadowMap: { enabled: true },
      globe: { shadows: "enabled" },
      requestRender: () => { renders += 1; },
    },
  };
  return { win: { ws3d: { viewer }, Cesium: { ShadowMode: { ENABLED: "enabled", DISABLED: "disabled" } } }, viewer, renders: () => renders };
}

test("each quality tier sets Cesium's resolution, anti-aliasing and shadows, and redraws", () => {
  const { win, viewer, renders } = fakeWindow();
  assert.equal(applyVWorldQuality("low", { win }), true);
  assert.deepEqual([viewer.resolutionScale, viewer.scene.postProcessStages.fxaa.enabled, viewer.shadows, viewer.scene.globe.shadows], [0.75, false, false, "disabled"]);
  assert.equal(vworldShadowsEnabled(), false);
  applyVWorldQuality("medium", { win });
  assert.deepEqual([viewer.resolutionScale, viewer.scene.postProcessStages.fxaa.enabled, viewer.shadows], [1, true, false]);
  applyVWorldQuality("high", { win });
  assert.deepEqual([viewer.shadows, viewer.scene.shadowMap.enabled, viewer.scene.globe.shadows], [true, true, "enabled"]);
  assert.equal(vworldShadowsEnabled(), true);
  assert.equal(renders(), 3);
  assert.equal(applyVWorldQuality("ultra", { win }), false);
});

test("before the map exists the tier is remembered for the sun simulation", () => {
  assert.equal(applyVWorldQuality("medium", { win: {} }), false);
  assert.equal(vworldShadowsEnabled(), false);
  applyVWorldQuality("high", { win: {} });
  assert.equal(vworldShadowsEnabled(), true);
});

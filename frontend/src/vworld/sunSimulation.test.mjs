import assert from "node:assert/strict";
import test from "node:test";

test("applies the selected simulation date to VWorld lighting and shadows", async () => {
  const initialWindow = globalThis.window;
  const selectedDate = new Date(2026, 4, 15, 14, 30);
  const julianDate = Object.freeze({ dayNumber: 2_460_000 });
  let renderRequests = 0;
  class SunLight {
    constructor(options) {
      this.intensity = options.intensity;
    }
  }

  globalThis.window = {
    Cesium: {
      JulianDate: {
        fromDate(date) {
          assert.equal(date, selectedDate);
          return julianDate;
        },
      },
      ShadowMode: { ENABLED: "enabled" },
      SunLight,
    },
    ws3d: {
      viewer: {
        clock: { currentTime: null, shouldAnimate: true },
        scene: {
          globe: {
            dynamicAtmosphereLighting: false,
            dynamicAtmosphereLightingFromSun: false,
            enableLighting: false,
            shadows: "receive-only",
          },
          highDynamicRange: false,
          light: null,
          shadowMap: { darkness: 0.3, enabled: false, softShadows: false },
          sun: { glowFactor: 1, show: false },
          sunBloom: false,
          requestRender() {
            renderRequests += 1;
          },
        },
        shadows: false,
      },
    },
  };

  try {
    const { applyVWorldSunSimulation } = await import("./sunSimulation.mjs");

    assert.equal(applyVWorldSunSimulation(selectedDate), true);
    assert.equal(globalThis.window.ws3d.viewer.clock.currentTime, julianDate);
    assert.equal(globalThis.window.ws3d.viewer.clock.shouldAnimate, false);
    assert.equal(globalThis.window.ws3d.viewer.scene.globe.enableLighting, true);
    assert.equal(globalThis.window.ws3d.viewer.scene.globe.dynamicAtmosphereLighting, true);
    assert.equal(globalThis.window.ws3d.viewer.scene.globe.dynamicAtmosphereLightingFromSun, true);
    assert.equal(globalThis.window.ws3d.viewer.scene.globe.shadows, "enabled");
    assert.equal(globalThis.window.ws3d.viewer.scene.light.intensity, 2.2);
    assert.equal(globalThis.window.ws3d.viewer.scene.shadowMap.enabled, true);
    assert.equal(globalThis.window.ws3d.viewer.scene.shadowMap.softShadows, true);
    assert.equal(globalThis.window.ws3d.viewer.scene.shadowMap.darkness, 0.4);
    assert.equal(globalThis.window.ws3d.viewer.scene.sun.show, true);
    assert.equal(globalThis.window.ws3d.viewer.scene.sun.glowFactor, 2);
    assert.equal(globalThis.window.ws3d.viewer.scene.sunBloom, true);
    assert.equal(globalThis.window.ws3d.viewer.scene.highDynamicRange, true);
    assert.equal(globalThis.window.ws3d.viewer.shadows, true);
    assert.equal(renderRequests, 1);
  } finally {
    if (initialWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = initialWindow;
    }
  }
});

test("night dims the map imagery through twilight and lights the model from above instead of the set sun", async () => {
  const { vworldNightLighting } = await import("./sunSimulation.mjs");
  const deg = (d) => (d * Math.PI) / 180;
  assert.deepEqual(vworldNightLighting(deg(20)), { night: false, imageryBrightness: 1, modelIntensity: null });
  const dusk = vworldNightLighting(deg(-3));
  const evening = vworldNightLighting(deg(-15));
  const late = vworldNightLighting(deg(-36));
  // Darker as the sun sinks, down to the 40% floor after astronomical twilight.
  assert.ok(dusk.imageryBrightness > evening.imageryBrightness && evening.imageryBrightness > late.imageryBrightness);
  assert.equal(late.imageryBrightness, 0.4);
  assert.ok(dusk.modelIntensity > evening.modelIntensity && evening.modelIntensity > late.modelIntensity && late.modelIntensity > 0);
});

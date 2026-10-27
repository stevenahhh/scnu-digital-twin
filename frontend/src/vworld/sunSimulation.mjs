import { getSunState } from "../utils/sunPosition.mjs";

const CAMPUS = Object.freeze({ longitude: 127.4764043, latitude: 34.9700548 });
// Below the horizon the SDK's sun light leaves the campus model black on a still-readable map. Through twilight
// (0 to -24 deg) the map imagery dims to 40% and the model is lit by a fixed, cool light from above whose strength
// follows the imagery, so night reads as night on both and keeps darkening after dusk (as Legacy's night tint does).
const NIGHT_FLOOR = 0.4;
const NIGHT_RAMP_DEGREES = 24;
const MOONLIGHT_INTENSITY = Object.freeze({ dusk: 1.2, night: 0.55 });
// Light travels down and slightly north-west in the campus east-north-up frame.
const MOONLIGHT_LOCAL_DIRECTION = Object.freeze([0.3, -0.35, -0.89]);

export function vworldNightLighting(altitudeRadians) {
  const degrees = (altitudeRadians * 180) / Math.PI;
  if (!(degrees < 0)) return { night: false, imageryBrightness: 1, modelIntensity: null };
  const depth = Math.min(1, -degrees / NIGHT_RAMP_DEGREES);
  const imageryBrightness = 1 - (1 - NIGHT_FLOOR) * depth;
  const modelIntensity = MOONLIGHT_INTENSITY.dusk + (MOONLIGHT_INTENSITY.night - MOONLIGHT_INTENSITY.dusk) * depth;
  return { night: true, imageryBrightness, modelIntensity };
}

function moonlight(Cesium, intensity) {
  const { Cartesian3, Color, DirectionalLight, Matrix4, Transforms } = Cesium ?? {};
  if (typeof DirectionalLight !== "function" || !Transforms?.eastNorthUpToFixedFrame || !Cartesian3?.fromDegrees || !Matrix4) return null;
  const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(CAMPUS.longitude, CAMPUS.latitude));
  const local = new Cartesian3(...MOONLIGHT_LOCAL_DIRECTION);
  const direction = Cartesian3.normalize(Matrix4.multiplyByPointAsVector(frame, local, new Cartesian3()), new Cartesian3());
  return new DirectionalLight({ direction, intensity, color: Color ? new Color(0.78, 0.84, 1, 1) : undefined });
}

export function applyVWorldSunSimulation(date) {
  const browserWindow = globalThis.window;
  const viewer = browserWindow?.ws3d?.viewer;
  const Cesium = browserWindow?.Cesium;
  const JulianDate = Cesium?.JulianDate;

  if (
    !(date instanceof Date) ||
    Number.isNaN(date.getTime()) ||
    !viewer?.clock ||
    !viewer.scene?.globe ||
    !viewer.scene.shadowMap ||
    !viewer.scene.sun ||
    typeof viewer.scene.requestRender !== "function" ||
    typeof JulianDate?.fromDate !== "function"
  ) {
    return false;
  }

  viewer.clock.currentTime = JulianDate.fromDate(date);
  viewer.clock.shouldAnimate = false;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
  if (Cesium?.ShadowMode?.ENABLED !== undefined) {
    viewer.scene.globe.shadows = Cesium.ShadowMode.ENABLED;
  }
  const { altitude } = getSunState({ date, ...CAMPUS });
  const lighting = vworldNightLighting(altitude);
  const nightLight = lighting.night ? moonlight(Cesium, lighting.modelIntensity) : null;
  if (nightLight) viewer.scene.light = nightLight;
  else if (typeof Cesium?.SunLight === "function") {
    viewer.scene.light = new Cesium.SunLight({ intensity: 2.2 });
  }
  const layers = viewer.imageryLayers;
  for (let index = 0; layers && index < layers.length; index += 1) {
    const layer = layers.get(index);
    if (layer) layer.brightness = lighting.imageryBrightness;
  }
  if ("highDynamicRange" in viewer.scene) {
    viewer.scene.highDynamicRange = true;
  }
  viewer.scene.shadowMap.enabled = true;
  viewer.scene.shadowMap.softShadows = true;
  viewer.scene.shadowMap.darkness = 0.4;
  viewer.scene.sun.show = true;
  viewer.scene.sun.glowFactor = 2;
  viewer.scene.sunBloom = true;
  viewer.shadows = true;
  viewer.scene.requestRender();

  return true;
}

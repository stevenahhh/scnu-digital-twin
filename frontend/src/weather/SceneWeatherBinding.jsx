import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { NEUTRAL_SCENE_WEATHER } from "./useSceneWeather.mjs";

// 직전에 쓴 값을 기억해 두고, 현재 값이 그것과 다르면 다른 코드(CampusLighting의 props, SkyEnvironment의 effect,
// 안개 객체 교체)가 새 기준값을 쓴 것으로 보고 기준값을 바꾼다. 기준값 x 배율(또는 + 증분)을 매 프레임 다시 쓴다.
export function createBaseTracker() {
  let base = null;
  let written = null;
  return (current, combine) => {
    if (written === null || current !== written) base = current;
    written = combine(base);
    return written;
  };
}

// CampusLighting이 만든 안개·햇빛·환경광·하늘 탁도에 날씨 배율을 얹는다. CampusLighting은 그대로 두고 장면 객체를
// 프레임마다 조정하므로, 조명 props가 다시 적용되거나 안개가 새 객체로 바뀌어도 그 값을 기준으로 다시 얹는다.
export function SceneWeatherBinding({
  sunIntensityScale = NEUTRAL_SCENE_WEATHER.sunIntensityScale,
  fogDensityScale = NEUTRAL_SCENE_WEATHER.fogDensityScale,
  turbidityDelta = NEUTRAL_SCENE_WEATHER.turbidityDelta,
  ambientScale = NEUTRAL_SCENE_WEATHER.ambientScale,
}) {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const trackers = useMemo(
    () => ({
      fog: createBaseTracker(),
      sun: createBaseTracker(),
      ambient: createBaseTracker(),
      environment: createBaseTracker(),
      turbidity: createBaseTracker(),
    }),
    [],
  );

  useEffect(() => {
    invalidate();
  }, [ambientScale, fogDensityScale, invalidate, sunIntensityScale, turbidityDelta]);

  useFrame(() => {
    const fog = scene.fog;
    if (fog?.isFogExp2) fog.density = trackers.fog(fog.density, (base) => base * fogDensityScale);
    for (const child of scene.children) {
      if (child.isDirectionalLight) {
        child.intensity = trackers.sun(child.intensity, (base) => base * sunIntensityScale);
      } else if (child.isAmbientLight) {
        child.intensity = trackers.ambient(child.intensity, (base) => base * ambientScale);
      } else if (child.material?.uniforms?.turbidity) {
        const uniform = child.material.uniforms.turbidity;
        uniform.value = trackers.turbidity(uniform.value, (base) => base + turbidityDelta);
      }
    }
    scene.environmentIntensity = trackers.environment(scene.environmentIntensity, (base) => base * ambientScale);
  });

  return null;
}

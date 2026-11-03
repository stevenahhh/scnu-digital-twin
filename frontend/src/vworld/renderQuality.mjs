// VWorld 지도(Cesium)의 렌더링 품질: Legacy 설정의 낮음·보통·높음과 같은 단계. SDK가 그리므로 Cesium이 가진 손잡이만 쓴다.
// 낮음 = 해상도 0.75배, 보정 없음 / 보통 = 원래 해상도 + 계단 현상 보정(FXAA) / 높음 = 보통 + 그림자.
export const VWORLD_QUALITY = Object.freeze({
  low: Object.freeze({ resolutionScale: 0.75, fxaa: false, shadows: false }),
  medium: Object.freeze({ resolutionScale: 1, fxaa: true, shadows: false }),
  high: Object.freeze({ resolutionScale: 1, fxaa: true, shadows: true }),
});
// 고른 값이 없으면 지금까지의 VWorld 모습(그림자 켬)인 높음.
export const VWORLD_DEFAULT_QUALITY = "high";

let current = VWORLD_DEFAULT_QUALITY;

// 해 시뮬레이션이 그림자를 켤지 볼 때 쓴다(품질이 그림자를 끄면 해가 바뀌어도 다시 켜지 않는다).
export function vworldShadowsEnabled() {
  return VWORLD_QUALITY[current].shadows;
}

export function applyVWorldQuality(tier, { win = globalThis.window } = {}) {
  const settings = VWORLD_QUALITY[tier];
  if (!settings) return false;
  current = tier;
  const viewer = win?.ws3d?.viewer;
  const Cesium = win?.Cesium;
  if (!viewer?.scene) return false;
  viewer.resolutionScale = settings.resolutionScale;
  const fxaa = viewer.scene.postProcessStages?.fxaa;
  if (fxaa) fxaa.enabled = settings.fxaa;
  viewer.shadows = settings.shadows;
  if (viewer.scene.shadowMap) viewer.scene.shadowMap.enabled = settings.shadows;
  const mode = settings.shadows ? Cesium?.ShadowMode?.ENABLED : Cesium?.ShadowMode?.DISABLED;
  if (viewer.scene.globe && mode !== undefined) viewer.scene.globe.shadows = mode;
  viewer.scene.requestRender?.();
  return true;
}

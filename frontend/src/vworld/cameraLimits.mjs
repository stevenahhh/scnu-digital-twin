import { CAMPUS_GLTF_OVERLAY_CONFIG } from "./campusGltfOverlay.mjs";

// VWorld 지도에서 사용자가 휠·핀치로 확대·축소할 수 있는 범위를 Legacy 캠퍼스 궤도(OrbitControls minDistance 30,
// maxDistance 520 장면 단위, render/CampusScene.jsx)와 같게 둔다. 장면 한 단위는 오버레이의 modelScale(1.602) m다.
// 이 범위 밖(시군·지구본 시점)에서는 캠퍼스가 점 하나라 건물 라벨과 선택이 뜻이 없다. 시작 비행 등 코드가 옮기는 카메라는 막지 않는다.
export const LEGACY_ORBIT_DISTANCE = Object.freeze({ min: 30, max: 520 });

export function campusZoomLimitsMeters(metresPerUnit = CAMPUS_GLTF_OVERLAY_CONFIG.modelScale.east) {
  return { min: LEGACY_ORBIT_DISTANCE.min * metresPerUnit, max: LEGACY_ORBIT_DISTANCE.max * metresPerUnit };
}

export function applyCampusZoomLimits(scene) {
  const controller = scene?.screenSpaceCameraController;
  if (!controller) return false;
  const { min, max } = campusZoomLimitsMeters();
  controller.minimumZoomDistance = min;
  controller.maximumZoomDistance = max;
  return true;
}

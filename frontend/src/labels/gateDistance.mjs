import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { SCENE_UNITS_PER_METRE } from "../geo/epsg5186.mjs";

// 정문에서 건물까지의 추정 직선 거리와 8방위. 장면 좌표는 +x 동, +z 남이고, 길이는 SCENE_UNITS_PER_METRE(약 0.62 단위/m)로
// 미터로 바꾼다. 경로가 아니라 직선이므로 화면에는 늘 `추정`으로 쓴다. 정문 기준점은 `정문` 시점의 바라보는 점이다.
export const GATE_ANCHOR = Object.freeze([...CAMERA_PRESETS.find((preset) => preset.id === "gate").target]);
export const COMPASS_8 = Object.freeze(["북", "북동", "동", "남동", "남", "남서", "서", "북서"]);

export function distanceAndBearingFromGate(anchor, gate = GATE_ANCHOR, unitsPerMetre = SCENE_UNITS_PER_METRE) {
  const east = (anchor[0] - gate[0]) / unitsPerMetre;
  const north = -(anchor[2] - gate[2]) / unitsPerMetre;
  const metres = Math.round(Math.hypot(east, north) / 10) * 10;
  if (metres === 0) return { metres: 0, bearing: null };
  const degrees = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  return { metres, bearing: COMPASS_8[Math.round(degrees / 45) % 8] };
}

export function describeGateDistance(result) {
  if (!result) return null;
  if (result.metres === 0) return "정문에서 추정 직선 거리 10 m 미만";
  return `정문에서 추정 직선 거리 ${result.metres} m · ${result.bearing}`;
}

// 장면 좌표가 있으면 인스펙터에 쓸 한 줄, 없으면(VWorld처럼 장면 좌표가 없는 건물) null.
export function gateTextFor(position) {
  return Array.isArray(position) ? describeGateDistance(distanceAndBearingFromGate(position)) : null;
}

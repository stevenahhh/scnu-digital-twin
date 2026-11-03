import { RISK_DANGER_HEX, RISK_WARNING_HEX } from "../../ui/sceneTokens.mjs";

// 교통 객체의 위험 단계별 색(장면). 정해진 단계가 아니면 undefined라 각 객체가 자기 기본색을 쓴다.
export const RISK_COLORS = Object.freeze({ danger: RISK_DANGER_HEX, warning: RISK_WARNING_HEX });

export function riskColor(level, fallback) {
  return RISK_COLORS[level] ?? fallback;
}

// 3D 캠퍼스 뒤 하늘 바탕색(three.js 배경과 Canvas 아래 DOM 바탕이 같은 값을 쓴다). 낮은 옅은 하늘, 밤은 짙은 남색.
export const DAY_SKY_HEX = "#d6e0e6";
export const NIGHT_SKY_HEX = "#09111d";
// 장면 안 해 구체의 색.
export const SUN_DISC_HEX = "#ffe87c";

export function sceneBackgroundFor(sunVisible) {
  return sunVisible ? DAY_SKY_HEX : NIGHT_SKY_HEX;
}

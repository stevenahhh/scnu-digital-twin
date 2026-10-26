// 폰 바텀 시트의 세 단계 높이와 끌기 놓았을 때 붙을 단계를 고르는 계산. DOM 없이 시험한다.
export const DETENT_ORDER = ["peek", "half", "full"];
export const PEEK_HEIGHT = 96;
// 놓는 순간의 속도로 이만큼(ms) 더 움직였다고 보고 가장 가까운 단계를 고른다. 빠르게 튕기면 다음 단계로 넘어간다.
export const PROJECTION_MS = 150;

// 화면에 보이는 시트 높이(px). full은 시트 요소 자체의 높이(100dvh에서 위쪽 안전 영역을 뺀 값)다.
export function detentHeights(viewportHeight, fullHeight = viewportHeight, peekHeight = PEEK_HEIGHT) {
  return { peek: peekHeight, half: Math.round(viewportHeight / 2), full: fullHeight };
}

export function clampHeight(height, heights) {
  return Math.min(Math.max(height, heights.peek), heights.full);
}

// height: 놓은 순간 보이는 높이(px). velocity: px/ms, 양수는 위로(시트가 커지는 쪽).
export function nearestDetent(height, heights, velocity = 0) {
  const projected = height + velocity * PROJECTION_MS;
  return DETENT_ORDER.reduce((best, name) => (Math.abs(heights[name] - projected) < Math.abs(heights[best] - projected) ? name : best));
}

// direction 1은 한 단계 위로, -1은 한 단계 아래로. 끝에서는 그대로 둔다.
export function stepDetent(current, direction) {
  const index = DETENT_ORDER.indexOf(current) + direction;
  return DETENT_ORDER[Math.min(Math.max(index, 0), DETENT_ORDER.length - 1)];
}

// 손잡이를 누르기만 했을 때(끌지 않음): 위로 한 단계, full에서는 peek으로 돌아간다.
export function cycleDetent(current) {
  return current === "full" ? "peek" : stepDetent(current, 1);
}

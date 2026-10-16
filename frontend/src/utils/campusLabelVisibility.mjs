// Legacy 캠퍼스 라벨을 화면에 둘지(그래서 키보드 포커스와 보조 기술에 내놓을지) 정한다.
// 라벨의 가운데 점이 캔버스 안에 있고 열린 대시보드 패널 밑에 있지 않을 때만 보인다고 본다.
// 가운데가 보이면 포커스 표시도 보인다. 사각형은 getBoundingClientRect() 모양(left/top/right/bottom)이면 된다.

function containsPoint(rect, x, y) {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

export function isCampusLabelVisible(label, area, occluder = null) {
  if (label.right <= label.left || label.bottom <= label.top) return false;
  const x = (label.left + label.right) / 2;
  const y = (label.top + label.bottom) / 2;
  return containsPoint(area, x, y) && !(occluder && containsPoint(occluder, x, y));
}

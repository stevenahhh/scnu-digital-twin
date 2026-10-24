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

// 가장자리가 맞닿기만 한 두 라벨은 겹친 것으로 보지 않는다.
export function campusLabelRectsOverlap(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// 우선순위: 선택된 라벨, 팝업 데이터가 있는 BLD_* 라벨, 카메라에 가까운 라벨 순. 같으면 id 순으로 고정한다.
function compareLabelPriority(a, b) {
  if (a.selected !== b.selected) return a.selected ? -1 : 1;
  if (a.hasPopup !== b.hasPopup) return a.hasPopup ? -1 : 1;
  if (a.distance !== b.distance) return a.distance - b.distance;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// labels: [{ id, rect, selected, hasPopup, distance }]. 보일 라벨의 id 집합을 돌려준다.
// 화면 안(isCampusLabelVisible)인 라벨을 우선순위대로 훑으며, 이미 남긴 라벨과 겹치는 라벨은 숨긴다.
export function selectVisibleCampusLabels(labels, area, occluder = null) {
  const kept = [];
  const visible = new Set();
  for (const label of [...labels].sort(compareLabelPriority)) {
    if (!isCampusLabelVisible(label.rect, area, occluder)) continue;
    if (kept.some((rect) => campusLabelRectsOverlap(rect, label.rect))) continue;
    kept.push(label.rect);
    visible.add(label.id);
  }
  return visible;
}

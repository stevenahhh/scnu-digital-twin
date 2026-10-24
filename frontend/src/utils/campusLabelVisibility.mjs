import { sampleHeight } from "../terrain/heightfield.mjs";

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

// 카메라에서 라벨 앵커까지의 선분이 지형(높이 사이드카) 아래로 들어가면 앵커가 언덕 뒤에 가려졌다고 본다.
// 선분을 격자 간격(field.step)마다 표본화해 지형 높이가 선분 높이보다 clearance 넘게 높은 점이 하나라도 있으면 true.
// 격자 밖 표본은 건너뛴다(가리지 않음). camera·anchor는 사이드카와 같은 모델 좌표계의 [x, y, z]다.
// 지형만 본다. 건물이 건물을 가리는 경우는 판정하지 않는다.
export function isAnchorOccludedByTerrain(field, camera, anchor, { clearance = 1, maxSamples = 512 } = {}) {
  if (!field) return false;
  const dx = anchor[0] - camera[0];
  const dy = anchor[1] - camera[1];
  const dz = anchor[2] - camera[2];
  const samples = Math.min(maxSamples, Math.ceil(Math.hypot(dx, dz) / field.step));
  for (let k = 1; k < samples; k += 1) {
    const t = k / samples;
    const ground = sampleHeight(field, camera[0] + dx * t, camera[2] + dz * t);
    if (ground !== null && ground > camera[1] + dy * t + clearance) return true;
  }
  return false;
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
// chrome은 지도 위 조작 UI(시점 버튼 줄, 시간 슬라이더, 패널 토글)의 사각형이다. 라벨은 이 UI 밑에 그려지므로
// 조금이라도 겹치는 라벨은 숨겨 UI 가장자리 밖으로 삐져나와 보이거나 그 밑에 숨은 채 포커스를 받지 않게 한다.
export function selectVisibleCampusLabels(labels, area, occluder = null, chrome = []) {
  const kept = [];
  const visible = new Set();
  for (const label of [...labels].sort(compareLabelPriority)) {
    if (!isCampusLabelVisible(label.rect, area, occluder)) continue;
    if (chrome.some((rect) => campusLabelRectsOverlap(rect, label.rect))) continue;
    if (kept.some((rect) => campusLabelRectsOverlap(rect, label.rect))) continue;
    kept.push(label.rect);
    visible.add(label.id);
  }
  return visible;
}

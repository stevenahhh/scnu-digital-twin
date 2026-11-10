import { FOCUS_RING } from "../ui/Button.jsx";

// D4 날개·층 선택과 강의실 선택 화면이 함께 쓰는 클래스와 표기.
// 묶음 하나(사용 중인 강의실, 강의실 상세). 안에 테두리 상자(버튼·일정 항목)가 들어가므로 바깥은 상자 대신 1px 구분선으로 나눈다.
export const D4_CARD = "border-t border-hairline pt-4 text-ink";
// 패인 본문 안의 한 열. 스크롤은 패인(D4SectionExperience) 본문 하나만 맡는다(같은 축 스크롤을 겹치지 않는다).
export const D4_COLUMN = "flex w-full flex-col items-stretch gap-4 px-4 py-2";
// 3D 장면 위 층·호실 이름표: 라벨 바탕(surface-1 85 %) 위 ink라 밝은 재질 위에서도 4.5:1을 넘는다.
export const D4_SCENE_LABEL = `rounded-control bg-[var(--colors-label-bg)] px-2 py-1 text-center text-caption font-semibold text-ink ${FOCUS_RING}`;

export function floorLabel(floor) {
  return floor === 0 ? "B1" : `${floor}층`;
}

export function floorLevels(wing) {
  const floors = Array.from({ length: wing.floors }, (_, index) => index + 1);
  return wing.hasBasement ? [0, ...floors] : floors;
}

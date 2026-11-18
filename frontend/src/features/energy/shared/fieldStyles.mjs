import { COARSE_TARGET } from "../../../ui/Button.jsx";

// 패널 입력(선택·숫자)과 이름표. shadcn Input·SelectTrigger에 얹는 크기와 면이고, 굵은 포인터(터치)에서는 44px 높이다.
export const FIELD_LABEL = "flex flex-col gap-1 text-caption text-ink-muted";
export const FIELD_CONTROL = `min-h-10 rounded-control bg-surface-1 px-2 text-ink ${COARSE_TARGET}`;
// 에너지 탭의 묶음 구분: 상자 대신 위쪽 가는 선과 여백으로 나눈다.
export const GROUP = "border-t border-hairline pt-3";

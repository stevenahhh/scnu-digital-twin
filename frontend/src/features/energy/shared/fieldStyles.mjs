import { FOCUS_RING } from "../../../ui/Button.jsx";

// 에너지 패널의 입력(날짜·선택·숫자)과 이름표. 토큰만 쓰고, 굵은 포인터(터치)에서는 44px 높이다.
export const FIELD_LABEL = "flex flex-col gap-1 text-caption text-ink-muted";
export const FIELD_INPUT = [
  "min-h-10 w-full rounded-control border border-hairline-strong bg-surface-1 px-2 text-body text-ink",
  "[@media(pointer:coarse)]:min-h-11",
  FOCUS_RING,
].join(" ");
// 에너지 카드 면.
export const CARD = "rounded-card border border-hairline bg-surface-2";

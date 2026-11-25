import { cx } from "./cx.mjs";

// 아이콘 모서리의 작은 점: 열어 볼 일이 있다는 표시. 뜻은 점을 단 단추의 접근 가능한 이름이 전한다.
export function AlertDot({ className }) {
  return <span aria-hidden="true" data-qa="alert-dot" className={cx("absolute right-0 top-0 h-2 w-2 rounded-pill bg-warning ring-2 ring-surface-1", className)} />;
}

import { cx } from "../ui/cx.mjs";

// D4 패인 안의 한 열. 스크롤은 패인(D4SectionExperience)의 본문 하나만 맡는다(같은 축 스크롤을 겹치지 않는다).
export function D4ScrollRoot({ className, children }) {
  return <div className={cx("flex w-full flex-col items-stretch gap-4 px-4 py-2", className)}>{children}</div>;
}

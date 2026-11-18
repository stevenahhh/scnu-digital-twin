import { cx } from "../ui/cx.mjs";

export const BRAND_NAME = "국립순천대학교 디지털 트윈";

// 화면에 하나뿐인 브랜드 표시이자 화면의 h1. 로고 파일 없이 글자로 쓴다. 크기와 색은 놓이는 자리가 정한다.
export function Wordmark({ className }) {
  return (
    <h1 className={cx("m-0", className)}>
      <span role="img" aria-label={BRAND_NAME} data-qa="wordmark">{BRAND_NAME}</span>
    </h1>
  );
}

import { cx } from "../ui/cx.mjs";

// D4 화면의 바깥 틀. lg 미만에서는 장면과 목록을 세로로 쌓고 이 루트가 세로 스크롤을 맡는다.
// 스크롤 클래스는 max-lg 변형으로만 붙인다: 루트에 `overflow-y-auto`를 그대로 쓰면
// D4SectionExperience의 휠 종료 판정(closest(".overflow-y-auto"))이 데스크톱에서도 막힌다.
export function D4ScrollRoot({ className, children }) {
  return (
    <div className={cx("flex h-full w-full flex-col items-center gap-6 px-4 py-6 max-lg:overflow-y-auto lg:flex-row lg:py-0", className)}>
      {children}
    </div>
  );
}

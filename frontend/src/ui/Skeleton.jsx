import { cx } from "./cx.mjs";

const SHAPES = {
  line: "h-4 w-full rounded-control",
  block: "h-16 w-full rounded-card",
  circle: "h-8 w-8 rounded-pill",
};

// 자리 표시 모양. 화면 읽기 프로그램에는 숨기고(옆의 Spinner·문구가 상태를 알린다), 움직임 줄이기에서는 깜빡이지 않는다.
export function Skeleton({ shape = "line", lines = 1, className }) {
  const count = shape === "line" ? Math.max(1, lines) : 1;
  return (
    <div aria-hidden="true" data-qa="skeleton" className="flex w-full flex-col gap-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={cx(
            "animate-pulse bg-surface-2 motion-reduce:animate-none",
            SHAPES[shape],
            shape === "line" && count > 1 && index === count - 1 && "w-2/3",
            className,
          )}
        />
      ))}
    </div>
  );
}

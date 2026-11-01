import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { COARSE_TARGET, FOCUS_RING } from "./Button.jsx";
import { cx } from "./cx.mjs";

// 펼침: 요약 버튼 하나와 그 아래로 자라는 내용. 열림 여부는 aria-expanded와 화살표 방향으로 보인다.
export function Disclosure({ summary, defaultOpen = false, open: openProp, onOpenChange, children, className, ...rest }) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const panelId = useId();

  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  return (
    <div className={cx("flex flex-col", className)} data-open={open ? "true" : "false"} {...rest}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className={cx(
          "inline-flex min-h-8 items-center gap-1 self-start rounded-control px-1 text-caption text-ink-muted hover:text-ink",
          COARSE_TARGET,
          FOCUS_RING,
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cx("h-4 w-4 shrink-0 transition-transform duration-micro motion-reduce:transition-none", open && "rotate-90")}
        />
        {summary}
      </button>
      <div id={panelId} hidden={!open} className="pt-1">
        {children}
      </div>
    </div>
  );
}

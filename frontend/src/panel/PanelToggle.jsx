import { forwardRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FOCUS_RING } from "../ui/Button.jsx";
import { cx } from "../ui/cx.mjs";

// 패널 왼쪽 가장자리에 붙는 여닫기 손잡이. 패널과 함께 움직이고, 패널이 화면 전체를 덮는 폭에서도 1.75rem은 남긴다.
export const PanelToggle = forwardRef(function PanelToggle({ open, onToggle }, ref) {
  const label = open ? "패널 닫기" : "패널 열기";
  const Icon = open ? ChevronRight : ChevronLeft;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={cx(
        "pointer-events-auto absolute top-1/2 z-20 flex h-14 w-7 -translate-y-1/2 items-center justify-center",
        "rounded-l-card border border-r-0 border-hairline bg-surface-1 text-ink-muted hover:text-ink",
        "transition-[right] duration-300",
        FOCUS_RING,
      )}
      style={{ right: open ? "min(var(--dashboard-panel-width), calc(100vw - 1.75rem))" : "0px" }}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
});

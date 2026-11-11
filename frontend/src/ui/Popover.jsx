import { useEffect, useId, useRef, useState } from "react";
import { FOCUSABLE_SELECTOR } from "../components/AccessibleDialog.jsx";
import { cx } from "./cx.mjs";

// 트리거에 붙어 뜨는 작은 면(범례, 시점 메뉴). Esc나 바깥 클릭으로 닫히고, Esc로 닫으면 포커스가 트리거로 돌아간다.
// renderTrigger는 트리거 버튼에 넘길 속성(ref, onClick, aria-*)을 받는다. children이 함수면 close()를 받아
// 메뉴 항목을 고른 뒤 스스로 닫을 수 있다(닫히면 포커스는 트리거로 돌아간다).
// anchor="container"면 면을 트리거가 아니라 가장 가까운 위치 지정 조상(예: HUD 한 줄)의 가장자리에 맞춘다. 좁은 줄 가운데의
// 트리거에 오른쪽을 맞추면 면이 화면 왼쪽 밖으로 나가는 폰 HUD가 쓴다.
export function Popover({ label, role = "dialog", renderTrigger, align = "start", anchor = "trigger", qa, className, children }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const wrapperRef = useRef(null);
  const panelId = useId();
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    (panel.querySelector(FOCUSABLE_SELECTOR) ?? panel).focus();

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const handlePointerDown = (event) => {
      if (!wrapperRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className={cx("inline-block", anchor === "trigger" && "relative")}>
      {renderTrigger({
        ref: triggerRef,
        onClick: () => setOpen((value) => !value),
        "aria-expanded": open,
        "aria-haspopup": role,
        "aria-controls": open ? panelId : undefined,
      })}
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role={role}
          aria-label={label}
          tabIndex={-1}
          data-qa={qa}
          className={cx(
            "absolute top-full z-modal mt-2 min-w-56 outline-none max-w-[min(20rem,calc(100vw-1rem))] rounded-card border border-hairline bg-surface-1 p-3 text-ink shadow-popover",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {typeof children === "function" ? children({ close }) : children}
        </div>
      )}
    </div>
  );
}

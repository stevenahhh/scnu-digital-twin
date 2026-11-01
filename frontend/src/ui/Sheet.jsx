import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { PEEK_HEIGHT, clampHeight, cycleDetent, detentHeights, nearestDetent, stepDetent } from "./sheetDetents.mjs";
import { FOCUS_RING } from "./Button.jsx";
import { cx } from "./cx.mjs";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const DRAG_THRESHOLD_PX = 4;

// 단계마다 화면에 보이는 높이. 시트 요소는 full 높이로 깔려 있고 translateY로 아래로 내린다.
const detentOffset = (detent, peekHeight) => ({
  peek: `translateY(calc(100% - ${peekHeight}px))`,
  half: "translateY(calc(100% - 50dvh))",
  full: "translateY(0px)",
})[detent];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION).matches);
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION);
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

// 폰(<640px)용 바텀 시트. peek(기본 96px, peekHeight)·half(50dvh)·full 세 단계. 시트 바깥(위쪽 장면)은 계속 조작할 수 있고,
// peek·half에서는 포커스를 가두지 않는다. 본문 스크롤은 full에서만 생긴다(같은 축 스크롤을 겹치지 않는다).
// 나머지 속성(data-qa 등)과 ref는 시트 요소에 그대로 붙는다(대시보드 셸이 패널 훅과 라벨 가림 기준으로 쓴다).
export const Sheet = forwardRef(function Sheet(
  { label, detent: detentProp, defaultDetent = "peek", onDetentChange, peekHeight = PEEK_HEIGHT, escapeCollapses = true, header, children, className, ...rest },
  forwardedRef,
) {
  const [detentState, setDetentState] = useState(defaultDetent);
  const detent = detentProp ?? detentState;
  const [dragHeight, setDragHeight] = useState(null);
  const [fading, setFading] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const sheetRef = useRef(null);
  const attachRef = useCallback((node) => {
    sheetRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const dragRef = useRef(null);
  const draggedRef = useRef(false);
  const firstRender = useRef(true);

  const setDetent = (next) => {
    if (next === detent) return;
    if (detentProp === undefined) setDetentState(next);
    onDetentChange?.(next);
  };

  // 움직임 줄이기: 미끄러지는 대신 잠깐 흐려졌다가 새 높이로 나타난다.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }
    if (!reducedMotion) return undefined;
    setFading(true);
    const frame = window.requestAnimationFrame(() => setFading(false));
    return () => window.cancelAnimationFrame(frame);
  }, [detent, reducedMotion]);

  const heights = () => detentHeights(window.innerHeight, sheetRef.current?.offsetHeight || window.innerHeight, peekHeight);

  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    draggedRef.current = false;
    const now = performance.now();
    dragRef.current = { startY: event.clientY, startHeight: heights()[detent], samples: [{ y: event.clientY, t: now }] };
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.startY - event.clientY;
    if (!draggedRef.current && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
    draggedRef.current = true;
    drag.samples = [...drag.samples.slice(-4), { y: event.clientY, t: performance.now() }];
    setDragHeight(clampHeight(drag.startHeight + delta, heights()));
  };

  const handlePointerUp = (event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !draggedRef.current) return;
    const first = drag.samples[0];
    const last = { y: event.clientY, t: performance.now() };
    const elapsed = Math.max(last.t - first.t, 1);
    const velocity = (first.y - last.y) / elapsed;
    const height = clampHeight(drag.startHeight + (drag.startY - event.clientY), heights());
    setDragHeight(null);
    setDetent(nearestDetent(height, heights(), velocity));
  };

  const handleClick = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setDetent(cycleDetent(detent));
  };

  const handleHandleKeyDown = (event) => {
    if (event.key === "ArrowUp") setDetent(stepDetent(detent, 1));
    else if (event.key === "ArrowDown") setDetent(stepDetent(detent, -1));
    else return;
    event.preventDefault();
  };

  const handleKeyDown = (event) => {
    if (!escapeCollapses || event.key !== "Escape" || detent === "peek") return;
    event.stopPropagation();
    setDetent("peek");
  };

  const dragging = dragHeight !== null;
  const transitionProperty = reducedMotion ? "opacity" : "transform";

  return (
    <section
      ref={attachRef}
      role="region"
      aria-label={label}
      data-qa="sheet"
      data-detent={detent}
      {...rest}
      onKeyDown={handleKeyDown}
      style={{
        height: "calc(100dvh - env(safe-area-inset-top))",
        transform: dragging ? `translateY(calc(100% - ${dragHeight}px))` : detentOffset(detent, peekHeight),
        transitionProperty,
        transitionDuration: dragging ? "0ms" : "var(--motion-surface)",
        transitionTimingFunction: "var(--motion-ease-standard)",
        opacity: fading ? 0 : 1,
      }}
      className={cx(
        "fixed inset-x-0 bottom-0 z-rail flex flex-col rounded-t-card border border-b-0 border-hairline bg-surface-1 text-ink shadow-popover",
        className,
      )}
    >
      <div className="flex shrink-0 justify-center pt-1">
        <button
          type="button"
          data-qa="sheet-handle"
          aria-label="패널 크기 조절"
          aria-expanded={detent !== "peek"}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={handleClick}
          onKeyDown={handleHandleKeyDown}
          className={cx("grid h-11 w-11 touch-none place-items-center rounded-control", FOCUS_RING)}
        >
          <span aria-hidden="true" className="h-1 w-9 rounded-pill bg-hairline-strong" />
        </button>
      </div>
      {header && <div className="shrink-0 px-4 pb-2">{header}</div>}
      <div
        data-qa="sheet-body"
        className={cx("min-h-0 flex-1 px-4 pb-[env(safe-area-inset-bottom)]", detent === "full" ? "overflow-y-auto overscroll-contain" : "overflow-hidden")}
      >
        {children}
      </div>
    </section>
  );
});

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { PEEK_HEIGHT, clampHeight, cycleDetent, detentHeights, nearestDetent, stepDetent } from "./sheetDetents.mjs";
import { FOCUS_RING } from "./Button.jsx";
import { cx } from "./cx.mjs";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const DRAG_THRESHOLD_PX = 4;
// 움직임 줄이기의 교차 페이드: 지금 높이에서 이만큼 흐려졌다가 새 높이에서 돌아온다. 시트가 사라지지 않게 0까지 내리지 않는다.
export const REDUCED_MOTION_DIM_OPACITY = 0.4;
const SURFACE_FALLBACK_MS = 300;

// 교차 페이드 한쪽(나가기 또는 들어오기)의 시간: --motion-surface의 절반. 두 쪽을 합쳐 패널·시트와 같은 300ms다.
function halfSurfaceMs() {
  const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--motion-surface"));
  return (Number.isFinite(token) ? token : SURFACE_FALLBACK_MS) / 2;
}

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
  // 움직임 줄이기에서 화면에 놓인 단계(detent는 바로 바뀌고, 위치는 흐려진 뒤에 옮긴다).
  const [shownDetent, setShownDetent] = useState(detent);
  const [dimmed, setDimmed] = useState(false);
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

  // 움직임 줄이기: 미끄러지는 대신 지금 높이에서 흐려졌다가(150ms) 새 높이에서 다시 또렷해진다(150ms).
  // 처음 그릴 때와 움직임 줄이기가 아닐 때는 위치를 바로 맞춘다.
  useEffect(() => {
    if (firstRender.current || !reducedMotion) {
      firstRender.current = false;
      setShownDetent(detent);
      setDimmed(false);
      return undefined;
    }
    setDimmed(true);
    const timer = window.setTimeout(() => {
      setShownDetent(detent);
      setDimmed(false);
    }, halfSurfaceMs());
    return () => window.clearTimeout(timer);
  }, [detent, reducedMotion]);

  const heights = () => detentHeights(window.innerHeight, sheetRef.current?.offsetHeight || window.innerHeight, peekHeight);

  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    draggedRef.current = false;
    const now = performance.now();
    dragRef.current = { startY: event.clientY, startHeight: heights()[detent], samples: [{ y: event.clientY, t: now }] };
  };

  // 끄는 동안에는 시트 요소의 transform만 직접 바꾼다(포인터가 움직일 때마다 시트 안 내용을 다시 그리지 않는다). 놓을 때 단계를 기록한다.
  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.startY - event.clientY;
    if (!draggedRef.current && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
    draggedRef.current = true;
    drag.samples = [...drag.samples.slice(-4), { y: event.clientY, t: performance.now() }];
    const node = sheetRef.current;
    if (!node) return;
    node.style.transitionDuration = "0ms";
    node.style.transform = `translateY(calc(100% - ${clampHeight(drag.startHeight + delta, heights())}px))`;
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
    const next = nearestDetent(height, heights(), velocity);
    // 끄는 동안 직접 쓴 값을 되돌린다. 같은 단계로 돌아가면 React가 style을 다시 쓰지 않으므로 여기서 놓는다.
    const node = sheetRef.current;
    if (node) {
      node.style.transitionDuration = "var(--motion-surface)";
      node.style.transform = detentOffset(next, peekHeight);
    }
    setDetent(next);
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
        transform: detentOffset(reducedMotion ? shownDetent : detent, peekHeight),
        transitionProperty,
        transitionDuration: reducedMotion ? "calc(var(--motion-surface) / 2)" : "var(--motion-surface)",
        transitionTimingFunction: "var(--motion-ease-standard)",
        opacity: dimmed ? REDUCED_MOTION_DIM_OPACITY : 1,
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

import { useLayoutEffect, useRef, useState } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
// 패널과 같은 transform, 같은 시간, 같은 곡선(DashboardShell의 표면 이동과 같은 토큰).
export const FOLLOW_MOTION = "transition-transform duration-surface ease-[var(--motion-ease-standard)] motion-reduce:transition-none";

function surfaceMs() {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--motion-surface"));
  return Number.isFinite(value) ? value : 300;
}

// 패널이 열리고 닫히는 동안 HUD 오른쪽 끝(rootRef의 right)과 오른쪽 묶음(style을 받는 요소)이 패널과 함께 움직인다.
// 열 때는 새 여백을 바로 쓰고, 묶음은 예전 화면 자리에서 새 자리로 transform으로 옮긴다.
// 닫을 때는 패널이 다 비킬 때까지 예전 여백을 두고 묶음만 옮긴 뒤 여백을 바꾼다.
// 그래서 어느 순간에도 HUD 오른쪽 끝이 움직이는 패널의 왼쪽 끝을 넘지 않는다. 움직임 줄이기에서는 바로 바꾼다.
export function usePanelFollow(rootRef, insetRight) {
  const [right, setRight] = useState(insetRight);
  const [shift, setShift] = useState({ x: 0, animate: false });
  const appliedRef = useRef(insetRight);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const previous = appliedRef.current;
    if (!root || previous === insetRight) return undefined;
    const inline = root.style.right;
    const oldEdge = root.getBoundingClientRect().right;
    root.style.right = insetRight;
    const delta = root.getBoundingClientRect().right - oldEdge;
    root.style.right = inline;

    const settle = () => {
      appliedRef.current = insetRight;
      setRight(insetRight);
      setShift({ x: 0, animate: false });
    };
    if (window.matchMedia?.(REDUCED_MOTION).matches || Math.abs(delta) < 1) {
      settle();
      return undefined;
    }
    let frame = 0;
    let timer = 0;
    const animateTo = (x) => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setShift({ x, animate: true }));
      });
    };
    if (delta < 0) {
      appliedRef.current = insetRight;
      setRight(insetRight);
      setShift({ x: -delta, animate: false });
      animateTo(0);
    } else {
      animateTo(delta);
      timer = window.setTimeout(settle, surfaceMs() + 34);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      setShift({ x: 0, animate: false });
    };
  }, [insetRight, rootRef]);

  return {
    right,
    style: { transform: shift.x ? `translateX(${shift.x}px)` : undefined, transition: shift.animate ? undefined : "none" },
  };
}

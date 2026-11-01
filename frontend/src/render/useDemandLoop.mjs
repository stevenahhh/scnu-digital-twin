import { useCallback, useEffect, useState } from "react";

// 메인 캠퍼스 캔버스의 R3F frameloop 상태 기계.
// - never: 탭이 숨겨졌거나 D4 상세(자체 캔버스를 가진 모달)가 열려 있을 때. WebGL 루프를 하나만 돌린다.
// - always: 실시간 교통 시뮬레이션이 돌거나, 선택 색 전환·카메라 비행처럼 스스로 invalidate하지 않는 애니메이션 창 안일 때.
// - demand: 그 밖의 정지 화면. 카메라 조작·props 변경·명시적 invalidate()가 있을 때만 그린다.
export function resolveFrameloop({ hidden = false, modalOpen = false, liveTraffic = false, animating = false } = {}) {
  if (hidden || modalOpen) return "never";
  if (liveTraffic || animating) return "always";
  return "demand";
}

export function isLiveTraffic(state) {
  return state.status === "running" && state.entities.size > 0;
}

// 마지막 요청 후 durationMs가 지날 때까지 active를 유지하는 시간 창. 요청이 겹치면 끝나는 시각만 늦춘다.
export function createAnimationWindow({ now, setTimer, clearTimer, onChange }) {
  let deadline = 0;
  let timer = null;
  let active = false;

  const settle = () => {
    timer = null;
    const remaining = deadline - now();
    if (remaining > 0) {
      timer = setTimer(settle, remaining);
      return;
    }
    active = false;
    onChange(false);
  };

  return {
    extend(durationMs) {
      deadline = Math.max(deadline, now() + durationMs);
      if (!active) {
        active = true;
        onChange(true);
      }
      if (timer === null) timer = setTimer(settle, deadline - now());
    },
    isActive: () => active,
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      deadline = 0;
      if (active) {
        active = false;
        onChange(false);
      }
    },
  };
}

export function useDemandLoop({ modalOpen = false, liveTraffic = false } = {}) {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden === true);
  const [animating, setAnimating] = useState(false);
  const [animationWindow] = useState(() => createAnimationWindow({
    now: () => performance.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer),
    onChange: setAnimating,
  }));

  useEffect(() => () => animationWindow.dispose(), [animationWindow]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const update = () => setHidden(document.hidden === true);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const animateFor = useCallback((durationMs) => animationWindow.extend(durationMs), [animationWindow]);

  return { frameloop: resolveFrameloop({ hidden, modalOpen, liveTraffic, animating }), animateFor };
}

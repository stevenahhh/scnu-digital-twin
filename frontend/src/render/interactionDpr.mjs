import { useCallback, useEffect, useState } from "react";

export const CANVAS_DPR = [1, 2];
export const INTERACTION_DPR_FACTOR = 0.75;
export const INTERACTION_RESTORE_MS = 350;

// R3F의 [min, max] dpr 해석(calculateDpr)과 같은 규칙으로 기준 픽셀 비율을 정한 뒤 조작 중에는 factor를 곱한다.
// Canvas가 다시 렌더될 때마다 dpr prop으로 재설정하므로 setDpr로 낮추면 대시보드의 1초 시계 갱신에 되돌려진다.
// 그래서 조작 상태를 React 상태로 들고 dpr prop 자체를 바꾼다.
export function canvasDpr(lowered, devicePixelRatio = 1) {
  if (!lowered) return CANVAS_DPR;
  const [min, max] = CANVAS_DPR;
  return Math.min(Math.max(min, devicePixelRatio), max) * INTERACTION_DPR_FACTOR;
}

// OrbitControls의 start(사용자 입력 시작)에 낮추고 end 후 restoreMs가 지나면 되돌린다.
// change 이벤트를 쓰지 않는 이유: 포커스 비행과 벤치 하네스의 카메라 고정도 change를 내므로 화질이 같이 떨어진다.
export function createInteractionDpr({ restoreMs = INTERACTION_RESTORE_MS, setTimer, clearTimer, onChange }) {
  let lowered = false;
  let timer = null;
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  return {
    start() {
      cancel();
      if (!lowered) {
        lowered = true;
        onChange(true);
      }
    },
    end() {
      cancel();
      if (!lowered) return;
      timer = setTimer(() => {
        timer = null;
        lowered = false;
        onChange(false);
      }, restoreMs);
    },
    isLowered: () => lowered,
    dispose: cancel,
  };
}

export function useInteractionDpr() {
  const [lowered, setLowered] = useState(false);
  const [controller] = useState(() => createInteractionDpr({
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer),
    onChange: setLowered,
  }));
  useEffect(() => () => controller.dispose(), [controller]);
  const onStart = useCallback(() => controller.start(), [controller]);
  const onEnd = useCallback(() => controller.end(), [controller]);
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return { dpr: canvasDpr(lowered, devicePixelRatio), onStart, onEnd };
}

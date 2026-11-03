import { useEffect } from "react";
import { PAN_STEP, ROTATE_STEP, ZOOM_STEP, panBy, rotateBy, zoomBy } from "./cameraCommands.mjs";

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

// 지도(캔버스나 그 위 라벨)에 포커스가 있을 때의 카메라 키: 좌우 화살표 회전, 위아래 화살표 가까이·멀리, Shift+화살표 이동,
// +/- 확대·축소, H 처음 시점,
// / 검색칸으로(검색칸이 생기기 전에는 아무것도 하지 않는다). Space와 브라우저 예약 단축키(Ctrl/⌘/Alt 조합)는 건드리지 않는다.
export function cameraKeyAction(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key in ARROWS) {
    const [x, y] = ARROWS[event.key];
    return event.shiftKey ? { type: "pan", right: x * PAN_STEP, forward: y * PAN_STEP } : { type: "rotate", radians: -x * ROTATE_STEP, tilt: y };
  }
  if (event.key === "+" || event.key === "=") return { type: "zoom", factor: ZOOM_STEP };
  if (event.key === "-" || event.key === "_") return { type: "zoom", factor: 1 / ZOOM_STEP };
  if (event.key === "h" || event.key === "H") return { type: "home" };
  if (event.key === "/") return { type: "search" };
  return null;
}

export function useCameraKeys({ targetRef, controlsRef, onHome }) {
  useEffect(() => {
    const element = targetRef.current;
    if (!element) return undefined;
    const handleKeyDown = (event) => {
      if (event.target.closest?.("input, select, textarea")) return;
      const action = cameraKeyAction(event);
      if (!action) return;
      const controls = controlsRef.current;
      if (action.type === "search") {
        const field = document.querySelector("[data-qa=search-field] input, input[data-qa=search-field]");
        if (!field) return;
        field.focus();
      } else if (action.type === "home") onHome();
      else if (action.type === "pan") panBy(controls, action.right, action.forward);
      else if (action.type === "zoom") zoomBy(controls, action.factor);
      else if (action.radians) rotateBy(controls, action.radians);
      else zoomBy(controls, action.tilt > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      event.preventDefault();
    };
    element.addEventListener("keydown", handleKeyDown);
    return () => element.removeEventListener("keydown", handleKeyDown);
  }, [controlsRef, onHome, targetRef]);
}

// 트랙패드·터치 제스처를 카메라 명령(확대·회전·기울이기)으로 바꾼다. Legacy(OrbitControls)와 VWorld(Cesium)가 같이 쓴다.
// - 트랙패드 핀치(Chrome·Firefox: ctrl이 붙은 wheel, Safari: gesturechange의 scale): 확대·축소
// - 두 손가락 가로 스와이프(|deltaX| > |deltaY|): 목표점 둘레로 회전
// - Option(Alt) + 두 손가락 세로 스와이프: 기울이기
// - 두 손가락 비틀기(Safari gesturechange의 rotation, 터치 화면의 두 포인터): 회전
// 수식키 없는 세로 스크롤은 건드리지 않는다(각 엔진의 기본 휠 확대가 그대로 처리한다).

export const GESTURE_RATES = Object.freeze({
  pinchZoomPerPixel: 0.01,
  rotatePerPixel: 0.005,
  tiltPerPixel: 0.004,
});

const LINE_PIXELS = 16;
const PAGE_PIXELS = 800;

function wheelPixels(event) {
  const unit = event.deltaMode === 1 ? LINE_PIXELS : event.deltaMode === 2 ? PAGE_PIXELS : 1;
  return { x: (event.deltaX ?? 0) * unit, y: (event.deltaY ?? 0) * unit };
}

// wheel 이벤트 하나의 뜻. null이면 엔진 기본 동작(세로 스크롤 확대)에 맡긴다.
// zoom.factor < 1이면 가까이. rotate.radians > 0이면 장면이 화면에서 왼쪽으로 돈다(손가락을 왼쪽으로 쓸 때, 자연스러운 스크롤 기준).
// tilt.radians > 0이면 지평선 쪽으로 눕는다.
export function classifyWheel(event, rates = GESTURE_RATES) {
  const { x, y } = wheelPixels(event);
  if (event.ctrlKey) return y === 0 ? null : { type: "zoom", factor: Math.exp(y * rates.pinchZoomPerPixel) };
  if (event.altKey && y !== 0) return { type: "tilt", radians: y * rates.tiltPerPixel };
  if (Math.abs(x) > Math.abs(y)) return { type: "rotate", radians: x * rates.rotatePerPixel };
  return null;
}

// 각도 차를 -π..π로 접는다.
export function wrapAngle(radians) {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

// 두 터치 포인터를 잇는 선의 화면 각도(라디안, 화면 y는 아래가 +라서 값이 커지면 시계 방향).
export function pointerAngle(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// element에 제스처를 붙이고 떼는 함수를 돌려준다.
// handlers: zoom(factor), rotate(radians, { continuous }), tilt(radians), start()
// wheelZoom: true면 핀치 wheel도 여기서 처리한다(false면 엔진 기본 동작에 맡긴다, OrbitControls는 ctrl wheel을 이미 확대로 쓴다).
// twist: true면 터치 화면의 두 손가락 비틀기를 회전으로 쓴다(Cesium은 이미 스스로 처리한다).
export function attachCameraGestures(element, { zoom, rotate, tilt, start, wheelZoom = true, twist = false, rates = GESTURE_RATES } = {}) {
  if (!element?.addEventListener) return () => {};
  const listeners = [];
  const on = (type, handler, options) => {
    element.addEventListener(type, handler, options);
    listeners.push([type, handler, options]);
  };

  // 캡처 단계에서 먼저 받아, 처리한 제스처는 엔진의 휠 확대가 같은 이벤트를 다시 쓰지 않게 막는다.
  // OrbitControls는 이 요소 자체에 휠 리스너를 달 수 있어 stopImmediatePropagation까지 쓴다.
  on("wheel", (event) => {
    const action = classifyWheel(event, rates);
    if (!action || (action.type === "zoom" && !wheelZoom)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    start?.();
    if (action.type === "zoom") zoom?.(action.factor);
    else if (action.type === "rotate") rotate?.(action.radians, { continuous: false });
    else tilt?.(action.radians);
  }, { capture: true, passive: false });

  // Safari 트랙패드 핀치·비틀기. 막지 않으면 페이지 전체가 확대된다. iOS Safari는 터치 핀치에도 gesture를 보내지만
  // 그때는 엔진이 터치로 이미 움직이므로(두 번 확대되지 않게) 화면에 닿은 손가락이 있으면 기본 동작만 막는다.
  const fingers = new Set();
  on("pointerdown", (event) => { if (event.pointerType === "touch") fingers.add(event.pointerId); }, { capture: true, passive: true });
  const lift = (event) => fingers.delete(event.pointerId);
  on("pointerup", lift, { capture: true, passive: true });
  on("pointercancel", lift, { capture: true, passive: true });
  let gesture = null;
  on("gesturestart", (event) => {
    event.preventDefault();
    if (fingers.size > 0) return;
    gesture = { scale: event.scale || 1, rotation: event.rotation || 0 };
    start?.();
  }, { passive: false });
  on("gesturechange", (event) => {
    event.preventDefault();
    if (!gesture) return;
    const scale = event.scale || 1;
    const rotation = event.rotation || 0;
    if (scale !== gesture.scale) zoom?.(gesture.scale / scale);
    if (rotation !== gesture.rotation) rotate?.((rotation - gesture.rotation) * Math.PI / 180, { continuous: true });
    gesture = { scale, rotation };
  }, { passive: false });
  on("gestureend", (event) => {
    event.preventDefault();
    gesture = null;
  }, { passive: false });

  if (twist) {
    const touches = new Map();
    let lastAngle = null;
    const angleNow = () => {
      if (touches.size !== 2) return null;
      const [a, b] = [...touches.values()];
      return pointerAngle(a, b);
    };
    const track = (event) => {
      if (event.pointerType !== "touch") return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      lastAngle = angleNow();
      if (lastAngle !== null) start?.();
    };
    const release = (event) => {
      if (!touches.delete(event.pointerId)) return;
      lastAngle = angleNow();
    };
    on("pointerdown", track, { capture: true, passive: true });
    on("pointermove", (event) => {
      if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const angle = angleNow();
      if (angle === null || lastAngle === null) return;
      const delta = wrapAngle(angle - lastAngle);
      lastAngle = angle;
      if (delta !== 0) rotate?.(delta, { continuous: true });
    }, { capture: true, passive: true });
    on("pointerup", release, { capture: true, passive: true });
    on("pointercancel", release, { capture: true, passive: true });
  }

  return () => {
    for (const [type, handler, options] of listeners) element.removeEventListener(type, handler, options);
  };
}

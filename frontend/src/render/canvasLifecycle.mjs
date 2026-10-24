// Canvas onCreated에서 붙이는 렌더 루프 보조 장치. useThree 대신 onCreated의 RootState를 받아서
// Canvas를 목(mock)으로 바꾼 컴포넌트 테스트에서도 앱 트리가 그대로 렌더된다.

// WebGL 컨텍스트를 잃으면 preventDefault()로 복구를 요청하고, 복구되면 demand 루프에 한 장을 다시 그리게 한다.
export function attachCanvasLifecycle(state, { win = globalThis.window } = {}) {
  const canvas = state.gl.domElement;
  const onLost = (event) => event.preventDefault();
  const onRestored = () => state.invalidate();
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  const detachBench = win?.__bench ? attachBenchBridge(win.__bench, state, win) : () => {};
  return () => {
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    detachBench();
  };
}

// scripts/perf/bench.mjs는 페이지 스크립트보다 먼저 window.__bench를 만들고 measuring 동안의 매 프레임을 잰다.
// demand 루프에서는 측정 구간에 그릴 이유가 없으므로, measuring이 켜져 있는 동안만 매 rAF마다 invalidate하고
// 꺼지는 순간 예약된 프레임까지 비워서 뒤따르는 2초 유휴 측정에 렌더가 섞이지 않게 한다. view가 바뀌면 한 장 그린다.
export function attachBenchBridge(bench, state, win) {
  let measuring = Boolean(bench.measuring);
  let view = bench.view;
  let frame = null;

  const stop = () => {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
  };
  const tick = () => {
    frame = null;
    if (!measuring) return;
    state.invalidate();
    frame = win.requestAnimationFrame(tick);
  };

  Object.defineProperty(bench, "measuring", {
    configurable: true,
    enumerable: true,
    get: () => measuring,
    set(value) {
      measuring = Boolean(value);
      if (measuring) {
        if (frame === null) tick();
        return;
      }
      stop();
      state.get().internal.frames = 0;
    },
  });
  Object.defineProperty(bench, "view", {
    configurable: true,
    enumerable: true,
    get: () => view,
    set(value) {
      view = value;
      state.invalidate();
    },
  });
  if (measuring) tick();

  return () => {
    stop();
    delete bench.measuring;
    delete bench.view;
    bench.measuring = measuring;
    bench.view = view;
  };
}

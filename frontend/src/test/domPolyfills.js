// jsdom·happy-dom에 없는 브라우저 API 가운데 Radix(shadcn) 컴포넌트가 부르는 것만 채운다. vitest 전용이다(vite.config.js setupFiles).
if (typeof window !== "undefined") {
  window.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const element = window.Element.prototype;
  element.hasPointerCapture ??= () => false;
  element.setPointerCapture ??= () => {};
  element.releasePointerCapture ??= () => {};
  element.scrollIntoView ??= () => {};
}

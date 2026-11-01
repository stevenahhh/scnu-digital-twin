import { useEffect, useState } from "react";

// 화면 폭 단계: 폰(<640px)은 바텀 시트, 태블릿(<1024px)은 덮는 서랍, 데스크톱은 붙박이 패널.
export const PHONE_QUERY = "(max-width: 639px)";
export const TABLET_QUERY = "(max-width: 1023px)";

export function resolveViewportMode(width) {
  if (width < 640) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}

export function readViewportMode(matchMedia) {
  if (typeof matchMedia !== "function") return "desktop";
  if (matchMedia(PHONE_QUERY).matches) return "phone";
  if (matchMedia(TABLET_QUERY).matches) return "tablet";
  return "desktop";
}

const currentMode = () => (typeof window === "undefined" ? "desktop" : readViewportMode(window.matchMedia?.bind(window)));

export function useViewportMode() {
  const [mode, setMode] = useState(currentMode);

  useEffect(() => {
    const update = () => setMode(currentMode());
    const queries = window.matchMedia ? [PHONE_QUERY, TABLET_QUERY].map((query) => window.matchMedia(query)) : [];
    queries.forEach((query) => query.addEventListener("change", update));
    window.addEventListener("resize", update);
    update();
    return () => {
      queries.forEach((query) => query.removeEventListener("change", update));
      window.removeEventListener("resize", update);
    };
  }, []);

  return mode;
}

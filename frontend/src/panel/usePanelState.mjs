import { useCallback, useState } from "react";

// 패널 열림 상태. 데스크톱·태블릿은 열림/레일 두 가지, 폰은 바텀 시트 단계(peek·half·full)다.
// 처음 방문하면 닫힌 레일로 시작해 장면이 먼저 보이고, 사용자가 직접 여닫은 것만 localStorage에 남긴다.
// 건물을 고를 때처럼 앱이 패널을 여는 것(reveal)은 저장하지 않는다.
export const PANEL_OPEN_KEY = "scnu.panelOpen";

export function readStoredPanelOpen(storage) {
  try {
    return storage?.getItem(PANEL_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeStoredPanelOpen(storage, open) {
  try {
    storage?.setItem(PANEL_OPEN_KEY, open ? "true" : "false");
  } catch {
    // 저장하지 못해도 이번 세션의 선택은 유지된다.
  }
}

const browserStorage = () => globalThis.localStorage ?? null;

export function usePanelState(mode) {
  const [open, setOpen] = useState(() => readStoredPanelOpen(browserStorage()));
  const [detent, setDetent] = useState("peek");

  const setUserOpen = useCallback((next) => {
    setOpen(next);
    writeStoredPanelOpen(browserStorage(), next);
  }, []);

  // 앱이 내용을 보여 줄 때(선택, D4에서 돌아옴): 폰은 half까지만 올리고, 이미 더 크면 그대로 둔다.
  const reveal = useCallback(() => {
    if (mode === "phone") setDetent((current) => (current === "peek" ? "half" : current));
    else setOpen(true);
  }, [mode]);

  const conceal = useCallback(() => {
    if (mode === "phone") setDetent("peek");
    else setOpen(false);
  }, [mode]);

  // 기존 흐름(useMainBuildingFlow)은 setIsPanelOpen(boolean)으로 패널을 연다.
  const setProgrammaticOpen = useCallback((next) => (next ? reveal() : conceal()), [conceal, reveal]);

  return { open, setOpen, setUserOpen, detent, setDetent, reveal, conceal, setProgrammaticOpen };
}

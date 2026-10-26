import { useCallback, useEffect, useRef, useState } from "react";
import { capturePresentationLayout, isTypingTarget, restorePresentationLayout } from "./presentationLayout.mjs";

const CURSOR_IDLE_MS = 3000;

// 발표 모드: 패널·레일·시트, HUD 도구, 카메라 단추와 상태 줄을 숨기고 장면 시각만 남긴다.
// P로 켜고 끈다(글자 입력 중에는 아니다). Esc는 다른 Esc 동작(선택 풀기 등)보다 먼저 발표 모드만 끝낸다.
// 3초 동안 포인터가 움직이지 않으면 커서를 숨긴다. 나가면 들어가기 전의 패널·시트 단계·탭으로 돌아간다.
export function usePresentationMode({ panelState, activeTab, setActiveTab }) {
  const [presenting, setPresenting] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const snapshotRef = useRef(null);
  const latest = useRef({});
  latest.current = { panelState, activeTab, setActiveTab, presenting };

  const enter = useCallback(() => {
    const { panelState: panel, activeTab: tab } = latest.current;
    snapshotRef.current = capturePresentationLayout({ panelOpen: panel.open, detent: panel.detent, activeTab: tab });
    setPresenting(true);
  }, []);

  const exit = useCallback(() => {
    const { panelState: panel, setActiveTab: setTab } = latest.current;
    restorePresentationLayout(snapshotRef.current, { setPanelOpen: panel.setOpen, setDetent: panel.setDetent, setActiveTab: setTab });
    snapshotRef.current = null;
    setPresenting(false);
    setCursorHidden(false);
  }, []);

  const toggle = useCallback(() => (latest.current.presenting ? exit() : enter()), [enter, exit]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && latest.current.presenting) {
        event.preventDefault();
        event.stopImmediatePropagation();
        exit();
        return;
      }
      if ((event.key === "p" || event.key === "P") && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [exit, toggle]);

  useEffect(() => {
    if (!presenting) return undefined;
    let timer = window.setTimeout(() => setCursorHidden(true), CURSOR_IDLE_MS);
    const wake = () => {
      setCursorHidden(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCursorHidden(true), CURSOR_IDLE_MS);
    };
    window.addEventListener("pointermove", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
    };
  }, [presenting]);

  return { presenting, toggle, exit, cursorHidden };
}

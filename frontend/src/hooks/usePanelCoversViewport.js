import { useEffect, useState } from "react";

// 대시보드 패널 폭은 min(var(--dashboard-panel-width), 100vw)이고 index.css는 439px 이하에서 이 변수를
// 100vw로 바꾼다. 그래서 뷰포트가 440px 이하이면 열린 패널이 지도 전체를 덮는다.
export const PANEL_COVERS_VIEWPORT_MAX_WIDTH = 440;

const panelCoversViewport = () => window.innerWidth <= PANEL_COVERS_VIEWPORT_MAX_WIDTH;

export function usePanelCoversViewport() {
  const [covers, setCovers] = useState(panelCoversViewport);

  useEffect(() => {
    const update = () => setCovers(panelCoversViewport());
    window.addEventListener("resize", update);
    update();
    return () => window.removeEventListener("resize", update);
  }, []);

  return covers;
}

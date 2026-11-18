import { useCallback, useRef } from "react";

// showSelection()은 고른 건물을 보여 준다: 건물 탭으로 열고, 에너지 탭에 있었으면 탭은 그대로 두고 패널만 연다.
export function useDashboardNavigation({ panelState, activeTab, setActiveTab }) {
  const tabRef = useRef(activeTab);
  tabRef.current = activeTab;
  const { reveal } = panelState;
  const showSelection = useCallback(() => {
    if (tabRef.current !== "energy") setActiveTab("building");
    reveal();
  }, [reveal, setActiveTab]);
  return { showSelection };
}

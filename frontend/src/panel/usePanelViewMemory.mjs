import { useCallback, useRef } from "react";

// D4 상세에 들어가기 직전의 패널 화면(탭, 본문 스크롤 위치)을 기억했다가 돌아올 때 그대로 되돌린다.
// 사용자가 고른 탭은 사용자만 바꾼다: 들어갈 때도 나올 때도 탭이 저절로 바뀌지 않는다.
export function usePanelViewMemory({ activeTab, setActiveTab, scrollRef }) {
  const savedRef = useRef(null);
  const tabRef = useRef(activeTab);
  tabRef.current = activeTab;

  const save = useCallback(() => {
    savedRef.current = { activeTab: tabRef.current, scrollTop: scrollRef.current?.scrollTop ?? 0 };
  }, [scrollRef]);

  const restore = useCallback(() => {
    const saved = savedRef.current;
    savedRef.current = null;
    if (!saved) return;
    setActiveTab(saved.activeTab);
    // 탭 내용이 다시 그려진 뒤 스크롤을 되돌린다.
    const apply = () => {
      if (scrollRef.current) scrollRef.current.scrollTop = saved.scrollTop;
    };
    apply();
    if (typeof window !== "undefined" && window.requestAnimationFrame) window.requestAnimationFrame(apply);
  }, [scrollRef, setActiveTab]);

  return { save, restore };
}

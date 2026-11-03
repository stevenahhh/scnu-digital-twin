import { useCallback, useState } from "react";

// 비교할 건물 묶음(최대 3개). 순수 함수 + 훅.
export const COMPARISON_MAX = 3;
export const COMPARISON_FULL = "비교는 최대 3개까지입니다";
export const COMPARISON_NEEDS_TWO = "건물을 2개 이상 선택하세요";

// 같은 id는 한 번만. 넷째는 거절하고 그 까닭을 돌려준다.
export function addToComparison(ids, id) {
  if (!id || ids.includes(id)) return { ids, refused: null };
  if (ids.length >= COMPARISON_MAX) return { ids, refused: COMPARISON_FULL };
  return { ids: [...ids, id], refused: null };
}

export function removeFromComparison(ids, id) {
  return ids.filter((item) => item !== id);
}

export function useComparisonSet() {
  const [state, setState] = useState({ ids: [], status: "", open: false });
  const add = useCallback((id) => setState((previous) => {
    const next = addToComparison(previous.ids, id);
    return { ...previous, ids: next.ids, status: next.refused ?? "" };
  }), []);
  const remove = useCallback((id) => setState((previous) => {
    const ids = removeFromComparison(previous.ids, id);
    return { ids, status: "", open: previous.open && ids.length >= 2 };
  }), []);
  const setOpen = useCallback((open) => setState((previous) => ({ ...previous, open: open && previous.ids.length >= 2 })), []);
  return { ids: state.ids, status: state.status, open: state.open, canCompare: state.ids.length >= 2, add, remove, setOpen };
}

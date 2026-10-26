import { useCallback, useReducer, useRef } from "react";

// 캠퍼스 건물 선택 상태: 무엇을(elementId, 라벨 앵커 id) 어떤 경로로(source) 골랐는가.
// 사용자가 직접 고른 선택(클릭·시점·검색)은 카메라 근접 자동 선택에 밀리지 않는다. 근접 자동 선택은 사용자가 드래그로
// 카메라를 직접 움직이기 시작하거나 선택을 풀면 다시 켜진다. 휠 확대는 드래그가 아니다(고른 건물을 들여다보는 동작).
// source: 'click' | 'preset' | 'search' | 'proximity' | 'list' | 'drag' | null.

export const PROXIMITY_SUSPENDING_SOURCES = Object.freeze(["click", "preset", "search"]);
export const INITIAL_SELECTION = Object.freeze({ elementId: null, source: null });

export function selectionReducer(state, action) {
  switch (action.type) {
    case "select":
      if (!action.elementId) return INITIAL_SELECTION;
      return { elementId: action.elementId, source: action.source ?? null };
    // 같은 제스처가 이미 앵커 id로 고른 선택의 경로만 확정한다(건물 클릭 뒤의 팝업 요청 경로). 고른 것이 없으면 이 id를 고른다.
    case "confirm":
      if (state.elementId) return state.source === action.source ? state : { ...state, source: action.source };
      return action.elementId ? { elementId: action.elementId, source: action.source } : state;
    case "clear":
      return state.elementId === null && state.source === null ? state : INITIAL_SELECTION;
    case "dragStart":
      return isProximitySuspended(state) ? { ...state, source: "drag" } : state;
    default:
      return state;
  }
}

export function isProximitySuspended(selection) {
  return Boolean(selection?.elementId) && PROXIMITY_SUSPENDING_SOURCES.includes(selection.source);
}

// 패널 제목: 고른 앵커 id를 레지스트리 이름으로 바꾼다. 팝업 요청 id(dataElementId)로 들어온 선택도 그 건물 이름을 찾는다.
// 레지스트리가 아직 없으면(모델 로딩 중) 공통 요소 이름을 쓴다.
export function resolveSelectionTitle(registry, elementId, elementNames = null) {
  if (!elementId) return null;
  const direct = registry?.get(elementId)?.displayName;
  if (direct) return direct;
  if (registry) {
    for (const entry of registry.values()) {
      if (entry.dataElementId === elementId && entry.tier > 0 && entry.displayName) return entry.displayName;
    }
  }
  return elementNames?.get(elementId) ?? null;
}

// selectionRef는 콜백 안에서 최신 선택을 읽기 위한 것이다(근접 자동 선택 콜백이 선택마다 새로 만들어지지 않게).
export function useSelectionState() {
  const [selection, dispatch] = useReducer(selectionReducer, INITIAL_SELECTION);
  const selectionRef = useRef(selection);
  const apply = useCallback((action) => {
    selectionRef.current = selectionReducer(selectionRef.current, action);
    dispatch(action);
  }, []);
  const select = useCallback((elementId, source) => apply({ type: "select", elementId, source }), [apply]);
  const confirm = useCallback((elementId, source) => apply({ type: "confirm", elementId, source }), [apply]);
  const clear = useCallback(() => apply({ type: "clear" }), [apply]);
  const releaseOnDrag = useCallback(() => apply({ type: "dragStart" }), [apply]);
  return { selection, selectionRef, select, confirm, clear, releaseOnDrag };
}

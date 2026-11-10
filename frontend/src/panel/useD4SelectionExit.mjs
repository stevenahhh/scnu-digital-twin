import { useEffect, useRef } from "react";
import { isD4ElementId } from "../utils/d4BuildingData.mjs";

// 두 지도 모두 새 건물을 고르면 이전 D4 상세를 닫는다. 상세 진입이나 선택 해제 자체는 닫기 요청이 아니다.
export function useD4SelectionExit(elementId, open, onExit) {
  const previousId = useRef(elementId);
  useEffect(() => {
    const changed = previousId.current !== elementId;
    previousId.current = elementId;
    if (changed && open && elementId?.startsWith("BLD_") && !isD4ElementId(elementId)) onExit();
  }, [elementId, onExit, open]);
}

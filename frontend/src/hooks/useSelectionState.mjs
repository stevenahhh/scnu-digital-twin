import { useCallback, useState } from "react";

// 지금 고른 건물. selectedId는 라벨 강조에 쓰이는 값(BLD_* id나 표시 이름), selectedTitle은 패널 제목에 쓸 이름,
// selectedBuildingId는 에너지·설치 계획을 조회할 건물 코드(BLD_ 접두어 없음, 처음에는 D4)다.
// selectedEstimate는 캠퍼스 GLB extras의 높이·형태 추정 표시(Main만, 없으면 null)다.
// 고르기만 할 뿐 탭은 바꾸지 않는다. 어떤 탭을 보여 줄지는 부르는 쪽이 정한다.
export function useSelectionState(initialBuildingId = "D4") {
  const [selectedId, setSelectedId] = useState("");
  const [selectedTitle, setSelectedTitle] = useState("");
  const [selectedBuildingId, setSelectedBuildingId] = useState(initialBuildingId);
  const [selectedEstimate, setSelectedEstimate] = useState(null);

  const selectBuilding = useCallback(({ elementId, buildingId, displayName, title = displayName, estimate = null }) => {
    setSelectedId(displayName);
    setSelectedTitle(title);
    setSelectedEstimate(estimate);
    setSelectedBuildingId(buildingId);
    return elementId;
  }, []);

  // 라벨만 강조할 때(제목은 패널이 다시 채운다).
  const highlight = useCallback((id) => {
    setSelectedId(id);
    setSelectedTitle("");
    setSelectedEstimate(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId("");
    setSelectedTitle("");
    setSelectedEstimate(null);
  }, []);

  return {
    selectedId, selectedTitle, selectedEstimate, selectedBuildingId, setSelectedBuildingId, selectBuilding, highlight, clearSelection,
  };
}

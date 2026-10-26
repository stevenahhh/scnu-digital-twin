import { VWorldCampusStatus } from "../vworld/VWorldCampusStatus";
import { RepresentativePlanOverlayController } from "../vworld/RepresentativePlanOverlayController";
import { CAMPUS_REPRESENTATIVE_BUILDING_IDS } from "../vworld/representativePlanOverlay.mjs";

// Legacy 에너지 탭 머리: 3D 지도에는 없는 캠퍼스 건물별 태양광 상태와 대표 설치 계획 목록(VWorld는 지도 위에 띄운다).
export function CampusEnergyOverview({ onSelection, onBuildingSelect, refreshKey }) {
  return (
    <>
      <VWorldCampusStatus onSelection={onSelection} className="w-full" />
      <RepresentativePlanOverlayController
        buildingIds={CAMPUS_REPRESENTATIVE_BUILDING_IDS}
        refreshKey={refreshKey}
        onOverlayDataChange={() => {}}
        onBuildingSelect={onBuildingSelect}
        className="w-full"
        widthClassName="max-w-none"
      />
    </>
  );
}

import { RepresentativePlanOverlayController } from "../vworld/RepresentativePlanOverlayController";
import { CAMPUS_REPRESENTATIVE_BUILDING_IDS } from "../vworld/representativePlanOverlay.mjs";

// 에너지 탭의 대표 설치 계획 지도 레이어 토글(두 진입점 공용). 건물별 상태와 계획은 캠퍼스 비교 표 한 곳에 있다.
// onOverlayDataChange는 지도가 그릴 오버레이를 받는다(VWorld). 받을 쪽이 없으면(Main) 넘기지 않는다.
export function CampusEnergyOverview({ refreshKey, onOverlayDataChange, feedDown }) {
  return (
    <RepresentativePlanOverlayController
      buildingIds={CAMPUS_REPRESENTATIVE_BUILDING_IDS}
      refreshKey={refreshKey}
      onOverlayDataChange={onOverlayDataChange}
      feedDown={feedDown}
    />
  );
}

import { Alert } from "../ui/Alert.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { BuildingAnalysis } from "../features/energy/analysis";
import { CampusComparison } from "../features/energy/campus/CampusComparisonPanel";
import { EnergyDashboard } from "../features/energy/dashboard/EnergyDashboard";

// 에너지 탭: 탭 제목 하나(h2) 아래에 건물 분석, 캠퍼스 비교, 건물 시뮬레이션. 설치 계획을 못 받으면 맨 위에 알림 하나와 다시 시도.
// Legacy는 3D 지도에 없는 캠퍼스 설치 현황·대표 계획 목록을 campusOverview로 함께 넣는다.
export function EnergyTab({ buildingId, plans, campusOverview, onOpenRecommendation }) {
  return (
    <>
      <SectionHeader level={2} title="에너지" />
      {plans.status === "error" && (
        <Alert
          tone="danger"
          source="installation-plans"
          title="설치 계획을 불러오지 못했습니다"
          actions={[{ label: "다시 시도", onClick: plans.retry }]}
        />
      )}
      {campusOverview}
      <BuildingAnalysis
        key={`${buildingId}:${plans.representativePlanId ?? "none"}`}
        buildingId={buildingId}
        plans={plans.plans}
        plansStatus={plans.status}
        representativePlanId={plans.representativePlanId}
      />
      <CampusComparison onOpenRecommendation={onOpenRecommendation} />
      <EnergyDashboard key={buildingId} buildingId={buildingId} />
    </>
  );
}

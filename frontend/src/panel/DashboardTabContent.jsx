import { PanelErrorBoundary } from "../components/PanelErrorBoundary";
import { BuildingEmptyState } from "./BuildingEmptyState";
import { EnergyTab } from "./EnergyTab";
import { SimulationTab } from "./SimulationTab";
import { StatusTab } from "./StatusTab";

// 두 대시보드가 같이 쓰는 네 탭의 내용. building은 선택 인스펙터(또는 비교)이고, 없으면 빈 상태와 검색 바로가기다.
// 피드 상태(feeds)는 useFeedStatus 결과이고, 끊긴 피드마다 그 묶음 안에 알림 하나·다시 시도 하나다.
export function DashboardTabContent({
  activeTab, building = null, summary, feeds, clock, trafficFeed, plans, buildingId, hasSelection = true, onOpenRecommendation, campusOverview = null, restrictions = null,
}) {
  return (
    <>
      {activeTab === "building" && (
        <PanelErrorBoundary label="건물">{building ?? <BuildingEmptyState />}</PanelErrorBoundary>
      )}
      {activeTab === "status" && (
        <PanelErrorBoundary label="현황">
          <StatusTab summary={summary} feeds={feeds} retry={feeds.retry} trafficFeed={trafficFeed} restrictions={restrictions?.items} />
        </PanelErrorBoundary>
      )}
      {activeTab === "energy" && (
        <PanelErrorBoundary label="에너지">
          <EnergyTab
            buildingId={buildingId}
            hasSelection={hasSelection}
            plans={plans}
            feedStatus={feeds.energy}
            onRetry={feeds.retry.energy}
            onOpenRecommendation={onOpenRecommendation}
            campusOverview={campusOverview}
            sceneDate={clock.sceneDate}
          />
        </PanelErrorBoundary>
      )}
      {activeTab === "simulation" && (
        <PanelErrorBoundary label="시뮬레이션">
          <SimulationTab clock={clock} restrictions={restrictions} />
        </PanelErrorBoundary>
      )}
    </>
  );
}

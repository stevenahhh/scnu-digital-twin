import { Search } from "lucide-react";
import { PanelErrorBoundary } from "../components/PanelErrorBoundary";
import { Button } from "../ui/Button.jsx";
import { EnergyTab } from "./EnergyTab";
import { SimulationTab } from "./SimulationTab";
import { StatusTab } from "./StatusTab";

const focusSearch = () => document.querySelector("[data-qa=search-field] input")?.focus();

function BuildingEmptyState() {
  return (
    <div data-qa="building-empty" className="flex flex-col items-start gap-3 py-2">
      <p className="break-keep text-body text-ink-muted">지도에서 건물을 누르거나 검색하세요</p>
      <Button size="sm" variant="secondary" icon={<Search aria-hidden="true" className="h-4 w-4" />} onClick={focusSearch}>
        건물 검색
      </Button>
    </div>
  );
}

// 두 대시보드가 같이 쓰는 네 탭의 내용. building은 선택 인스펙터(또는 비교)이고, 없으면 빈 상태와 검색 바로가기다.
// 피드 상태(feeds)는 useFeedStatus 결과이고, 끊긴 피드마다 그 묶음 안에 알림 하나·다시 시도 하나다.
export function DashboardTabContent({
  activeTab, building = null, summary, feeds, clock, trafficFeed, plans, buildingId, hasSelection = true, onOpenRecommendation, campusOverview = null,
}) {
  return (
    <>
      {activeTab === "building" && (
        <PanelErrorBoundary label="건물">{building ?? <BuildingEmptyState />}</PanelErrorBoundary>
      )}
      {activeTab === "status" && (
        <PanelErrorBoundary label="현황">
          <StatusTab summary={summary} feeds={feeds} retry={feeds.retry} trafficFeed={trafficFeed} />
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
          <SimulationTab clock={clock} />
        </PanelErrorBoundary>
      )}
    </>
  );
}

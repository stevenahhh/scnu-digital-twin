import { PanelErrorBoundary } from "../components/PanelErrorBoundary";
import { BasicStatusTab } from "./BasicStatusTab";
import { EnergyTab } from "./EnergyTab";
import { EnvironmentTab } from "./EnvironmentTab";
import { ParkingSafetyTab } from "./ParkingSafetyTab";

// 두 대시보드가 같이 쓰는 네 탭의 내용. 피드 상태(feeds)는 useFeedStatus 결과이고, 끊긴 피드마다 알림 하나·다시 시도 하나다.
// campusOverview는 Legacy만 넣는 캠퍼스 설치 현황, children은 그 밖의 탭(부르는 쪽이 activeTab을 보고 넣는다)이다.
export function DashboardTabContent({
  activeTab, summary, feeds, clock, trafficFeed, plans, buildingId,
  onOpenSettings, onRefreshWeather, onOpenRecommendation, campusOverview = null, children,
}) {
  return (
    <>
      {activeTab === "dashboard" && (
        <PanelErrorBoundary label="기본 현황">
          <BasicStatusTab
            summary={summary}
            feeds={feeds}
            retry={feeds.retry}
            clock={clock}
            sunAltitudeDegrees={clock.sunAltitudeDegrees}
            onOpenSettings={onOpenSettings}
            onRefreshWeather={onRefreshWeather}
          />
        </PanelErrorBoundary>
      )}
      {children}
      {activeTab === "parking_safety" && (
        <PanelErrorBoundary label="주차·안전">
          <ParkingSafetyTab trafficFeed={trafficFeed} feedStatus={feeds.traffic} onRetry={feeds.retry.traffic} />
        </PanelErrorBoundary>
      )}
      {activeTab === "energy" && (
        <PanelErrorBoundary label="에너지">
          <EnergyTab
            buildingId={buildingId}
            plans={plans}
            feedStatus={feeds.energy}
            onRetry={feeds.retry.energy}
            onOpenRecommendation={onOpenRecommendation}
            campusOverview={campusOverview}
          />
        </PanelErrorBoundary>
      )}
      {activeTab === "environment" && (
        <PanelErrorBoundary label="환경 시뮬">
          <EnvironmentTab clock={clock} />
        </PanelErrorBoundary>
      )}
    </>
  );
}

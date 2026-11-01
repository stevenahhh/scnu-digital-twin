import { PanelErrorBoundary } from "../components/PanelErrorBoundary";
import { BasicStatusTab } from "./BasicStatusTab";
import { EnergyTab } from "./EnergyTab";
import { EnvironmentTab } from "./EnvironmentTab";
import { PanelClock } from "./PanelClock.jsx";
import { ParkingSafetyTab } from "./ParkingSafetyTab";

// 두 대시보드가 같이 쓰는 네 탭의 내용. 피드 상태(feeds)는 useFeedStatus 결과이고, 끊긴 피드마다 알림 하나·다시 시도 하나다.
// campusOverview는 Legacy만 넣는 캠퍼스 설치 현황, children은 그 밖의 탭(부르는 쪽이 activeTab을 보고 넣는다)이다.
export function DashboardTabContent({
  activeTab, summary, feeds, clock, trafficFeed, plans, buildingId,
  settings, onRefreshWeather, onOpenRecommendation, campusOverview = null, children,
}) {
  return (
    <>
      {/* 패널 시계(장면·현재)는 탭과 상관없이 늘 보인다. 기본 현황은 새로 고침·설정과 한 줄에 같은 시계를 둔다. */}
      {activeTab !== "dashboard" && <PanelClock sceneMinuteOfDay={clock.sceneMinuteOfDay} sceneDate={clock.sceneDate} />}
      {activeTab === "dashboard" && (
        <PanelErrorBoundary label="기본 현황">
          <BasicStatusTab
            summary={summary}
            feeds={feeds}
            retry={feeds.retry}
            clock={clock}
            sunAltitudeDegrees={clock.sunAltitudeDegrees}
            settings={settings}
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

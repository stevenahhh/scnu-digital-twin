import { useCallback, useRef, useState } from "react";
import VWorldRenderer from "./vworld/VWorldRenderer";
import { sceneBackgroundFor } from "./lighting/sceneBackground.mjs";
import { AccessibleDialog } from "./components/AccessibleDialog";
import { MicroclimatePanel } from "./components/MicroclimatePanel";
import { useSimulationSocket } from "./simulation";
import { createPlanDraftFromExisting } from "./features/energy/installations/installationPlanApi.mjs";
import { useViewportMode } from "./hooks/useViewportMode.mjs";
import { useWeatherFeed } from "./hooks/useWeatherFeed";
import { useTrafficFeed } from "./simulation/hooks/useTrafficFeed";
import { usePopupData } from "./hooks/usePopupData.mjs";
import { useInstallationPlans } from "./hooks/useInstallationPlans.mjs";
import { useSelectionState } from "./hooks/useSelectionState.mjs";
import { useSunClock } from "./hooks/useSunClock.mjs";
import { useThemeMode } from "./hooks/useThemeMode.mjs";
import { DashboardShell, shellInsetRight } from "./panel/DashboardShell";
import { usePanelState } from "./panel/usePanelState.mjs";
import { usePanelViewMemory } from "./panel/usePanelViewMemory.mjs";
import { Wordmark } from "./panel/Wordmark";
import { HudTimeReadout, sceneTimeReadout } from "./components/HudTimeReadout";
import { SettingsDialog } from "./panel/SettingsDialog";
import { DashboardTabContent } from "./panel/DashboardTabContent";
import { FeedStamps } from "./panel/FeedStatus";
import { useFeedStatus } from "./hooks/useFeedStatus.mjs";
import { summarizeWeather } from "./panel/weatherSummary.mjs";

// 지도 영상 위에 까는 야간 음영과 해 쪽 햇빛. 해 고도·방위(도)에서 투명도와 위치를 정한다.
function mapLighting(altitudeDegrees, bearingDegrees, sunVisible) {
  const bearing = (bearingDegrees * Math.PI) / 180;
  return {
    glowX: 50 + Math.sin(bearing) * 55,
    glowY: 50 - Math.cos(bearing) * 55,
    glowOpacity: sunVisible ? Math.min(0.28, 0.12 + Math.max(0, altitudeDegrees) / 300) : 0,
    nightOpacity: Math.min(0.68, Math.max(0, ((6 - altitudeDegrees) / 12) * 0.68)),
  };
}

export default function App() {
  useSimulationSocket();
  const panelRef = useRef(null);
  const [editorRequest, setEditorRequest] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const viewportMode = useViewportMode();
  const panelState = usePanelState(viewportMode);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);
  // D4 상세 화면(자체 대화상자)이 열린 동안에는 건물 팝업을 띄우지 않는다. 화면 뒤에 가린 팝업이 키보드 포커스를 가두지 않게 한다.
  const [isD4SectionOpen, setIsD4SectionOpen] = useState(false);
  const [themeMode, setThemeMode] = useThemeMode();
  const weatherFeed = useWeatherFeed();
  const trafficFeed = useTrafficFeed();
  const clock = useSunClock();
  const selection = useSelectionState();
  const plans = useInstallationPlans(selection.selectedBuildingId);
  const feeds = useFeedStatus({ weather: weatherFeed, traffic: trafficFeed, plans });
  const panelScrollRef = useRef(null);
  const popup = usePopupData();

  const summary = summarizeWeather({ feed: weatherFeed, mode: clock.mode, simTemp: clock.simTemp });
  const lighting = mapLighting(clock.sunAltitudeDegrees, clock.sunBearingDegrees, clock.sunState.visible);

  // VWorld에서 건물을 고르면 에너지 탭으로 옮기고 미기후 팝업을 띄운다(frontend/AGENTS.md 의도된 차이).
  const { selectBuilding, clearSelection } = selection;
  const { load: loadPopup, clear: clearPopup } = popup;
  const handleVWorldSelection = useCallback((target) => {
    selectBuilding(target);
    setActiveTab("energy");
    if (target.elementId?.startsWith("BLD_")) loadPopup(target.elementId);
    else clearPopup();
  }, [clearPopup, loadPopup, selectBuilding]);
  const closeMicroclimatePopup = useCallback(() => {
    clearSelection();
    clearPopup();
  }, [clearPopup, clearSelection]);
  // D4 상세에 들어갈 때의 탭·스크롤을 기억했다가 나올 때 되돌린다(Legacy와 같은 규칙).
  const viewMemory = usePanelViewMemory({ activeTab, setActiveTab, scrollRef: panelScrollRef });
  const handleD4SectionChange = useCallback((open) => {
    if (open) viewMemory.save();
    else viewMemory.restore();
    setIsD4SectionOpen(open);
  }, [viewMemory]);
  const closeEditor = () => {
    setEditorRequest(null);
    plans.refreshAll();
  };

  // 지도 위 문구·버튼과 야간 음영은 패널(또는 레일)이 차지한 오른쪽 폭만큼 비켜 선다.
  const mapInsetRight = isD4SectionOpen ? "0px" : shellInsetRight(viewportMode, panelState.open);

  // 루트는 overflow: clip으로 자른다. hidden은 스크롤 컨테이너라서 Tab 포커스가 화면 밖 요소로 가면 대시보드가 밀려 남는다.
  return (
    <div className="dashboard-root relative h-dvh w-screen overflow-clip bg-canvas text-ink">
      <div className="absolute inset-0" style={{ background: sceneBackgroundFor(clock.sunState.visible) }} />

      <div className="absolute inset-0 z-0">
        <VWorldRenderer
          onSelection={handleVWorldSelection}
          onD4SectionChange={handleD4SectionChange}
          simulationDate={clock.sunDate}
          editorRequest={editorRequest}
          onEditorClose={closeEditor}
          onPlanSaved={plans.refreshAll}
          createInstallationPlanDraft={createPlanDraftFromExisting}
          installationPlanRefreshKey={plans.refreshKey}
          onInstallationPlansChange={plans.onPlansChange}
          onRepresentativeInstallationPlanChange={plans.onRepresentativeChange}
          representativeRefreshKey={plans.overlayRefreshKey}
          overlayInsetRight={mapInsetRight}
          // 야간 음영·햇빛·그라데이션은 지도 영상만 어둡게 해야 하므로 렌더러가 지도 바로 위·지도 위 문구와 버튼 아래에 그린다.
          mapBackdrop={(
            <>
              <div
                id="vworld-available-area"
                className="pointer-events-none absolute bottom-0 left-0 top-0 z-[1] transition-[right,background-color] duration-300"
                style={{
                  right: mapInsetRight,
                  backgroundColor: `rgba(3, 10, 24, ${lighting.nightOpacity})`,
                }}
              />
              <div
                className="pointer-events-none absolute bottom-0 left-0 top-0 z-[2] transition-[right,opacity] duration-300"
                style={{
                  right: mapInsetRight,
                  background: `radial-gradient(circle at ${lighting.glowX}% ${lighting.glowY}%, `
                    + `rgba(255, 218, 138, ${lighting.glowOpacity}) 0%, transparent 42%)`,
                }}
              />
            </>
          )}
        />
      </div>

      {!isD4SectionOpen && (
        <div
          data-qa="campus-hud"
          className="pointer-events-none absolute left-0 top-0 z-[6] flex items-start gap-2 p-4 transition-[right] duration-300"
          style={{ right: mapInsetRight }}
        >
          <HudTimeReadout
            minuteOfDay={clock.sceneMinuteOfDay}
            statusSlot={viewportMode !== "phone" && (
              <FeedStamps feeds={feeds} retry={feeds.retry} placement={{ expanded: panelState.open, activeTab }} />
            )}
          />
          {viewportMode !== "phone" && <Wordmark className="ml-auto mt-2.5 text-ink-muted" />}
        </div>
      )}

      <DashboardShell
        ref={panelRef}
        mode={viewportMode}
        open={panelState.open}
        onOpenChange={panelState.setUserOpen}
        detent={panelState.detent}
        onDetentChange={panelState.setDetent}
        hidden={isD4SectionOpen}
        timeReadout={sceneTimeReadout(clock.sceneMinuteOfDay)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        scrollRef={panelScrollRef}
        freshnessSlot={<FeedStamps feeds={feeds} retry={feeds.retry} compact />}
      >
        <DashboardTabContent
          activeTab={activeTab}
          summary={summary}
          feeds={feeds}
          clock={clock}
          trafficFeed={trafficFeed}
          plans={plans}
          buildingId={selection.selectedBuildingId}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onRefreshWeather={weatherFeed.refresh}
          onOpenRecommendation={setEditorRequest}
        />
      </DashboardShell>

      {/* 건물 미기후 팝업: VWorld는 탭이 아니라 지도 위 대화상자로 보여 준다(의도된 차이). */}
      <AccessibleDialog
        open={Boolean(selection.selectedId) && !isD4SectionOpen}
        onClose={closeMicroclimatePopup}
        title={popup.data?.name ?? selection.selectedId}
        className="pointer-events-auto absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 [&>h2]:sr-only"
      >
        <section className="max-h-[80vh] w-[340px] overflow-y-auto rounded-card border border-hairline bg-surface-1 p-4 text-ink shadow-dialog">
          <MicroclimatePanel
            data={popup.data}
            loading={popup.loading}
            error={popup.error}
            errorDetail={popup.errorDetail}
            onRetry={popup.retry}
            lastData={popup.lastData}
            title={selection.selectedId}
            onClose={closeMicroclimatePopup}
          />
        </section>
      </AccessibleDialog>

      {isSettingsOpen && <SettingsDialog onClose={closeSettings} themeMode={themeMode} onThemeChange={setThemeMode} />}
    </div>
  );
}

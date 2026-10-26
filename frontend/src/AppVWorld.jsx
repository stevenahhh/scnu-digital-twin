import { useCallback, useRef, useState } from "react";
import VWorldRenderer from "./vworld/VWorldRenderer";
import { sceneBackgroundFor } from "./lighting/sceneBackground.mjs";
import { SelectionInspector } from "./panel/SelectionInspector";
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
import { DashboardShell, SHELL_PEEK_HEIGHT, shellInsetRight } from "./panel/DashboardShell";
import { TimeSlider } from "./components/TimeSlider";
import { usePanelState } from "./panel/usePanelState.mjs";
import { usePanelViewMemory } from "./panel/usePanelViewMemory.mjs";
import { Wordmark } from "./panel/Wordmark";
import { HudTimeReadout, sceneTimeReadout } from "./components/HudTimeReadout";
import { SettingsSheet } from "./panel/SettingsSheet";
import { usePresentationMode } from "./panel/usePresentationMode.mjs";
import { PresentationToggle } from "./components/CampusHud";
import { DashboardTabContent } from "./panel/DashboardTabContent";
import { FeedStamps, sheetPlacement } from "./panel/FeedStatus";
import { useFeedStatus } from "./hooks/useFeedStatus.mjs";
import { urlSelectionTarget, useDashboardUrlState } from "./hooks/useDashboardUrlState.mjs";
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
  // D4 상세 화면(자체 대화상자)이 열린 동안에는 건물 팝업을 띄우지 않는다. 화면 뒤에 가린 팝업이 키보드 포커스를 가두지 않게 한다.
  const [isD4SectionOpen, setIsD4SectionOpen] = useState(false);
  // D4 상세가 그려질 셸의 패인 자리와, 레일에서 다른 탭을 골라 D4를 닫을 때 바꾸는 값.
  const [d4PaneHost, setD4PaneHost] = useState(null);
  const [d4CloseKey, setD4CloseKey] = useState(0);
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

  // VWorld에서 건물을 고르면 Legacy와 같은 선택 인스펙터가 열린다. 탭은 바꾸지 않는다(폰에서는 시트를 half로).
  const { selectBuilding, clearSelection } = selection;
  const { load: loadPopup, clear: clearPopup } = popup;
  const { revealOnPhone } = panelState;
  const handleVWorldSelection = useCallback((target) => {
    selectBuilding(target);
    if (target.elementId?.startsWith("BLD_")) {
      revealOnPhone();
      loadPopup(target.elementId);
    } else clearPopup();
  }, [clearPopup, loadPopup, revealOnPhone, selectBuilding]);
  // 공유 링크: 건물·장면 시각·패널·탭(VWorld 카메라는 SDK가 가져 주소에 담지 않는다).
  useDashboardUrlState({
    building: selection.selectedId, onBuilding: (id) => handleVWorldSelection(urlSelectionTarget(id)),
    clock, panelState, activeTab, setActiveTab,
  });
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
  const presentation = usePresentationMode({ panelState, activeTab, setActiveTab });
  const mapInsetRight = presentation.presenting ? "0px" : shellInsetRight(viewportMode, panelState.open, isD4SectionOpen, Boolean(selection.selectedId));
  // 폰에서는 바텀 시트의 peek 높이만큼 아래를 비운다.
  const mapInsetBottom = viewportMode === "phone" ? `${SHELL_PEEK_HEIGHT}px` : "0px";
  const [isTimePlaying, setIsTimePlaying] = useState(false);

  // 루트는 overflow: clip으로 자른다. hidden은 스크롤 컨테이너라서 Tab 포커스가 화면 밖 요소로 가면 대시보드가 밀려 남는다.
  return (
    <div className={`dashboard-root relative h-dvh w-screen overflow-clip bg-canvas text-ink ${presentation.cursorHidden ? "cursor-none" : ""}`}>
      <div className="absolute inset-0" style={{ background: sceneBackgroundFor(clock.sunState.visible) }} />

      <div className="absolute inset-0 z-0">
        <VWorldRenderer
          onSelection={handleVWorldSelection}
          onD4SectionChange={handleD4SectionChange}
          d4PaneHost={d4PaneHost}
          d4CloseKey={d4CloseKey}
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
          overlayInsetBottom={mapInsetBottom}
          overlaysHidden={presentation.presenting}
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

      <div
        data-qa="campus-hud"
        className="pointer-events-none absolute left-0 top-0 z-[6] transition-[right] duration-300"
        style={{ right: mapInsetRight, bottom: mapInsetBottom }}
      >
        <div className="flex items-start gap-2 p-4">
        <HudTimeReadout
          minuteOfDay={clock.sceneMinuteOfDay}
          statusSlot={viewportMode !== "phone" && !presentation.presenting && (
            <FeedStamps feeds={feeds} retry={feeds.retry} placement={{ expanded: panelState.open, activeTab }} />
          )}
        />
        <PresentationToggle presenting={presentation.presenting} onToggle={presentation.toggle} className="mt-1" />
        {viewportMode !== "phone" && !presentation.presenting && <Wordmark className="ml-auto mt-2.5 text-ink-muted" />}
        </div>
        {/* 시간 조작은 Legacy와 같은 하나뿐인 조작이다. 지도 조작 열(왼쪽 아래)과 겹치지 않게 오른쪽 아래에 둔다. */}
        {!presentation.presenting && <TimeSlider
          minuteOfDay={clock.sceneMinuteOfDay}
          onMinuteChange={clock.setSceneMinuteOfDay}
          dateValue={clock.sceneDate}
          onDateChange={clock.setSceneDate}
          onNow={clock.snapToNow}
          playing={isTimePlaying}
          onPlayingChange={setIsTimePlaying}
          live={clock.isLiveMode}
          collapsible={viewportMode === "phone"}
          className="absolute bottom-4 right-4 w-[min(24rem,calc(100%-2rem))]"
        />}
      </div>

      <DashboardShell
        ref={panelRef}
        mode={viewportMode}
        open={panelState.open}
        onOpenChange={panelState.setUserOpen}
        detent={panelState.detent}
        onDetentChange={panelState.setDetent}
        hidden={presentation.presenting}
        pane={isD4SectionOpen && <div ref={setD4PaneHost} className="h-full" />}
        onPaneExit={() => setD4CloseKey((value) => value + 1)}
        timeReadout={sceneTimeReadout(clock.sceneMinuteOfDay)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        inspector={selection.selectedId && !isD4SectionOpen ? (
          <SelectionInspector
            title={selection.selectedTitle || popup.data?.name || selection.selectedId}
            popup={popup}
            onClose={closeMicroclimatePopup}
            onShowAll={closeMicroclimatePopup}
          />
        ) : null}
        scrollRef={panelScrollRef}
        freshnessSlot={(
          <FeedStamps feeds={feeds} retry={feeds.retry} placement={sheetPlacement(panelState, activeTab)} compact />
        )}
      >
        <DashboardTabContent
          activeTab={activeTab}
          summary={summary}
          feeds={feeds}
          clock={clock}
          trafficFeed={trafficFeed}
          plans={plans}
          buildingId={selection.selectedBuildingId}
          settings={(
            <SettingsSheet
              mode={viewportMode}
              themeMode={themeMode}
              onThemeChange={setThemeMode}
              onOpenChange={(open) => open && panelState.setDetent("peek")}
            />
          )}
          onRefreshWeather={weatherFeed.refresh}
          onOpenRecommendation={setEditorRequest}
        />
      </DashboardShell>


    </div>
  );
}

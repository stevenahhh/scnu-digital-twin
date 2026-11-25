import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClearColor } from "../lighting/atmosphere.mjs";
import { CampusCanvas } from "../render/CampusCanvas";
import { clearCampusModel } from "../render/CampusScene";
import { useCampusRendering } from "../render/useCampusRendering.mjs";
import { useInteractionDpr } from "../render/interactionDpr.mjs";
import { QUALITY_LABELS, QUALITY_TIERS } from "../settings/qualityPreset.mjs";
import { useCampusCamera } from "../camera/useCampusCamera.mjs";
import { CAMERA_PRESETS, D4_PRESET_ID } from "../camera/cameraPresets.mjs";
import { useSceneWeather } from "../weather/useSceneWeather.mjs";
import { isD4ElementId } from "../utils/d4BuildingData.mjs";
import { CampusHud } from "../components/CampusHud";
import { PanelErrorBoundary } from "../components/PanelErrorBoundary";
import { SceneLoadingNotice } from "../components/SceneLoadingNotice";
import { Spinner } from "../ui/Spinner.jsx";
import { gateTextFor } from "../labels/gateDistance.mjs";
import { useViewportMode } from "../hooks/useViewportMode.mjs";
import { useWeatherFeed } from "../hooks/useWeatherFeed";
import { useTrafficFeed } from "../simulation/hooks/useTrafficFeed";
import { usePopupData } from "../hooks/usePopupData.mjs";
import { useSelectionState } from "../hooks/useSelectionState.mjs";
import { useSunClock } from "../hooks/useSunClock.mjs";
import { useThemeMode } from "../hooks/useThemeMode.mjs";
import { useMainBuildingFlow } from "../hooks/useMainBuildingFlow.mjs";
import { useDashboardUrlState } from "../hooks/useDashboardUrlState.mjs";
import { useFeedStatus } from "../hooks/useFeedStatus.mjs";
import { BuildingEmptyState } from "../panel/BuildingEmptyState";
import { DASHBOARD_TABS, DEFAULT_TAB } from "../panel/DashboardPanel";
import { DashboardShell, shellInsetRight, useSettledOpen } from "../panel/DashboardShell";
import { MoreMenu } from "../panel/MoreMenu";
import { SelectionInspector } from "../panel/SelectionInspector";
import { StatusTab } from "../panel/StatusTab";
import { usePanelState } from "../panel/usePanelState.mjs";
import { useDashboardNavigation } from "../panel/useDashboardNavigation.mjs";
import { summarizeWeather } from "../panel/weatherSummary.mjs";
import { statusTabAlerts } from "../panel/tabAlerts.mjs";
import { buildingNotice } from "../restrictions/restrictionModel.mjs";
import { useCampusRestrictions } from "../restrictions/useCampusRestrictions.mjs";
import { sessionStore } from "../auth/session.mjs";
import { accountLabel, useSession } from "../auth/useSession.mjs";
import { assistantTabs } from "../assistant/assistantTab.mjs";
import { assistantContext, applyAssistantAction } from "../assistant/assistantActions.mjs";
import { useAssistant } from "../assistant/useAssistant.mjs";
import { AssistantPanel } from "../assistant/AssistantPanel.jsx";

const D4SectionExperience = lazy(() => import("../vworld/D4SectionExperience").then((module) => ({ default: module.D4SectionExperience })));
const ROOT_CLASS = "dashboard-root relative h-dvh w-screen overflow-clip bg-canvas text-ink";
const D4_PRESET = CAMERA_PRESETS.find((preset) => preset.id === D4_PRESET_ID);
// 학생 화면은 건물·현황·도우미를 제공한다. 도우미의 쓰기 권한은 서버에서 검사한다.
export const STUDENT_TABS = Object.freeze(assistantTabs(DASHBOARD_TABS.filter((tab) => tab.value === "building" || tab.value === "status")));
const isStudentTab = (value) => STUDENT_TABS.some((tab) => tab.value === value);
// 학생 화면은 설치 계획을 읽지 않는다. 피드 집계(useFeedStatus)에는 빈 목록을 넘긴다.
const NO_PLANS = Object.freeze({ status: "ready", plans: [], retry() {} });
const noop = () => {};

// 학생용 화면: 관리자 대시보드와 같은 3D 캠퍼스 위에 검색, 건물 정보, 현재 기상·주차, D4 강의실 현황만 둔다.
// 읽기 전용이다. 서버에 쓰는 기능(설치 계획, 시나리오, 시뮬레이션 제어)은 여기서 불러오지 않는다.
export default function AppStudent() {
  const orbitControlsRef = useRef(null);
  const panelRef = useRef(null);
  const mapLayerRef = useRef(null);
  const hudRef = useRef(null);
  const labelChromeRefs = useMemo(() => [hudRef], []);
  const [activeTab, setTab] = useState(DEFAULT_TAB);
  // 공유 링크가 관리자 탭을 가리켜도 학생 화면은 자기 탭만 연다.
  const setActiveTab = useCallback((tab) => setTab(isStudentTab(tab) ? tab : DEFAULT_TAB), []);
  const viewportMode = useViewportMode();
  const panelState = usePanelState(viewportMode);
  const navigation = useDashboardNavigation({ panelState, activeTab, setActiveTab });
  const [isTimePlaying, setIsTimePlaying] = useState(false);
  const [isSceneLoading, setIsSceneLoading] = useState(false);
  const [sceneAttempt, setSceneAttempt] = useState(0);
  const retryScene = () => {
    clearCampusModel();
    setSceneAttempt((value) => value + 1);
  };
  const [themeMode, setThemeMode] = useThemeMode();
  const session = useSession();
  const weatherFeed = useWeatherFeed();
  const trafficFeed = useTrafficFeed();
  const clock = useSunClock();
  const selection = useSelectionState();
  const feeds = useFeedStatus({ weather: weatherFeed, traffic: trafficFeed, plans: NO_PLANS });
  const restrictions = useCampusRestrictions();
  const panelScrollRef = useRef(null);
  const popup = usePopupData();
  const canvasStateRef = useRef(null);
  const getScene = useCallback(() => canvasStateRef.current?.scene ?? null, []);
  const interactionDpr = useInteractionDpr();
  const camera = useCampusCamera({
    controlsRef: orbitControlsRef,
    getScene,
    onOrbitStart: interactionDpr.onStart,
    onOrbitEnd: interactionDpr.onEnd,
  });
  const flow = useMainBuildingFlow({
    selection,
    popup,
    panel: { activeTab, setActiveTab, scrollRef: panelScrollRef, onSelectionShown: navigation.showSelection },
    activePresetRef: camera.activePresetRef,
    onSectionEnter: useCallback(() => camera.selectPreset(D4_PRESET), [camera.selectPreset]),
    onSectionExit: noop,
  });
  const isCampus = flow.buildingViewMode === "campus";
  const assistant = useAssistant({
    session, active: activeTab === "assistant",
    context: () => assistantContext({ selection, activeTab, flow, clock }),
    onAction: (event) => applyAssistantAction(event, { flow, camera, clock, panelState, setActiveTab, role: session?.account.role }),
    onWriteComplete: restrictions.refresh,
  });
  useDashboardUrlState({
    building: isCampus ? selection.selectedId : "BLD_D4", onBuilding: flow.selectFromUrl,
    clock, panelState, activeTab, setActiveTab, controlsRef: orbitControlsRef,
  });
  const rendering = useCampusRendering({
    canvasStateRef,
    interactionDpr,
    modalOpen: false,
    selectionKey: `${selection.selectedId}|${clock.sunState.visible}|${isSceneLoading}`,
    panelKey: `${panelState.open}|${panelState.detent}|${activeTab}|${flow.buildingViewMode}`,
  });
  const qualitySetting = {
    tiers: QUALITY_TIERS, labels: QUALITY_LABELS, value: rendering.quality,
    onChange: rendering.setQuality, source: rendering.qualitySource,
  };
  const panelShown = useSettledOpen(panelState.open);
  const mapInsetRight = shellInsetRight(viewportMode, panelShown, !isCampus);
  const summary = summarizeWeather({ feed: weatherFeed, mode: clock.mode, simTemp: clock.simTemp });
  const sceneWeather = useSceneWeather({ weatherData: weatherFeed.data, weatherState: weatherFeed.state });

  // D4 실내가 열리면 시간 재생을 멈춘다. 가려진 장면을 계속 움직일 이유가 없다.
  useEffect(() => {
    if (!isCampus) setIsTimePlaying(false);
  }, [isCampus]);

  const handleSearchPick = (entry) => {
    flow.selectFromSearch(entry);
    if (viewportMode === "phone" && entry.displayName?.endsWith(" · 공사 중")) panelState.setDetent("peek");
    camera.flyToBuilding(entry.elementId);
  };
  const panelTitle = selection.selectedId ? flow.selectionTitle || selection.selectedTitle || selection.selectedId : "";
  const inspector = isCampus && selection.selectedId ? (
    <SelectionInspector
      notice={buildingNotice(restrictions.items, selection.selectedId)}
      title={panelTitle}
      popup={popup}
      estimate={selection.selectedEstimate}
      gateText={gateTextFor(flow.selectionPosition)}
      onOpenIndoor={isD4ElementId(`BLD_${selection.selectedBuildingId}`) ? () => flow.openD4Section() : null}
      onClose={flow.closeMicroclimate}
      onShowAll={() => {
        flow.closeMicroclimate();
        camera.goHome();
      }}
    />
  ) : null;

  return (
    <div data-qa="student-app" className={ROOT_CLASS}>
      <div className="absolute inset-0" style={{ background: getClearColor(clock.sunState.altitude) }} />
      <CampusHud
        ref={hudRef}
        mode={viewportMode}
        insetRight={mapInsetRight}
        moreMenu={(
          <MoreMenu
            mode={viewportMode} quality={qualitySetting} themeMode={themeMode} onThemeChange={setThemeMode}
            accountLabel={session && accountLabel(session.account)} onLogout={sessionStore.logout}
          />
        )}
        camera={camera}
        clock={clock}
        playing={isTimePlaying}
        onPlayingChange={setIsTimePlaying}
        sceneWeather={sceneWeather}
        search={{ registry: flow.labelRegistry, onPick: handleSearchPick }}
        sheetDetent={viewportMode === "phone" ? (isCampus ? panelState.detent : "full") : null}
      />
      <CampusCanvas
        ref={mapLayerRef}
        insetRight={mapInsetRight}
        rendering={rendering}
        sunState={clock.sunState}
        sceneDate={clock.sunDate}
        weatherScene={sceneWeather.scene}
        camera={camera}
        flow={flow}
        scene={{
          controlsRef: orbitControlsRef,
          selectedId: selection.selectedId,
          labelsHidden: !isCampus,
          occluderRef: panelRef,
          chromeRefs: labelChromeRefs,
          onLoadingChange: setIsSceneLoading,
          attempt: sceneAttempt,
          presentation: false,
          restrictions: restrictions.items,
        }}
      />
      {isSceneLoading && <SceneLoadingNotice key={sceneAttempt} insetRight={mapInsetRight} onRetry={retryScene} />}
      <DashboardShell
        ref={panelRef}
        mode={viewportMode}
        open={panelState.open}
        onOpenChange={panelState.setUserOpen}
        detent={panelState.detent}
        onDetentChange={panelState.setDetent}
        hasSelection={isCampus && Boolean(selection.selectedId)}
        onPaneExit={flow.exitD4Section}
        pane={!isCampus && (
          <Suspense fallback={<div className="grid h-full place-items-center bg-surface-1"><Spinner label="D4 실내를 불러오는 중" /></div>}>
            <D4SectionExperience buildingId="D4" onClose={flow.exitD4Section} />
          </Suspense>
        )}
        tabs={STUDENT_TABS}
        tabAlerts={statusTabAlerts(feeds, restrictions.items)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        scrollRef={panelScrollRef}
      >
        {activeTab === "assistant" && <AssistantPanel assistant={assistant} />}
        {activeTab === "building" && (
          <PanelErrorBoundary label="건물">{inspector ?? <BuildingEmptyState />}</PanelErrorBoundary>
        )}
        {activeTab === "status" && (
          <PanelErrorBoundary label="현황">
            <StatusTab summary={summary} feeds={feeds} retry={feeds.retry} trafficFeed={trafficFeed} restrictions={restrictions.items} />
          </PanelErrorBoundary>
        )}
      </DashboardShell>
    </div>
  );
}

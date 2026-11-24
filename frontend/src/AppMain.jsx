import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cx } from "./ui/cx.mjs";
import { getClearColor } from "./lighting/atmosphere.mjs";
import { CampusCanvas } from "./render/CampusCanvas";
import { clearCampusModel } from "./render/CampusScene";
import { useCampusRendering } from "./render/useCampusRendering.mjs";
import { useInteractionDpr } from "./render/interactionDpr.mjs";
import { QUALITY_LABELS, QUALITY_TIERS } from "./settings/qualityPreset.mjs";
import { useCampusCamera } from "./camera/useCampusCamera.mjs";
import { CAMERA_PRESETS, D4_PRESET_ID } from "./camera/cameraPresets.mjs";
import { useSceneWeather } from "./weather/useSceneWeather.mjs";
import { isD4ElementId } from "./utils/d4BuildingData.mjs";
import { CampusHud } from "./components/CampusHud";
import { SceneLoadingNotice } from "./components/SceneLoadingNotice";
import { SelectionInspector } from "./panel/SelectionInspector";
import { CompareButton, ComparisonPane } from "./panel/ComparisonPane";
import { useComparisonSet } from "./state/useComparisonSet.mjs";
import { gateTextFor } from "./labels/gateDistance.mjs";
import { useSimulationSocket } from "./simulation";
import { MainD4Pane } from "./panel/MainD4Pane";
import { useViewportMode } from "./hooks/useViewportMode.mjs";
import { useWeatherFeed } from "./hooks/useWeatherFeed";
import { useTrafficFeed } from "./simulation/hooks/useTrafficFeed";
import { usePopupData } from "./hooks/usePopupData.mjs";
import { useInstallationPlans } from "./hooks/useInstallationPlans.mjs";
import { useSelectionState } from "./hooks/useSelectionState.mjs";
import { useSunClock } from "./hooks/useSunClock.mjs";
import { useThemeMode } from "./hooks/useThemeMode.mjs";
import { useMainBuildingFlow } from "./hooks/useMainBuildingFlow.mjs";
import { useDashboardUrlState } from "./hooks/useDashboardUrlState.mjs";
import { DashboardShell, shellInsetRight, useSettledOpen } from "./panel/DashboardShell";
import { DEFAULT_TAB } from "./panel/DashboardPanel";
import { usePanelState } from "./panel/usePanelState.mjs";
import { useDashboardNavigation } from "./panel/useDashboardNavigation.mjs";
import { CampusEnergyOverview } from "./panel/CampusEnergyOverview";
import { DashboardTabContent } from "./panel/DashboardTabContent";
import { MoreMenu } from "./panel/MoreMenu";
import { usePresentationMode } from "./panel/usePresentationMode.mjs";
import { tourPosition } from "./panel/presentationLayout.mjs";
import { statusTabAlerts } from "./panel/tabAlerts.mjs";
import { buildingNotice } from "./restrictions/restrictionModel.mjs";
import { useCampusRestrictions } from "./restrictions/useCampusRestrictions.mjs";
import { useFeedStatus } from "./hooks/useFeedStatus.mjs";
import { summarizeWeather } from "./panel/weatherSummary.mjs";
import { sessionStore } from "./auth/session.mjs";
import { accountLabel, useSession } from "./auth/useSession.mjs";
import { ModelEditorPanel } from "./editor/ModelEditorPanel";
import { modelEditStore } from "./editor/modelEditsApi.mjs";

const ROOT_CLASS = "dashboard-root relative h-dvh w-screen overflow-clip bg-canvas text-ink";
const D4_PRESET = CAMERA_PRESETS.find((preset) => preset.id === D4_PRESET_ID);

export default function App() {
  return <Dashboard />;
}

function Dashboard() {
  useSimulationSocket();
  const editing = useSyncExternalStore(modelEditStore.subscribe, () => modelEditStore.getState().editing);
  const orbitControlsRef = useRef(null);
  const panelRef = useRef(null);
  const mapLayerRef = useRef(null);
  const hudRef = useRef(null);
  // 캠퍼스 라벨은 이 조작 UI 밑에 그려지므로, 겹치는 라벨은 CityModel이 숨긴다.
  const labelChromeRefs = useMemo(() => [hudRef], []);
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
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
  const comparison = useComparisonSet();
  const plans = useInstallationPlans(selection.selectedBuildingId);
  const feeds = useFeedStatus({ weather: weatherFeed, traffic: trafficFeed, plans });
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
    onSectionExit: plans.refreshAll,
  });
  const isCampus = flow.buildingViewMode === "campus";
  useDashboardUrlState({
    building: isCampus ? selection.selectedId : "BLD_D4", onBuilding: flow.selectFromUrl,
    clock, panelState, activeTab, setActiveTab, controlsRef: orbitControlsRef,
  });
  const rendering = useCampusRendering({
    canvasStateRef,
    interactionDpr,
    // D4 패인은 지도 옆에 열리고 장면은 계속 보이므로(카메라가 D4로 날아간다) 그리기를 멈추지 않는다.
    modalOpen: false,
    selectionKey: `${selection.selectedId}|${clock.sunState.visible}|${isSceneLoading}`,
    panelKey: `${panelState.open}|${panelState.detent}|${activeTab}|${flow.buildingViewMode}`,
  });

  // 지도·HUD·안내는 패널(또는 레일)이 차지한 오른쪽 폭만큼 비켜 선다. 닫히는 패널은 다 닫힌 뒤에 자리를 내준다.
  const presentation = usePresentationMode({
    panelState, activeTab, setActiveTab, touring: camera.touring, stopTour: camera.stopTour,
  });
  const qualitySetting = {
    tiers: QUALITY_TIERS, labels: QUALITY_LABELS, value: rendering.quality,
    onChange: rendering.setQuality, source: rendering.qualitySource,
  };
  const panelShown = useSettledOpen(panelState.open);
  const mapInsetRight = presentation.presenting ? "0px" : shellInsetRight(viewportMode, panelShown, !isCampus);

  const summary = summarizeWeather({ feed: weatherFeed, mode: clock.mode, simTemp: clock.simTemp });
  const sceneWeather = useSceneWeather({ weatherData: weatherFeed.data, weatherState: weatherFeed.state });

  // D4 상세가 열리면 캠퍼스 카메라 투어와 시간 재생을 멈춘다. 뒤에 가려진 장면을 계속 움직일 이유가 없다.
  const { stopTour } = camera;
  useEffect(() => {
    if (isCampus) return;
    stopTour();
    setIsTimePlaying(false);
  }, [isCampus, stopTour]);

  const openRecommendation = (request) => {
    selection.setSelectedBuildingId(request.buildingId);
    flow.openD4Section(request);
  };
  // 검색 결과: 칩 클릭과 같은 선택에 더해 카메라를 그 건물로 옮긴다.
  const handleSearchPick = (entry) => {
    flow.selectFromSearch(entry);
    camera.flyToBuilding(entry.elementId);
  };
  // 인스펙터 제목: 고른 건물의 레지스트리 이름, 없으면 클릭한 메시의 이름.
  const panelTitle = selection.selectedId ? flow.selectionTitle || selection.selectedTitle || selection.selectedId : "";
  const inspector = comparison.open ? (
    <ComparisonPane ids={comparison.ids} onRemove={comparison.remove} onClose={() => comparison.setOpen(false)} />
  ) : isCampus && selection.selectedId ? (
    <SelectionInspector
      notice={buildingNotice(restrictions.items, selection.selectedId)}
      title={panelTitle}
      popup={popup}
      estimate={selection.selectedEstimate}
      gateText={gateTextFor(flow.selectionPosition)}
      onCompare={() => comparison.add(selection.selectedId)}
      compare={comparison.ids.length > 0 && <CompareButton comparison={comparison} />}
      onOpenIndoor={isD4ElementId(`BLD_${selection.selectedBuildingId}`) ? () => flow.openD4Section() : null}
      onClose={flow.closeMicroclimate}
      onShowAll={() => { flow.closeMicroclimate(); camera.goHome(); }}
    />
  ) : null;

  const moreMenu = (
    <MoreMenu mode={viewportMode} onTogglePresentation={presentation.toggle} quality={qualitySetting}
      themeMode={themeMode} onThemeChange={setThemeMode}
      accountLabel={session && accountLabel(session.account)} onLogout={session && sessionStore.logout} />
  );

  // 루트는 overflow: clip으로 자른다. hidden은 스크롤 컨테이너라서 Tab 포커스가 화면 밖 요소로 가면 대시보드가 밀려 남는다.
  return (
    <div className={cx(ROOT_CLASS, presentation.cursorHidden && "cursor-none")}>
      <div className="absolute inset-0" style={{ background: getClearColor(clock.sunState.altitude) }} />
      {/* HUD는 D4 패인이 열려도 남는다: 시각·시점 메뉴가 패인 왼쪽 장면 위에 그대로 있다. */}
      <CampusHud
        ref={hudRef}
        mode={viewportMode}
        insetRight={mapInsetRight}
        presenting={presentation.presenting}
        onTogglePresentation={presentation.toggle}
        tour={camera.touring ? tourPosition(CAMERA_PRESETS, camera.activePresetId) : null}
        moreMenu={moreMenu}
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
          labelsHidden: !isCampus || editing,
          occluderRef: panelRef,
          chromeRefs: labelChromeRefs,
          onLoadingChange: setIsSceneLoading,
          attempt: sceneAttempt,
          presentation: presentation.presenting,
          onCompare: comparison.add,
          restrictions: restrictions.items,
        }}
      />
      {isCampus && !presentation.presenting && <ModelEditorPanel />}
      {isSceneLoading && <SceneLoadingNotice key={sceneAttempt} insetRight={mapInsetRight} onRetry={retryScene} />}
      <DashboardShell
        ref={panelRef}
        mode={viewportMode}
        open={panelState.open}
        onOpenChange={panelState.setUserOpen}
        detent={panelState.detent}
        onDetentChange={panelState.setDetent}
        hidden={presentation.presenting}
        hasSelection={isCampus && Boolean(selection.selectedId)}
        tabAlerts={statusTabAlerts(feeds, restrictions.items)}
        onPaneExit={flow.exitD4Section}
        pane={!isCampus && (
          <MainD4Pane
            flow={flow} selection={selection} plans={plans} camera={camera} phone={viewportMode === "phone"}
          />
        )}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        scrollRef={panelScrollRef}
      >
        <DashboardTabContent
          activeTab={activeTab}
          building={inspector}
          summary={summary}
          feeds={feeds}
          clock={clock}
          trafficFeed={trafficFeed}
          plans={plans}
          buildingId={selection.selectedBuildingId}
          hasSelection={Boolean(selection.selectedId)}
          onOpenRecommendation={openRecommendation}
          restrictions={restrictions}
          campusOverview={(
            <CampusEnergyOverview refreshKey={plans.overlayRefreshKey} />
          )}
        />
      </DashboardShell>
    </div>
  );
}

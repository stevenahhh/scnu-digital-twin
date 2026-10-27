import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { sceneTimeReadout } from "./components/HudTimeReadout";
import { SceneLoadingNotice } from "./components/SceneLoadingNotice";
import { SelectionInspector } from "./panel/SelectionInspector";
import { CompareButton, ComparisonPane } from "./panel/ComparisonPane";
import { useComparisonSet } from "./state/useComparisonSet.mjs";
import { gateTextFor } from "./labels/gateDistance.mjs";
import { PanelErrorBoundary } from "./components/PanelErrorBoundary";
import { useSimulationSocket } from "./simulation";
import { LegacyD4Pane } from "./panel/LegacyD4Pane";
import { useViewportMode } from "./hooks/useViewportMode.mjs";
import { useWeatherFeed } from "./hooks/useWeatherFeed";
import { useTrafficFeed } from "./simulation/hooks/useTrafficFeed";
import { usePopupData } from "./hooks/usePopupData.mjs";
import { useInstallationPlans } from "./hooks/useInstallationPlans.mjs";
import { useSelectionState } from "./hooks/useSelectionState.mjs";
import { useSunClock } from "./hooks/useSunClock.mjs";
import { useThemeMode } from "./hooks/useThemeMode.mjs";
import { useLegacyBuildingFlow } from "./hooks/useLegacyBuildingFlow.mjs";
import { useDashboardUrlState } from "./hooks/useDashboardUrlState.mjs";
import { DashboardShell, shellInsetRight } from "./panel/DashboardShell";
import { usePanelState } from "./panel/usePanelState.mjs";
import { CampusEnergyOverview } from "./panel/CampusEnergyOverview";
import { DashboardTabContent } from "./panel/DashboardTabContent";
import { SettingsSheet } from "./panel/SettingsSheet";
import { usePresentationMode } from "./panel/usePresentationMode.mjs";
import { tourPosition } from "./panel/presentationLayout.mjs";
import { FeedStamps, sheetPlacement } from "./panel/FeedStatus";
import { useFeedStatus } from "./hooks/useFeedStatus.mjs";
import { summarizeWeather } from "./panel/weatherSummary.mjs";

// ?ui=gallery는 공용 기본 요소 확인 화면만 띄운다. 따로 나눠 불러와 대시보드 번들에는 들어가지 않는다.
const UiGallery = lazy(() => import("./ui/Gallery.jsx"));
const ROOT_CLASS = "dashboard-root relative h-dvh w-screen overflow-clip bg-canvas text-ink";
const D4_PRESET = CAMERA_PRESETS.find((preset) => preset.id === D4_PRESET_ID);
const SHOW_UI_GALLERY = new URLSearchParams(window.location.search).get("ui") === "gallery";

export default function App() {
  if (SHOW_UI_GALLERY) {
    return (
      <Suspense fallback={null}>
        <UiGallery />
      </Suspense>
    );
  }
  return <Dashboard />;
}

function Dashboard() {
  useSimulationSocket();
  const orbitControlsRef = useRef(null);
  const panelRef = useRef(null);
  const mapLayerRef = useRef(null);
  const hudRef = useRef(null);
  const inspectorRef = useRef(null);
  // 캠퍼스 라벨은 이 조작 UI 밑에 그려지므로, 겹치는 라벨은 CityModel이 숨긴다.
  const labelChromeRefs = useMemo(() => [hudRef, inspectorRef], []);
  const [activeTab, setActiveTab] = useState("dashboard");
  const viewportMode = useViewportMode();
  const panelState = usePanelState(viewportMode);
  const [isTimePlaying, setIsTimePlaying] = useState(false);
  const [isSceneLoading, setIsSceneLoading] = useState(false);
  const [sceneAttempt, setSceneAttempt] = useState(0);
  const retryScene = () => {
    clearCampusModel();
    setSceneAttempt((value) => value + 1);
  };
  const [themeMode, setThemeMode] = useThemeMode();
  const weatherFeed = useWeatherFeed();
  const trafficFeed = useTrafficFeed();
  const clock = useSunClock();
  const selection = useSelectionState();
  const comparison = useComparisonSet();
  const plans = useInstallationPlans(selection.selectedBuildingId);
  const feeds = useFeedStatus({ weather: weatherFeed, traffic: trafficFeed, plans });
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
  const flow = useLegacyBuildingFlow({
    selection,
    popup,
    panel: { activeTab, setActiveTab, scrollRef: panelScrollRef, onSelectionShown: panelState.revealOnPhone },
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

  // 지도·HUD·안내는 패널(또는 레일)이 차지한 오른쪽 폭만큼 비켜 선다. 폰 시트 위 장면은 계속 조작할 수 있다.
  const presentation = usePresentationMode({ panelState, activeTab, setActiveTab });
  const qualitySetting = { tiers: QUALITY_TIERS, labels: QUALITY_LABELS, value: rendering.quality };
  qualitySetting.onChange = rendering.setQuality;
  qualitySetting.source = rendering.qualitySource;
  const mapInsetRight = presentation.presenting
    ? "0px" : shellInsetRight(viewportMode, panelState.open, !isCampus, Boolean(selection.selectedId));

  const summary = summarizeWeather({ feed: weatherFeed, mode: clock.mode, simTemp: clock.simTemp });
  const sceneWeather = useSceneWeather({ weatherData: weatherFeed.data, weatherState: weatherFeed.state });

  // D4 상세가 열리면 캠퍼스 카메라 투어와 시간 재생을 멈춘다. 뒤에 가려진 장면을 계속 움직일 이유가 없다.
  const { stopTour } = camera;
  useEffect(() => {
    if (isCampus) return;
    stopTour();
    setIsTimePlaying(false);
  }, [isCampus, stopTour]);

  const selectFromEnergy = (buildingId) => {
    const elementId = flow.selectBuilding({ elementId: `BLD_${buildingId}`, buildingId, displayName: buildingId });
    if (isD4ElementId(elementId)) flow.openD4Section();
  };
  const openRecommendation = (request) => {
    selection.setSelectedBuildingId(request.buildingId);
    flow.openD4Section(request);
  };
  // 검색 결과: 칩 클릭과 같은 선택에 더해 카메라를 그 건물로 옮긴다.
  const handleSearchPick = (entry) => {
    flow.selectFromSearch(entry);
    camera.flyToBuilding(entry.elementId);
  };
  const editor = flow.editorRequest;
  // 인스펙터 제목: 고른 건물의 레지스트리 이름, 없으면 클릭한 메시의 이름.
  const panelTitle = selection.selectedId ? flow.selectionTitle || selection.selectedTitle || selection.selectedId : "";
  const inspector = comparison.open ? (
    <ComparisonPane ids={comparison.ids} onRemove={comparison.remove} onClose={() => comparison.setOpen(false)} />
  ) : isCampus && selection.selectedId ? (
    <SelectionInspector
      title={panelTitle}
      popup={popup}
      estimate={selection.selectedEstimate}
      gateText={gateTextFor(flow.selectionPosition)}
      onCompare={() => comparison.add(selection.selectedId)}
      onClose={flow.closeMicroclimate}
      onShowAll={() => {
        flow.closeMicroclimate();
        camera.goHome();
      }}
    />
  ) : null;

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
        statusSlot={viewportMode !== "phone" && (
          <FeedStamps feeds={feeds} retry={feeds.retry} placement={{ expanded: panelState.open, activeTab }} />
        )}
        camera={camera}
        clock={clock}
        playing={isTimePlaying}
        onPlayingChange={setIsTimePlaying}
        sceneWeather={sceneWeather}
        compareSlot={<CompareButton comparison={comparison} className="mt-1" />}
        search={{ registry: flow.labelRegistry, onPick: handleSearchPick }}
      />
      <CampusCanvas
        ref={mapLayerRef}
        insetRight={mapInsetRight}
        rendering={rendering}
        sunState={clock.sunState}
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
          presentation: presentation.presenting,
          onCompare: comparison.add,
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
        hidden={presentation.presenting}
        onPaneExit={flow.exitD4Section}
        pane={!isCampus && (
          <LegacyD4Pane
            flow={flow} selection={selection} plans={plans} camera={camera} phone={viewportMode === "phone"}
          />
        )}
        timeReadout={sceneTimeReadout(clock.sceneMinuteOfDay)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        inspector={inspector}
        inspectorRef={inspectorRef}
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
              quality={qualitySetting}
              onOpenChange={(open) => open && panelState.setDetent("peek")}
            />
          )}
          onRefreshWeather={weatherFeed.refresh}
          onOpenRecommendation={openRecommendation}
          campusOverview={(
            <CampusEnergyOverview
              onSelection={flow.selectBuilding}
              onBuildingSelect={selectFromEnergy}
              refreshKey={plans.overlayRefreshKey}
              selectedBuildingId={selection.selectedBuildingId}
            />
          )}
        />
      </DashboardShell>
    </div>
  );
}

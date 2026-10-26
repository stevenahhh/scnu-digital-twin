import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sceneBackgroundFor } from "./lighting/sceneBackground.mjs";
import { CampusCanvas } from "./render/CampusCanvas";
import { useCampusRendering } from "./render/useCampusRendering.mjs";
import { useInteractionDpr } from "./render/interactionDpr.mjs";
import { QUALITY_LABELS, QUALITY_TIERS } from "./settings/qualityPreset.mjs";
import { useCampusCamera } from "./camera/useCampusCamera.mjs";
import { useSceneWeather } from "./weather/useSceneWeather.mjs";
import { isD4ElementId } from "./utils/d4BuildingData.mjs";
import { CampusHud } from "./components/CampusHud";
import { SceneLoadingNotice } from "./components/SceneLoadingNotice";
import { MicroclimatePanel } from "./components/MicroclimatePanel";
import { PanelErrorBoundary } from "./components/PanelErrorBoundary";
import { useSimulationSocket } from "./simulation";
import { D4SectionExperience } from "./vworld/D4SectionExperience";
import { createPlanDraftFromExisting } from "./features/energy/installations/installationPlanApi.mjs";
import { usePanelCoversViewport } from "./hooks/usePanelCoversViewport";
import { useInert } from "./hooks/useInert.mjs";
import { useWeatherFeed } from "./hooks/useWeatherFeed";
import { useTrafficFeed } from "./simulation/hooks/useTrafficFeed";
import { usePopupData } from "./hooks/usePopupData.mjs";
import { useInstallationPlans } from "./hooks/useInstallationPlans.mjs";
import { useSelectionState } from "./hooks/useSelectionState.mjs";
import { useSunClock } from "./hooks/useSunClock.mjs";
import { useThemeMode } from "./hooks/useThemeMode.mjs";
import { useLegacyBuildingFlow } from "./hooks/useLegacyBuildingFlow.mjs";
import { DashboardPanel } from "./panel/DashboardPanel";
import { PanelToggle } from "./panel/PanelToggle";
import { BasicStatusTab } from "./panel/BasicStatusTab";
import { ParkingSafetyTab } from "./panel/ParkingSafetyTab";
import { EnergyTab } from "./panel/EnergyTab";
import { CampusEnergyOverview } from "./panel/CampusEnergyOverview";
import { EnvironmentTab } from "./panel/EnvironmentTab";
import { SettingsDialog } from "./panel/SettingsDialog";
import { WeatherErrorBanner } from "./panel/WeatherErrorBanner";
import { summarizeWeather } from "./panel/weatherSummary.mjs";

// ?ui=gallery는 공용 기본 요소 확인 화면만 띄운다. 따로 나눠 불러와 대시보드 번들에는 들어가지 않는다.
const UiGallery = lazy(() => import("./ui/Gallery.jsx"));
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
  const sceneStatusRef = useRef(null);
  const hudRef = useRef(null);
  const panelToggleRef = useRef(null);
  // 캠퍼스 라벨은 이 조작 UI 밑에 그려지므로, 겹치는 라벨은 CityModel이 숨긴다.
  const labelChromeRefs = useMemo(() => [hudRef, panelToggleRef], []);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);
  const togglePanel = () => setIsPanelOpen((open) => !open);
  const [isTimePlaying, setIsTimePlaying] = useState(false);
  const [isSceneLoading, setIsSceneLoading] = useState(false);
  const [themeMode, setThemeMode] = useThemeMode();
  const weatherFeed = useWeatherFeed();
  const trafficFeed = useTrafficFeed();
  const clock = useSunClock();
  const selection = useSelectionState();
  const plans = useInstallationPlans(selection.selectedBuildingId);
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
    panel: { activeTab, setActiveTab, setIsPanelOpen },
    activePresetRef: camera.activePresetRef,
    onSectionExit: plans.refreshAll,
  });
  const isCampus = flow.buildingViewMode === "campus";
  const rendering = useCampusRendering({
    canvasStateRef,
    interactionDpr,
    modalOpen: !isCampus,
    selectionKey: `${selection.selectedId}|${clock.sunState.visible}|${isSceneLoading}`,
    panelKey: `${isPanelOpen}|${activeTab}|${flow.buildingViewMode}`,
  });

  const isPanelVisible = isCampus && isPanelOpen;
  const panelCoversViewport = usePanelCoversViewport();
  const isMapCoveredByPanel = isPanelVisible && panelCoversViewport;
  // 3D 지도 위 안내는 열린 패널을 뺀 지도 영역 가운데에 둔다.
  const mapInsetRight = isPanelVisible && !panelCoversViewport ? "var(--dashboard-panel-width)" : "0px";
  useInert([panelRef], !isPanelVisible, []);
  useInert([mapLayerRef, sceneStatusRef, hudRef], isMapCoveredByPanel, [isSceneLoading, flow.buildingViewMode]);

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
  const showMicroclimateTab = Boolean(selection.selectedId) || activeTab === "microclimate";
  const microclimateTab = showMicroclimateTab ? [{ value: "microclimate", label: "미기후" }] : [];
  const changeTab = (tab) => (tab === "microclimate" ? flow.openMicroclimateTab() : setActiveTab(tab));
  const editor = flow.editorRequest;
  // 미기후 패널 제목: 고른 건물의 레지스트리 이름, 없으면 클릭한 메시의 이름.
  const panelTitle = selection.selectedId ? flow.selectionTitle || selection.selectedTitle || selection.selectedId : "";

  // 루트는 overflow: clip으로 자른다. hidden은 스크롤 컨테이너라서 Tab 포커스가 화면 밖 요소로 가면 대시보드가 밀려 남는다.
  return (
    <div className="dashboard-root relative h-dvh w-screen overflow-clip bg-canvas text-ink">
      <div className="absolute inset-0" style={{ background: sceneBackgroundFor(clock.sunState.visible) }} />
      {isCampus && (
        <CampusHud
          ref={hudRef}
          hidden={isMapCoveredByPanel}
          insetRight={mapInsetRight}
          camera={camera}
          clock={clock}
          playing={isTimePlaying}
          onPlayingChange={setIsTimePlaying}
          sceneWeather={sceneWeather}
        />
      )}
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
        }}
      />
      {isSceneLoading && <SceneLoadingNotice ref={sceneStatusRef} insetRight={mapInsetRight} />}

      {!isCampus && (
        <D4SectionExperience
          buildingId={editor?.buildingId ?? selection.selectedBuildingId}
          scenarioId={editor?.scenarioId}
          installationPlanId={editor?.installationPlanId}
          startInstallation={Boolean(editor?.scenarioId || editor?.installationPlanId)}
          onClose={flow.exitD4Section}
          onPlanSaved={plans.refreshAll}
          createInstallationPlanDraft={createPlanDraftFromExisting}
          onPlansChange={plans.onPlansChange}
          onRepresentativeChange={plans.onRepresentativeChange}
          planRefreshKey={plans.refreshKey}
        />
      )}

      {isCampus && <PanelToggle ref={panelToggleRef} open={isPanelOpen} onToggle={togglePanel} />}

      <DashboardPanel
        ref={panelRef}
        visible={isPanelVisible}
        activeTab={activeTab}
        onTabChange={changeTab}
        extraTabs={microclimateTab}
        footer={weatherFeed.state === "error" && (
          <WeatherErrorBanner message={weatherFeed.message} onRetry={weatherFeed.refresh} busy={summary.isBusy} />
        )}
      >
        {activeTab === "dashboard" && (
          <PanelErrorBoundary label="기본 현황">
            <BasicStatusTab
              summary={summary}
              sunAltitudeDegrees={clock.sunAltitudeDegrees}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onRefreshWeather={weatherFeed.refresh}
            />
          </PanelErrorBoundary>
        )}
        {activeTab === "microclimate" && (
          <PanelErrorBoundary label="미기후">
            <MicroclimatePanel
              data={popup.data}
              loading={popup.loading}
              error={popup.error}
              title={panelTitle}
              estimate={selection.selectedId ? selection.selectedEstimate : null}
              onClose={flow.closeMicroclimate}
            />
          </PanelErrorBoundary>
        )}
        {activeTab === "parking_safety" && (
          <PanelErrorBoundary label="주차·안전">
            <ParkingSafetyTab trafficFeed={trafficFeed} />
          </PanelErrorBoundary>
        )}
        {activeTab === "energy" && (
          <PanelErrorBoundary label="에너지">
            <EnergyTab
              buildingId={selection.selectedBuildingId}
              plans={plans}
              onOpenRecommendation={openRecommendation}
              campusOverview={(
                <CampusEnergyOverview
                  onSelection={flow.selectBuilding}
                  onBuildingSelect={selectFromEnergy}
                  refreshKey={plans.overlayRefreshKey}
                />
              )}
            />
          </PanelErrorBoundary>
        )}
        {activeTab === "environment" && (
          <PanelErrorBoundary label="환경 시뮬">
            <EnvironmentTab clock={clock} />
          </PanelErrorBoundary>
        )}
      </DashboardPanel>

      {isSettingsOpen && (
        <SettingsDialog
          onClose={closeSettings}
          themeMode={themeMode}
          onThemeChange={setThemeMode}
          quality={{
            tiers: QUALITY_TIERS,
            labels: QUALITY_LABELS,
            value: rendering.quality,
            onChange: rendering.setQuality,
            source: rendering.qualitySource,
          }}
        />
      )}
    </div>
  );
}

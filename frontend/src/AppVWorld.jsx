import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DashboardShell, SHELL_PEEK_HEIGHT, shellInsetRight, useSettledOpen } from "./panel/DashboardShell";
import { DEFAULT_TAB, normalizeTab } from "./panel/DashboardPanel";
import { usePanelState } from "./panel/usePanelState.mjs";
import { usePanelViewMemory } from "./panel/usePanelViewMemory.mjs";
import { useDashboardNavigation } from "./panel/useDashboardNavigation.mjs";
import { CampusHud } from "./components/CampusHud";
import { isD4ElementId } from "./utils/d4BuildingData.mjs";
import { gateTextFor } from "./labels/gateDistance.mjs";
import { gateScenePositionOf } from "./vworld/labelAnchors.mjs";
import { tourPosition } from "./panel/presentationLayout.mjs";
import { mapLighting } from "./vworld/mapLighting.mjs";
import { QUALITY_LABELS, QUALITY_TIERS, useQualityPreset } from "./settings/qualityPreset.mjs";
import { VWORLD_DEFAULT_QUALITY, applyVWorldQuality } from "./vworld/renderQuality.mjs";
import { CAMERA_PRESETS } from "./camera/cameraPresets.mjs";
import { useVWorldCampusCamera } from "./vworld/useVWorldCampusCamera.mjs";
import { useSceneWeather } from "./weather/useSceneWeather.mjs";
import { usePresentationMode } from "./panel/usePresentationMode.mjs";
import { DashboardTabContent } from "./panel/DashboardTabContent";
import { CampusEnergyOverview } from "./panel/CampusEnergyOverview";
import { MoreMenu } from "./panel/MoreMenu";
import { feedIssueCount } from "./panel/FeedStatus";
import { useFeedStatus } from "./hooks/useFeedStatus.mjs";
import { isFeedDown } from "./hooks/feedStatusModel.mjs";
import { urlSelectionTarget, useDashboardUrlState } from "./hooks/useDashboardUrlState.mjs";
import { CompareButton, ComparisonPane } from "./panel/ComparisonPane";
import { useComparisonSet } from "./state/useComparisonSet.mjs";
import { summarizeWeather } from "./panel/weatherSummary.mjs";
import { useDashboardDemo } from "./vworld/dashboardDemo.mjs";

export default function App() {
  useSimulationSocket();
  const panelRef = useRef(null);
  // 라벨이 피해 갈 HUD와 지도 위 문구·버튼 층. 통과용 레이어라 안쪽 요소 사각형을 쓴다.
  const hudRef = useRef(null);
  const overlayHostRef = useRef(null);
  const labelChromeRefs = useMemo(() => [hudRef, overlayHostRef], []);
  // Legacy와 같은 시점 버튼·투어(VWorld 카메라로 날아간다).
  const [campusCamera, setCampusCamera] = useState(null);
  const camera = useVWorldCampusCamera(campusCamera);
  const [editorRequest, setEditorRequest] = useState(null);
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
  const viewportMode = useViewportMode();
  const panelState = usePanelState(viewportMode);
  const navigation = useDashboardNavigation({ panelState, activeTab, setActiveTab });
  // VWorld 라벨 항목: 인스펙터에 Legacy와 같은 정문 거리·방위를 쓴다(GAP-37).
  const [vworldLabelEntries, setVWorldLabelEntries] = useState(null);
  // D4 상세 화면(자체 대화상자)이 열린 동안에는 건물 팝업을 띄우지 않는다. 화면 뒤에 가린 팝업이 키보드 포커스를 가두지 않게 한다.
  const [isD4SectionOpen, setIsD4SectionOpen] = useState(false);
  // D4 상세가 그려질 셸의 패인 자리, 레일에서 다른 탭을 골라 D4를 닫을 때 바꾸는 값, 인스펙터의 `실내 보기`로 D4를 열 때 바꾸는 값.
  const [d4PaneHost, setD4PaneHost] = useState(null);
  const [d4CloseKey, setD4CloseKey] = useState(0);
  const [d4OpenKey, setD4OpenKey] = useState(0);
  // 지도 대표 설치 계획 레이어의 자료(계약 C2). 에너지 탭이 채우기 전(undefined)에는 렌더러가 스스로 불러온다.
  const [representativeOverlays, setRepresentativeOverlays] = useState(undefined);
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

  const summary = summarizeWeather({ feed: weatherFeed, mode: clock.mode, simTemp: clock.simTemp });
  const sceneWeather = useSceneWeather({ weatherData: weatherFeed.data, weatherState: weatherFeed.state });
  const lighting = mapLighting(clock.sunAltitudeDegrees);

  // VWorld에서 건물을 고르면 Legacy와 같은 선택 인스펙터가 건물 탭에 열린다. D4는 D4 상세(패인)로 열리므로 패널을 열지 않는다.
  const { selectBuilding, clearSelection } = selection;
  const { load: loadPopup, clear: clearPopup } = popup;
  const { showSelection } = navigation;
  const handleVWorldSelection = useCallback((target) => {
    selectBuilding(target);
    if (target.elementId?.startsWith("BLD_")) {
      if (!isD4ElementId(target.elementId)) showSelection();
      loadPopup(target.elementId);
    } else clearPopup();
  }, [clearPopup, loadPopup, selectBuilding, showSelection]);
  // 시연 일정은 예전 탭 값을 쓴다. 그 내용이 옮겨 간 새 탭으로 연다.
  const setDemoTab = useCallback((tab) => setActiveTab(normalizeTab(tab) ?? DEFAULT_TAB), []);
  useDashboardDemo({
    selectBuilding: handleVWorldSelection,
    setActiveTab: setDemoTab,
    setPanelOpen: panelState.setProgrammaticOpen,
    setMode: clock.setMode,
    setSimTemp: clock.setSimTemp,
    setSunMonth: clock.setSunMonth,
    setSunDay: clock.setSunDay,
    setSunHour: clock.setSunHour,
    setSunMinute: clock.setSunMinute,
  });
  // 렌더링 품질: Legacy와 같은 설정(같은 저장 값)을 Cesium의 해상도·보정·그림자로 옮긴다. 고른 값이 없으면 높음.
  const rendering = useQualityPreset();
  const qualityTier = rendering.qualitySource ? rendering.quality : VWORLD_DEFAULT_QUALITY;
  useEffect(() => {
    applyVWorldQuality(qualityTier);
  }, [qualityTier, campusCamera]);
  const qualitySetting = { tiers: QUALITY_TIERS, labels: QUALITY_LABELS, value: qualityTier, onChange: rendering.setQuality, source: rendering.qualitySource };
  // 공유 링크: 건물·장면 시각·패널·탭·카메라 시점. 캠퍼스 카메라가 준비되기 전에는 시점이 없다(주소의 시점은 준비될 때까지 다시 시도해 놓는다).
  const campusCameraRef = useRef(null);
  campusCameraRef.current = campusCamera;
  const cameraPose = useMemo(() => ({
    get: () => campusCameraRef.current?.poseOf() ?? null,
    apply: (pose) => campusCameraRef.current?.applyPose(pose) ?? false,
  }), []);
  useDashboardUrlState({
    building: selection.selectedId, onBuilding: (id) => handleVWorldSelection(urlSelectionTarget(id)),
    clock, panelState, activeTab, setActiveTab, cameraPose,
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
  const openD4 = () => setD4OpenKey((value) => value + 1);

  const [isTimePlaying, setIsTimePlaying] = useState(false);
  // D4 상세가 열리면 캠퍼스 카메라 투어와 시간 재생을 멈춘다(Legacy와 같은 규칙). 뒤에 가려진 장면을 계속 움직일 이유가 없다.
  const { stopTour } = camera;
  useEffect(() => {
    if (!isD4SectionOpen) return;
    stopTour();
    setIsTimePlaying(false);
  }, [isD4SectionOpen, stopTour]);

  // 지도 위 문구·버튼과 야간 음영은 패널(또는 레일)이 차지한 오른쪽 폭만큼 비켜 선다. 닫히는 패널은 다 닫힌 뒤에 자리를 내준다.
  const presentation = usePresentationMode({ panelState, activeTab, setActiveTab });
  const panelShown = useSettledOpen(panelState.open);
  const mapInsetRight = presentation.presenting ? "0px" : shellInsetRight(viewportMode, panelShown, isD4SectionOpen);
  // 폰에서는 바텀 시트의 peek 높이만큼 아래를 비운다.
  const mapInsetBottom = viewportMode === "phone" ? `${SHELL_PEEK_HEIGHT}px` : "0px";
  // 렌더러가 지도 위 문구·버튼(검색·카드)을 이 자리에 그린다. HUD가 지도보다 먼저 그려지므로 탭 순서가 HUD -> 칩 -> 패널이 된다.
  const [hudOverlayHost, setHudOverlayHost] = useState(null);
  const attachOverlayHost = useCallback((node) => {
    overlayHostRef.current = node;
    setHudOverlayHost(node);
  }, []);
  // 지도 위 왼쪽 열(검색·카드)은 HUD 줄 바로 아래에서 시작한다.
  useEffect(() => {
    const row = hudRef.current?.firstElementChild;
    if (!row || typeof ResizeObserver === "undefined") return undefined;
    const publish = () => document.documentElement.style.setProperty("--vworld-hud-bottom", `${Math.round(row.getBoundingClientRect().bottom)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(row);
    return () => observer.disconnect();
  }, [presentation.presenting]);

  const moreMenu = (
    <MoreMenu
      mode={viewportMode}
      onTogglePresentation={presentation.toggle}
      themeMode={themeMode}
      onThemeChange={setThemeMode}
      quality={qualitySetting}
    />
  );
  const selectedBuilding = selection.selectedId?.startsWith("BLD_") ? selection.selectedId : null;
  const d4Selected = Boolean(selection.selectedId) && isD4ElementId(`BLD_${selection.selectedBuildingId}`);
  const inspector = comparison.open ? (
    <ComparisonPane ids={comparison.ids} onRemove={comparison.remove} onClose={() => comparison.setOpen(false)} />
  ) : selection.selectedId && !isD4SectionOpen ? (
    <SelectionInspector
      title={selection.selectedTitle || popup.data?.name || selection.selectedId}
      popup={popup}
      onCompare={selectedBuilding ? () => comparison.add(selectedBuilding) : null}
      compare={comparison.ids.length > 0 && <CompareButton comparison={comparison} />}
      onOpenIndoor={d4Selected ? openD4 : null}
      gateText={gateTextFor(gateScenePositionOf(vworldLabelEntries, `BLD_${selection.selectedBuildingId}`))}
      onClose={closeMicroclimatePopup}
      onShowAll={closeMicroclimatePopup}
    />
  ) : null;

  // 루트는 overflow: clip으로 자른다. hidden은 스크롤 컨테이너라서 Tab 포커스가 화면 밖 요소로 가면 대시보드가 밀려 남는다.
  return (
    <div className={`dashboard-root relative h-dvh w-screen overflow-clip bg-canvas text-ink ${presentation.cursorHidden ? "cursor-none" : ""}`}>
      <div className="absolute inset-0" style={{ background: sceneBackgroundFor(clock.sunState.visible) }} />

      {/* HUD는 Legacy와 같은 CampusHud 하나다(계약 C1). 검색은 렌더러가 지도 위 문구 층에 그린다. */}
      <CampusHud
        ref={hudRef}
        mode={viewportMode}
        insetRight={mapInsetRight}
        presenting={presentation.presenting}
        onTogglePresentation={presentation.toggle}
        tour={camera.touring ? tourPosition(CAMERA_PRESETS, camera.activePresetId) : null}
        moreMenu={moreMenu}
        feedIssueCount={feedIssueCount(feeds)}
        onOpenStatus={() => navigation.openTab("status")}
        camera={camera}
        clock={clock}
        playing={isTimePlaying}
        onPlayingChange={setIsTimePlaying}
        sceneWeather={sceneWeather}
      />
      <div ref={attachOverlayHost} data-label-chrome-layer="" className="pointer-events-none fixed inset-0 z-[6]" />

      <div className="absolute inset-0 z-0">
        <VWorldRenderer
          overlayHost={hudOverlayHost}
          d4Presets={viewportMode === "phone" ? CAMERA_PRESETS : null}
          onSelectPreset={camera.selectPreset}
          phone={viewportMode === "phone"}
          onLabelEntries={setVWorldLabelEntries}
          labelPresetFromGround={Boolean(CAMERA_PRESETS.find((preset) => preset.id === camera.activePresetId)?.fromGround)}
          onSelection={handleVWorldSelection}
          energyFeedDown={isFeedDown(feeds.energy)}
          onD4SectionChange={handleD4SectionChange}
          d4PaneHost={d4PaneHost}
          d4CloseKey={d4CloseKey}
          d4OpenKey={d4OpenKey}
          representativeOverlays={representativeOverlays}
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
          selectedId={selection.selectedId}
          onCampusCamera={setCampusCamera}
          onUserCameraStart={camera.handleUserCameraStart}
          onClearSelection={closeMicroclimatePopup}
          labelOccluderRef={panelRef}
          labelChromeRefs={labelChromeRefs}
          presentation={presentation.presenting}
          // 야간 음영은 지도 영상만 어둡게 해야 하므로 렌더러가 지도 바로 위·지도 위 문구와 버튼 아래에 그린다.
          // 해가 움직일 때마다 바뀌는 불투명도는 전환 없이 바로 쓴다(전체 화면 바탕색 전환 금지).
          mapBackdrop={(
            <>
              {/* 야간 음영은 지도 전체에 깐다. 지도 사용 영역(SDK availableArea)은 따로 두고, 패널 자리 변화는 전환 없이 바로 따른다. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[1]"
                // 밤 남색은 강조색과 같은 색상(약 234도): 선택 지붕의 강조색이 음영을 지나도 같은 색으로 읽힌다(V-F-12·V-Q-10).
                style={{ backgroundColor: `rgba(6, 8, 26, ${lighting.nightOpacity})` }}
              />
              <div
                id="vworld-available-area"
                className="pointer-events-none absolute bottom-0 left-0 top-0 z-[1]"
                style={{ right: mapInsetRight }}
              />
            </>
          )}
        />
      </div>

      <DashboardShell
        ref={panelRef}
        mode={viewportMode}
        open={panelState.open}
        onOpenChange={panelState.setUserOpen}
        detent={panelState.detent}
        onDetentChange={panelState.setDetent}
        hidden={presentation.presenting}
        hasSelection={Boolean(selection.selectedId) && !isD4SectionOpen}
        pane={isD4SectionOpen && <div ref={setD4PaneHost} className="h-full" />}
        onPaneExit={() => setD4CloseKey((value) => value + 1)}
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
          onOpenRecommendation={setEditorRequest}
          campusOverview={(
            <CampusEnergyOverview refreshKey={plans.overlayRefreshKey} onOverlayDataChange={setRepresentativeOverlays} />
          )}
        />
      </DashboardShell>
    </div>
  );
}

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
import { DashboardShell, SHELL_PEEK_HEIGHT, shellInsetRight } from "./panel/DashboardShell";
import { TimeSlider } from "./components/TimeSlider";
import { usePanelState } from "./panel/usePanelState.mjs";
import { usePanelViewMemory } from "./panel/usePanelViewMemory.mjs";
import { Wordmark } from "./panel/Wordmark";
import { HudTimeReadout, sceneTimeReadout } from "./components/HudTimeReadout";
import { HudToolbar } from "./components/HudToolbar";
import { CameraControls } from "./components/CameraControls";
import { TourPager } from "./components/CampusHud";
import { tourPosition } from "./panel/presentationLayout.mjs";
import { mapLighting } from "./vworld/mapLighting.mjs";
import { QUALITY_LABELS, QUALITY_TIERS, useQualityPreset } from "./settings/qualityPreset.mjs";
import { VWORLD_DEFAULT_QUALITY, applyVWorldQuality } from "./vworld/renderQuality.mjs";
import { CAMERA_PRESETS } from "./camera/cameraPresets.mjs";
import { useVWorldCampusCamera } from "./vworld/useVWorldCampusCamera.mjs";
import { SettingsSheet } from "./panel/SettingsSheet";
import { usePresentationMode } from "./panel/usePresentationMode.mjs";
import { PresentationToggle } from "./components/CampusHud";
import { DashboardTabContent } from "./panel/DashboardTabContent";
import { FeedStamps, sheetPlacement } from "./panel/FeedStatus";
import { useFeedStatus } from "./hooks/useFeedStatus.mjs";
import { isFeedDown } from "./hooks/feedStatusModel.mjs";
import { urlSelectionTarget, useDashboardUrlState } from "./hooks/useDashboardUrlState.mjs";
import { CompareButton, ComparisonPane } from "./panel/ComparisonPane";
import { useComparisonSet } from "./state/useComparisonSet.mjs";
import { summarizeWeather } from "./panel/weatherSummary.mjs";

export default function App() {
  useSimulationSocket();
  const panelRef = useRef(null);
  // 라벨이 피해 갈 HUD(시간 표시·발표 모드·시간 조작). 통과용 레이어라 안쪽 요소 사각형을 쓴다.
  const hudRef = useRef(null);
  const labelChromeRefs = useMemo(() => [hudRef], []);
  // Legacy와 같은 시점 버튼·투어(VWorld 카메라로 날아간다).
  const [campusCamera, setCampusCamera] = useState(null);
  const camera = useVWorldCampusCamera(campusCamera);
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
  const comparison = useComparisonSet();
  const plans = useInstallationPlans(selection.selectedBuildingId);
  const feeds = useFeedStatus({ weather: weatherFeed, traffic: trafficFeed, plans });
  const panelScrollRef = useRef(null);
  const popup = usePopupData();

  const summary = summarizeWeather({ feed: weatherFeed, mode: clock.mode, simTemp: clock.simTemp });
  const lighting = mapLighting(clock.sunAltitudeDegrees);

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
  // 렌더링 품질: Legacy와 같은 설정(같은 저장 값)을 Cesium의 해상도·보정·그림자로 옮긴다. 고른 값이 없으면 높음.
  const rendering = useQualityPreset();
  const qualityTier = rendering.qualitySource ? rendering.quality : VWORLD_DEFAULT_QUALITY;
  useEffect(() => {
    applyVWorldQuality(qualityTier);
  }, [qualityTier, campusCamera]);
  const qualitySetting = { tiers: QUALITY_TIERS, labels: QUALITY_LABELS, value: qualityTier, onChange: rendering.setQuality, source: rendering.qualitySource };
  // 공유 링크의 카메라: 캠퍼스 카메라가 준비되기 전에는 없음(주소의 시점은 준비될 때까지 다시 시도해 놓는다).
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

  // 지도 위 문구·버튼과 야간 음영은 패널(또는 레일)이 차지한 오른쪽 폭만큼 비켜 선다.
  const presentation = usePresentationMode({ panelState, activeTab, setActiveTab });
  const mapInsetRight = presentation.presenting ? "0px" : shellInsetRight(viewportMode, panelState.open, isD4SectionOpen, Boolean(selection.selectedId));
  // 폰에서는 바텀 시트의 peek 높이만큼 아래를 비운다.
  const mapInsetBottom = viewportMode === "phone" ? `${SHELL_PEEK_HEIGHT}px` : "0px";
  const [isTimePlaying, setIsTimePlaying] = useState(false);
  // HUD가 지도보다 먼저 그려지므로(탭 순서) 지도 위 문구·버튼은 HUD 안 자리로 옮겨 그린다.
  const [hudOverlayHost, setHudOverlayHost] = useState(null);
  // 지도 위 왼쪽 열(검색·카드)은 HUD 줄 바로 아래에서 시작한다(폰에서 HUD가 두 줄이 되어도 겹치지 않게).
  const hudRowRef = useRef(null);
  useEffect(() => {
    const row = hudRowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return undefined;
    const publish = () => document.documentElement.style.setProperty("--vworld-hud-bottom", `${Math.round(row.getBoundingClientRect().bottom)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // 루트는 overflow: clip으로 자른다. hidden은 스크롤 컨테이너라서 Tab 포커스가 화면 밖 요소로 가면 대시보드가 밀려 남는다.
  return (
    <div className={`dashboard-root relative h-dvh w-screen overflow-clip bg-canvas text-ink ${presentation.cursorHidden ? "cursor-none" : ""}`}>
      <div className="absolute inset-0" style={{ background: sceneBackgroundFor(clock.sunState.visible) }} />

      <div
        ref={hudRef}
        data-qa="campus-hud"
        data-label-chrome-layer=""
        data-presenting={presentation.presenting ? "true" : undefined}
        className="pointer-events-none absolute left-0 top-0 z-[6] transition-none"
        style={{ right: mapInsetRight, bottom: mapInsetBottom }}
      >
        {/* 지도 위 문구·버튼(검색·대표 설치 계획·태양광 상태·D4 상세 보기)의 자리: 화면 전체 기준이라 지도 쪽 여백을 그대로 쓴다. */}
        <div ref={setHudOverlayHost} data-label-chrome-layer="" className="pointer-events-none fixed inset-0" />
        {/* 시간 카드는 줄지 않는다(줄면 글자가 두 줄로 꺾여 아래 검색칸을 덮었다). 오른쪽 조작 묶음은 자리가 모자라면 자기
            칸 안에서 오른쪽으로 줄을 바꾼다(왼쪽 열의 검색칸·카드를 덮지 않는다). */}
        <div ref={hudRowRef} data-label-chrome-layer="" className="flex flex-wrap items-start gap-2 p-4">
        <div className="shrink-0">
          <HudTimeReadout
            minuteOfDay={clock.sceneMinuteOfDay}
            statusSlot={viewportMode !== "phone" && !presentation.presenting && (
              <FeedStamps feeds={feeds} retry={feeds.retry} placement={{ expanded: panelState.open, activeTab }} />
            )}
          />
        </div>
        {/* 폰에서는 조작 묶음이 시간 카드 아래 한 줄을 다 쓰고 왼쪽부터 놓인다. */}
        <div data-label-chrome-layer="" className="flex min-w-0 flex-1 flex-wrap items-start justify-start gap-2 max-sm:basis-full sm:justify-end">
          {!presentation.presenting && camera.ready && (
            <HudToolbar
              presets={CAMERA_PRESETS}
              activeId={camera.activePresetId}
              onSelect={camera.selectPreset}
              touring={camera.touring}
              onToggleTour={camera.toggleTour}
            />
          )}
          <PresentationToggle presenting={presentation.presenting} onToggle={presentation.toggle} className="mt-1 shrink-0" />
          {!presentation.presenting && <CompareButton comparison={comparison} className="mt-1 shrink-0" />}
          {viewportMode !== "phone" && !presentation.presenting && <Wordmark className="mt-1.5 shrink-0 rounded-control bg-[var(--colors-label-bg)] px-2 py-1 text-ink-muted" />}
        </div>
        </div>
        {/* 발표 모드에서 투어 중이면 아래 가운데에 지금 시점의 점 표시(Legacy와 같은 TourPager). */}
        {presentation.presenting && camera.touring && tourPosition(CAMERA_PRESETS, camera.activePresetId) && (
          <TourPager {...tourPosition(CAMERA_PRESETS, camera.activePresetId)} />
        )}
        {/* 카메라 단추(확대·축소·회전·처음 시점): Legacy와 같은 단추, VWorld 카메라를 움직인다. 시간 조작 위 오른쪽 가운데. */}
        {!presentation.presenting && camera.ready && (
          <CameraControls onZoom={camera.zoomBy} onRotate={camera.rotateBy} onHome={camera.goHome} className="absolute right-4 top-1/2 -translate-y-1/2" />
        )}
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

      <div className="absolute inset-0 z-0">
        <VWorldRenderer
          overlayHost={hudOverlayHost}
          d4Presets={viewportMode === "phone" ? CAMERA_PRESETS : null}
          onSelectPreset={camera.selectPreset}
          onSelection={handleVWorldSelection}
          energyFeedDown={isFeedDown(feeds.energy)}
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
          selectedId={selection.selectedId}
          onCampusCamera={setCampusCamera}
          onUserCameraStart={camera.handleUserCameraStart}
          onClearSelection={closeMicroclimatePopup}
          labelOccluderRef={panelRef}
          labelChromeRefs={labelChromeRefs}
          presentation={presentation.presenting}
          // 야간 음영은 지도 영상만 어둡게 해야 하므로 렌더러가 지도 바로 위·지도 위 문구와 버튼 아래에 그린다.
          // (해 쪽 햇빛 그라데이션은 화면 전체 장식 그라데이션이라 뺐다: V-F-44.)
          mapBackdrop={(
            <>
              {/* 야간 음영은 지도 전체에(떠 있는 인스펙터 카드 뒤까지) 깐다. 지도 사용 영역(SDK availableArea)은 따로 둔다. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[1] transition-[background-color] duration-300"
                // 밤 남색은 강조색과 같은 색상(약 234도): 선택 지붕의 강조색이 음영을 지나도 같은 색으로 읽힌다(V-F-12·V-Q-10).
                style={{ backgroundColor: `rgba(6, 8, 26, ${lighting.nightOpacity})` }}
              />
              <div
                id="vworld-available-area"
                className="pointer-events-none absolute bottom-0 left-0 top-0 z-[1] transition-[right] duration-300"
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
        pane={isD4SectionOpen && <div ref={setD4PaneHost} className="h-full" />}
        onPaneExit={() => setD4CloseKey((value) => value + 1)}
        timeReadout={sceneTimeReadout(clock.sceneMinuteOfDay)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        inspector={comparison.open ? (
          <ComparisonPane ids={comparison.ids} onRemove={comparison.remove} onClose={() => comparison.setOpen(false)} />
        ) : selection.selectedId && !isD4SectionOpen ? (
          <SelectionInspector
            title={selection.selectedTitle || popup.data?.name || selection.selectedId}
            popup={popup}
            onCompare={selection.selectedId.startsWith("BLD_") ? () => comparison.add(selection.selectedId) : null}
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
              quality={qualitySetting}
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

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useProgress } from "@react-three/drei";
import { FileLoader } from "three";
import {
  AlertTriangle,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  CloudSun,
  Gauge,
  RefreshCw,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  Thermometer,
  Wind,
  Moon,
  Monitor,
  X,
} from "lucide-react";
import { CityModel } from "./CityModel";
import { CAMPUS_CANVAS_GL, CampusLighting } from "./lighting/CampusLighting";
import { ShadowBaker } from "./lighting/ShadowBaker";
import { useDemandLoop } from "./render/useDemandLoop.mjs";
import { useInteractionDpr } from "./render/interactionDpr.mjs";
import { attachCanvasLifecycle } from "./render/canvasLifecycle.mjs";
import { QUALITY_LABELS, QUALITY_RENDERER, QUALITY_TIERS, capCanvasDpr, useQualityPreset } from "./settings/qualityPreset.mjs";
import { useLiveTraffic } from "./render/useLiveTraffic";
import { CAMERA_PRESETS, OVERVIEW_PRESET_ID } from "./camera/cameraPresets.mjs";
import { isFlyToEvent, useFlyTo } from "./camera/useFlyTo.mjs";
import { useCameraTour } from "./camera/useCameraTour.mjs";
import { useSceneWeather } from "./weather/useSceneWeather.mjs";
import { SceneWeatherBinding } from "./weather/SceneWeatherBinding";
import { kstMinuteOfDay, minuteOfDayFromParts, splitMinuteOfDay } from "./weather/sceneClock.mjs";
import { CAMPUS_MODEL_URL } from "./campusModelAsset.mjs";
import { AccessibleDialog } from "./components/AccessibleDialog";
import { CameraPresetBar } from "./components/CameraPresetBar";
import { TimeSlider } from "./components/TimeSlider";
import { MicroclimatePanel } from "./components/MicroclimatePanel";
import { PanelErrorBoundary } from "./components/PanelErrorBoundary";
import {
  CampusTrafficSimulation,
  TrafficSafetyPanel,
  useSimulationSocket,
} from "./simulation";
import { D4SectionExperience } from "./vworld/D4SectionExperience";
import { usePanelCoversViewport } from "./hooks/usePanelCoversViewport";
import { VWorldCampusStatus } from "./vworld/VWorldCampusStatus";
import { RepresentativePlanOverlayController } from "./vworld/RepresentativePlanOverlayController";
import { CAMPUS_REPRESENTATIVE_BUILDING_IDS } from "./vworld/representativePlanOverlay.mjs";
import { EnergyDashboard } from "./features/energy/dashboard/EnergyDashboard";
import { CampusComparison } from "./features/energy/campus/CampusComparisonPanel";
import { BuildingAnalysis } from "./features/energy/analysis";
import {
  createInstallationPlanClient,
  createPlanDraftFromExisting,
} from "./features/energy/installations/installationPlanApi.mjs";
import trafficData from "./utils/trafficData.json";
import { isD4ElementId } from "./utils/d4BuildingData.mjs";
import { useWeatherFeed } from "./hooks/useWeatherFeed";
import { useTrafficFeed } from "./simulation/hooks/useTrafficFeed";
import { FEED_TONE_COLORS, TRAFFIC_STATE_TONES, WEATHER_STATE_TONES, formatClockTime } from "./hooks/feedStatus.mjs";
import { WEATHER_API_URL } from "./simulation/utils/apiConfig";
import {
  CAMPUS_LOCATION,
  createSimulationDate,
  getSunState,
  getSunVector,
} from "./utils/sunPosition.mjs";

// CityModel의 선택 색 전환(감쇠율 8/s, 약 0.9초)과 포커스 카메라 비행(프레임당 4 % 보간)은 스스로 invalidate하지 않으므로
// 그동안 메인 루프를 always로 돌린다. 교통 시뮬레이션이 멈춘 뒤에는 에이전트 보간이 목표에 닿을 때까지,
// 패널을 여닫은 뒤에는 300ms 전환이 끝난 화면으로 라벨 가림 판정을 다시 할 때까지 돌린다.
const SELECTION_ANIMATION_MS = 3000;
// 보통/높음 품질의 후처리 청크. 낮음에서는 마운트하지 않으므로 내려받지도 않는다.
const HighTierEffects = lazy(() => import("./postfx/HighTierEffects"));
const TRAFFIC_SETTLE_MS = 1500;
const PANEL_TRANSITION_MS = 450;

const ALERT_RULES = [
  {
    id: "heat_island",
    label: "열섬 현상",
    check: (d) => (d?.heat_island_index ?? 0) >= 0.5,
  },
  {
    id: "high_temp",
    label: "고온 경보",
    check: (d) => (d?.temperature ?? 0) >= 35,
  },
  {
    id: "high_pm10",
    label: "PM10 초과",
    check: (d) => (d?.pm10 ?? 0) >= 80,
  },
  {
    id: "high_pm25",
    label: "PM2.5 초과",
    check: (d) => (d?.pm25 ?? 0) >= 50,
  },
  {
    id: "strong_wind",
    label: "강풍 경보",
    check: (d) => (d?.wind_speed ?? 0) >= 15,
  },
];

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

function formatShortTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getCompassDirection(degrees) {
  const directions = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  return directions[Math.round(degrees / 45) % directions.length];
}

// 탭 버튼 공통 스타일. 선택된 탭은 패널 표면 위에 띄워 보여 준다.
function tabButtonClassName(isActive) {
  return `flex-1 py-2 text-xs font-[600] rounded-md transition-colors ${
    isActive
      ? "bg-[var(--colors-surface-1)] shadow-sm text-[var(--colors-ink)] border border-[var(--colors-hairline)]"
      : "text-[var(--colors-ink-subtle)] hover:text-[var(--colors-ink)]"
  }`;
}

// 3D Canvas를 감싼 PanelErrorBoundary의 fallback(<div role="alert">)이 장면 배경 위에서도
// 읽히도록 패널 표면 위에 올린다. 평소에는 Canvas 컨테이너만 있으므로 아무 영향이 없다.
const CANVAS_FALLBACK_SURFACE_CLASS =
  "[&>[role=alert]]:rounded-[12px] [&>[role=alert]]:border [&>[role=alert]]:border-[var(--colors-hairline)] [&>[role=alert]]:bg-[var(--colors-surface-1)] [&>[role=alert]]:px-5 [&>[role=alert]]:py-4 [&>[role=alert]]:text-sm [&>[role=alert]]:font-medium [&>[role=alert]]:shadow-[0_20px_48px_rgba(0,0,0,0.28)] [&>[role=alert]>button]:mt-3 [&>[role=alert]>button]:font-[600] [&>[role=alert]>button]:underline";

// 3D 모델 로딩이 이 시간을 넘기면 지연 안내와 다시 시도 버튼을 보여 준다.
const SCENE_SLOW_AFTER_MS = 15000;

// Canvas 안쪽 Suspense의 fallback으로 마운트되어 있는 동안만 DOM 쪽 로딩 표시를 켠다.
// R3F 트리 안에서는 DOM 요소를 그릴 수 없으므로 상태만 바깥으로 올린다.
function SceneLoadingSignal({ onChange }) {
  useEffect(() => {
    onChange(true);
    return () => onChange(false);
  }, [onChange]);
  return null;
}

// 3D 모델의 바이트 진행률. drei의 useProgress는 항목 수만 세므로, 같은 URL을 FileLoader로 한 번 더 요청해 three가
// 진행 중인 요청에 콜백을 합치게 한다(중복 요청 없음). 항목이 하나라도 끝났거나(loaded > 0) 로딩 관리자가 쉬고 있으면
// 바이트 수신은 이미 끝난 뒤라 붙지 않는다.
function useCampusModelProgress(active) {
  const { active: managerActive, loaded: itemsLoaded } = useProgress();
  const [bytes, setBytes] = useState(null);
  const tappedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      tappedRef.current = false;
      setBytes(null);
      return undefined;
    }
    if (tappedRef.current || !managerActive || itemsLoaded > 0) return undefined;
    tappedRef.current = true;
    let disposed = false;
    const loader = new FileLoader();
    loader.setResponseType("arraybuffer");
    loader.load(
      CAMPUS_MODEL_URL,
      () => {
        if (!disposed) setBytes((previous) => ({ loaded: previous?.total ?? 0, total: previous?.total ?? 0, done: true }));
      },
      (event) => {
        if (!disposed && event.lengthComputable) setBytes({ loaded: event.loaded, total: event.total, done: false });
      },
      () => {},
    );
    return () => {
      disposed = true;
    };
  }, [active, itemsLoaded, managerActive]);

  return bytes;
}

const MEGABYTE = 1024 * 1024;
function formatModelProgress(bytes, fileName) {
  if (!bytes) return null;
  if (bytes.done) return `${fileName} 100% · 모델 처리 중`;
  if (!(bytes.total > 0)) return null;
  const percent = Math.min(99, Math.floor((bytes.loaded / bytes.total) * 100));
  return `${fileName} ${percent}% (${(bytes.loaded / MEGABYTE).toFixed(1)}/${(bytes.total / MEGABYTE).toFixed(1)} MB)`;
}

function FloatingPanel({ className = "", children }) {
  return (
    <section
      className={`rounded-[16px] border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl pointer-events-auto ${className}`}
    >
      {children}
    </section>
  );
}

function MetricCard({ label, value, hint, accent = false }) {
  return (
    <div className="rounded-[12px] border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] px-[24px] py-[24px]">
      <div className="text-[13px] font-[500] uppercase leading-[1.30] tracking-[0.4px] text-[var(--colors-ink-subtle)]">
        {label}
      </div>
      <div
        className={`mt-2 text-[28px] font-[600] leading-[1.20] tracking-[-0.6px] ${accent ? "text-[var(--colors-primary)]" : "text-[var(--colors-ink)]"}`}
      >
        {value}
      </div>
      <div className="mt-2 text-[14px] font-[400] leading-[1.50] tracking-[0px] text-[var(--colors-ink-muted)]">{hint}</div>
    </div>
  );
}

function SliderRow({ label, valueLabel, min, max, step = 1, value, onValueChange }) {
  const stopInputHandling = (event) => event.stopPropagation();
  const updateFromPointer = (event) => {
    event.stopPropagation();
    const { left, width } = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - left) / width));
    const steppedValue = min + Math.round(((max - min) * ratio) / step) * step;
    onValueChange(Math.min(max, Math.max(min, steppedValue)));
  };
  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateFromPointer(event);
  };
  const handlePointerMove = (event) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      updateFromPointer(event);
    }
  };
  const handleKeyDown = (event) => {
    const keyDeltas = {
      ArrowDown: -step,
      ArrowLeft: -step,
      ArrowRight: step,
      ArrowUp: step,
      PageDown: -step * 10,
      PageUp: step * 10,
    };

    let nextValue = value;
    if (event.key === "Home") nextValue = min;
    else if (event.key === "End") nextValue = max;
    else if (event.key in keyDeltas) nextValue = value + keyDeltas[event.key];
    else {
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onValueChange(Math.min(max, Math.max(min, nextValue)));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[14px] font-[400] leading-[1.50]">
        <span className="text-[var(--colors-ink-subtle)]">{label}</span>
        <span className="font-[500] text-[var(--colors-ink)]">{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onValueChange(Number(event.target.value))}
        onClick={stopInputHandling}
        onKeyDown={handleKeyDown}
        onMouseDown={stopInputHandling}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onTouchStart={stopInputHandling}
        className="w-full accent-[var(--colors-primary)] pointer-events-auto"
      />
    </div>
  );
}

export default function App() {
  useSimulationSocket();
  const orbitControlsRef = useRef(null);
  const panelRef = useRef(null);
  const mapLayerRef = useRef(null);
  const sceneStatusRef = useRef(null);
  const hudRef = useRef(null);
  const canvasStateRef = useRef(null);
  const activePresetRef = useRef(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedBuildingId, setSelectedBuildingId] = useState("D4");
  const [editorRequest, setEditorRequest] = useState(null);
  const [installationPlans, setInstallationPlans] = useState([]);
  const [representativePlanId, setRepresentativePlanId] = useState(null);
  const [overlayRefreshKey, setOverlayRefreshKey] = useState(0);
  const installationLoadGenerationRef = useRef(0);
  const installationPlanClient = useMemo(() => createInstallationPlanClient(), []);
  const [mode, setMode] = useState("simulation");
  const weatherFeed = useWeatherFeed();
  const trafficFeed = useTrafficFeed();
  const { data: weatherData, state: weatherState, message: weatherMessage, lastUpdatedAt, isRefreshing: isWeatherRefreshing, refresh: refreshWeather } = weatherFeed;
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [sunMonth, setSunMonth] = useState(() => new Date().getMonth() + 1);
  const [sunDay, setSunDay] = useState(() => new Date().getDate());
  const [sunHour, setSunHour] = useState(() => new Date().getHours());
  const [sunMinute, setSunMinute] = useState(() => new Date().getMinutes());
  const [isTimePlaying, setIsTimePlaying] = useState(false);
  const [activePresetId, setActivePresetId] = useState(OVERVIEW_PRESET_ID);
  const [simTemp, setSimTemp] = useState(20);
  const [activeTab, setActiveTab] = useState("dashboard"); // dashboard, parking_safety, energy, environment, microclimate
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(true);
  const [themeMode, setThemeMode] = useState("system");
  const [popupData, setPopupData] = useState(null);
  const [popupLoading, setPopupLoading] = useState(false);
  const [popupError, setPopupError] = useState(null);
  const [buildingViewMode, setBuildingViewMode] = useState("campus");
  const [installationRefreshKey, setInstallationRefreshKey] = useState(0);
  const [installationPlansStatus, setInstallationPlansStatus] = useState("loading");
  const [isSceneLoading, setIsSceneLoading] = useState(false);
  const [isSceneSlow, setIsSceneSlow] = useState(false);

  // 모델 로딩이 SCENE_SLOW_AFTER_MS를 넘기면 지연 안내를 켠다. 로딩이 끝나면 타이머와 지연 상태를 함께 되돌린다.
  useEffect(() => {
    if (!isSceneLoading) {
      setIsSceneSlow(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setIsSceneSlow(true), SCENE_SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [isSceneLoading]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let activeTheme = themeMode;
    if (themeMode === "system") {
      activeTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = activeTheme;
    document.documentElement.style.colorScheme = activeTheme;
  }, [themeMode]);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const isPanelVisible = buildingViewMode === "campus" && isPanelOpen;

  // 닫힌 패널은 화면 밖으로 밀려날 뿐 DOM에 남아 있으므로 포커스·접근성 트리에서 제외한다.
  // React 18은 `inert` 불리언 속성을 지원하지 않아 ref로 직접 토글한다.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (isPanelVisible) panel.removeAttribute("inert");
    else panel.setAttribute("inert", "");
  }, [isPanelVisible]);

  const panelCoversViewport = usePanelCoversViewport();
  const isMapCoveredByPanel = isPanelVisible && panelCoversViewport;
  // 3D 지도 위 안내는 열린 패널을 뺀 지도 영역 가운데에 둔다. 좌우 여백(px-10)은 지도 영역 오른쪽 끝의 패널 토글을 비켜 간다.
  const mapInsetRight = isPanelVisible && !panelCoversViewport ? "var(--dashboard-panel-width)" : "0px";

  // 좁은 화면에서 열린 패널은 지도 전체를 덮는다. 그 밑의 3D 지도(캠퍼스 라벨 포함)와 3D 로딩 안내는
  // 보이지 않으므로 포커스·클릭·보조 기술 대상에서 뺀다. 패널이 지도를 다 덮지 않는 넓은 화면은 그대로 둔다.
  useEffect(() => {
    for (const element of [mapLayerRef.current, sceneStatusRef.current, hudRef.current]) {
      if (!element) continue;
      if (isMapCoveredByPanel) element.setAttribute("inert", "");
      else element.removeAttribute("inert");
    }
  }, [isMapCoveredByPanel, isSceneLoading, buildingViewMode]);

  const activeWeather = useMemo(() => {
    if (!weatherData?.base_weather) return null;
    if (mode !== "simulation") return weatherData.base_weather;

    return {
      ...weatherData.base_weather,
      temperature: simTemp,
    };
  }, [mode, simTemp, weatherData]);

  const activeAlerts = useMemo(() => {
    if (!activeWeather) return [];
    return ALERT_RULES.filter((rule) => rule.check(activeWeather));
  }, [activeWeather]);

  const riskReports = useMemo(() => trafficData.slice(0, 3), []);

  const weatherTimeline = useMemo(() => {
    if (!Array.isArray(weatherData?.weather_timeline)) return [];
    return weatherData.weather_timeline.slice(0, 3);
  }, [weatherData]);

  const sunSimulationDate = useMemo(
    () =>
      mode === "live"
        ? currentTime
        : createSimulationDate(
            {
              month: sunMonth,
              day: sunDay,
              hour: sunHour,
              minute: sunMinute,
            },
            currentTime.getFullYear(),
          ),
    [currentTime, mode, sunDay, sunHour, sunMinute, sunMonth],
  );

  const sunState = useMemo(
    () =>
      getSunState({
        date: sunSimulationDate,
        latitude: CAMPUS_LOCATION.latitude,
        longitude: CAMPUS_LOCATION.longitude,
      }),
    [sunSimulationDate],
  );

  const sunVector = useMemo(
    () => getSunVector({ altitude: sunState.altitude, azimuth: sunState.azimuth }),
    [sunState.altitude, sunState.azimuth],
  );

  // 시간 슬라이더는 하루 0..1439분(KST) 하나로 sunHour/sunMinute를 움직인다. Live 모드에서는 현재 KST 시각을 보여 주고,
  // 슬라이더를 움직이면 그 시각부터 시뮬레이션 모드로 바뀐다(환경 시뮬 탭의 시/분 슬라이더와 같은 상태).
  const isLiveMode = mode === "live";
  const sceneMinuteOfDay = isLiveMode
    ? kstMinuteOfDay(currentTime)
    : minuteOfDayFromParts({ hour: sunHour, minute: sunMinute });
  const setSceneMinuteOfDay = useCallback((minute) => {
    const parts = splitMinuteOfDay(minute);
    setSunHour(parts.hour);
    setSunMinute(parts.minute);
    setMode("simulation");
  }, []);

  const sceneWeather = useSceneWeather({ weatherData, weatherState });
  const sceneWeatherScene = sceneWeather.scene;

  const sceneBackground = sunState.visible ? "#d6e0e6" : "#09111d";
  const sunAltitudeDegrees = (sunState.altitude * 180) / Math.PI;
  const sunBearingDegrees = ((sunState.azimuth * 180) / Math.PI + 540) % 360;
  const isSimulationMode = mode === "simulation";
  const weatherFreshness = weatherData?.freshness?.weather;
  const observedClock = formatClockTime(weatherFreshness?.observed_at)
    ?? formatClockTime(weatherFreshness?.fetched_at)
    ?? formatClockTime(lastUpdatedAt);
  const lastGoodClock = formatClockTime(weatherFreshness?.fetched_at) ?? formatClockTime(lastUpdatedAt);
  const systemStatus = isSimulationMode
    ? "시뮬레이션 모드"
    : weatherState === "live"
      ? `실시간 연동 정상${observedClock ? ` · 관측 ${observedClock}` : ""}`
      : weatherState === "stale"
        ? "저장된 기상 데이터 표시 중"
        : weatherState === "error"
          ? weatherMessage
          : "기상 데이터 갱신 중";
  const systemStatusTone = isSimulationMode ? "neutral" : (WEATHER_STATE_TONES[weatherState] ?? "neutral");
  const isWeatherBusy = weatherState === "loading" || isWeatherRefreshing;
  const weatherLastGoodLabel = weatherState !== "live" && weatherData && lastGoodClock
    ? `마지막 정상 수신 ${lastGoodClock}`
    : null;
  const lastGoodCaption = weatherLastGoodLabel ? (
    <div className="mt-1 text-xs font-medium text-[var(--colors-ink-muted)]">{weatherLastGoodLabel}</div>
  ) : null;
  const trafficStats = trafficFeed.stats;
  const isTrafficLive = trafficFeed.state === "live";
  const trafficTone = TRAFFIC_STATE_TONES[trafficFeed.state] ?? "neutral";

  // const period = currentTime.getHours() < 12 ? "오전" : "오후";

  const formattedTime = currentTime.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const formattedDate = currentTime.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  const handleSelect = useCallback((name) => {
    setSelectedId(name);
    setPopupData(null);
    setPopupError(null);
  }, []);

  const createInstallationPlanDraft = useCallback(
    (context) => createPlanDraftFromExisting(context),
    [],
  );

  const openD4Section = useCallback((request = null) => {
    setEditorRequest(request);
    setSelectedId("");
    setPopupData(null);
    setPopupError(null);
    setBuildingViewMode("section");
    setIsPanelOpen(false);
  }, []);

  // 건물을 클릭하거나 카메라가 D4에 충분히 가까이(줌인) 다가갔을 때 쓰는 진입 경로.
  // 확대된 캠퍼스 화면은 그대로 배경으로 유지한 채, 그 위에 공간 탐색/태양광 설치
  // 패널을 투명 오버레이로 띄운다(D4SectionExperience가 자체 페이드인 처리).
  const enterD4Section = useCallback((request = null) => {
    openD4Section(request);
  }, [openD4Section]);

  const handleExitD4Section = useCallback(() => {
    setBuildingViewMode("campus");
    setIsPanelOpen(true);
    setEditorRequest(null);
    setInstallationRefreshKey((value) => value + 1);
    setOverlayRefreshKey((value) => value + 1);
  }, []);

  const selectBuilding = useCallback(({
    elementId,
    buildingId,
    displayName,
  }) => {
    if (buildingId !== selectedBuildingId) {
      installationLoadGenerationRef.current += 1;
      setInstallationPlans([]);
      setRepresentativePlanId(null);
      setInstallationPlansStatus("loading");
    }
    setSelectedId(displayName);
    setSelectedBuildingId(buildingId);
    setActiveTab("energy");
    setPopupData(null);
    setPopupError(null);
    return elementId;
  }, [selectedBuildingId]);

  useEffect(() => {
    const controller = new AbortController();
    const requestGeneration = installationLoadGenerationRef.current + 1;
    installationLoadGenerationRef.current = requestGeneration;
    let active = true;
    setInstallationPlans([]);
    setRepresentativePlanId(null);
    setInstallationPlansStatus("loading");
    Promise.all([
      installationPlanClient.listDetails(selectedBuildingId, { signal: controller.signal }),
      installationPlanClient.getRepresentative(selectedBuildingId, { signal: controller.signal }),
    ]).then(([plans, representative]) => {
      if (!active || installationLoadGenerationRef.current !== requestGeneration) return;
      setInstallationPlans(plans);
      setRepresentativePlanId(representative?.installationPlanId ?? null);
      setInstallationPlansStatus("ready");
    }).catch((loadError) => {
      if (!active || installationLoadGenerationRef.current !== requestGeneration || loadError?.name === "AbortError") return;
      setInstallationPlans([]);
      setRepresentativePlanId(null);
      setInstallationPlansStatus("error");
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [installationPlanClient, installationRefreshKey, selectedBuildingId]);

  const handleInstallationPlansChange = useCallback((plans) => {
    installationLoadGenerationRef.current += 1;
    setInstallationPlans(plans);
    setInstallationPlansStatus("ready");
  }, []);

  const handleRepresentativeInstallationPlanChange = useCallback((representative) => {
    installationLoadGenerationRef.current += 1;
    setInstallationPlansStatus("ready");
    setRepresentativePlanId(representative?.installationPlanId ?? null);
    setOverlayRefreshKey((value) => value + 1);
  }, []);

  const retryInstallationPlans = useCallback(() => {
    setInstallationRefreshKey((value) => value + 1);
  }, []);

  const fetchMicroclimate = useCallback(async (elementId) => {
    setActiveTab("microclimate");
    setIsPanelOpen(true);

    const apiUrl = WEATHER_API_URL;
    setPopupLoading(true);
    setPopupError(null);
    setPopupData(null);

    try {
      const res = await fetch(`${apiUrl}/microclimate/elements/${elementId}/popup`);
      if (res.status === 404) {
        setPopupError("이 건물의 미기후 데이터가 없습니다.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPopupData(await res.json());
    } catch (err) {
      console.error("팝업 API 호출 실패:", err);
      setPopupError("데이터를 불러오지 못했습니다.");
    } finally {
      setPopupLoading(false);
    }
  }, []);

  const handleBuildingClick = useCallback(async (obj) => {
    const elementId =
      obj?.parent?.name && obj.parent.name !== "Scene"
        ? obj.parent.name
        : obj?.name;

    if (!elementId || !elementId.startsWith("BLD_")) {
      setPopupData(null);
      return;
    }

    const buildingId = elementId.slice("BLD_".length);
    selectBuilding({
      elementId,
      buildingId,
      displayName: obj?.userData?.buildingName ?? obj?.name ?? buildingId,
      area: obj?.userData?.area ?? 0,
    });

    if (isD4ElementId(elementId)) {
      enterD4Section();
      return;
    }

    await fetchMicroclimate(elementId);
  }, [enterD4Section, selectBuilding, fetchMicroclimate]);

  // 클릭 없이 카메라가 D4를 일정 크기 이상 확대(줌인)했을 때도 같은 진입 전환을 탄다.
  const handleD4Enter = useCallback(() => {
    if (buildingViewMode !== "campus") return;
    enterD4Section();
  }, [buildingViewMode, enterD4Section]);

  // 클릭 없이 카메라가 건물 가까이 다가가기만 해도(자유 줌/궤도 회전) 그 건물의
  // 미기후를 보여준다. 다만 사용자가 주차·안전/에너지/환경 시뮬처럼 다른 목적으로
  // 명시적으로 골라둔 탭은 방해하지 않고, 기본 현황이거나 이미 미기후를 보는 중일
  // 때만 자동으로 갱신한다. 반대로 모든 건물에서 일정 범위 밖으로 줌아웃하면
  // (anchor === null) 미기후 보기를 접고 기본 현황 패널로 되돌아간다.
  const handleBuildingProximity = useCallback((anchor) => {
    // 카메라가 시점 버튼으로 간 자리에 있는 동안(사용자가 직접 조작하기 전)에는 근처 건물의 미기후를 자동으로 열지 않는다.
    // D4 시점은 정해진 오프셋 때문에 이웃 건물이 더 가까워진다. 멀어져서 닫는 것은 그대로 둔다.
    if (anchor && activePresetRef.current) return;
    if (!anchor) {
      if (activeTab === "microclimate") {
        setActiveTab("dashboard");
        setSelectedId("");
        setPopupData(null);
        setPopupError(null);
      }
      return;
    }

    const elementId = anchor.elementId;
    if (!elementId || !elementId.startsWith("BLD_")) return;
    if (isD4ElementId(elementId)) return;
    if (buildingViewMode !== "campus") return;
    if (activeTab !== "dashboard" && activeTab !== "microclimate") return;

    const buildingId = elementId.slice("BLD_".length);
    if (activeTab === "microclimate" && selectedBuildingId === buildingId) return;

    selectBuilding({
      elementId,
      buildingId,
      displayName: anchor.displayName ?? anchor.name ?? buildingId,
    });
    fetchMicroclimate(elementId);
  }, [activeTab, buildingViewMode, selectedBuildingId, selectBuilding, fetchMicroclimate]);

  const closeMicroclimatePanel = useCallback(() => {
    setActiveTab("dashboard");
    setSelectedId("");
    setPopupData(null);
    setPopupError(null);
  }, []);

  // 다른 탭으로 옮겨 갔다가도 선택한 건물의 미기후 패널을 다시 열 수 있게 한다. 아직 받아 둔
  // 데이터가 없으면(에너지 탭의 건물 목록에서 고른 경우 등) 지금 선택된 건물 기준으로 조회한다.
  const openMicroclimateTab = useCallback(() => {
    if (!popupData && !popupLoading && !popupError && selectedBuildingId) {
      fetchMicroclimate(`BLD_${selectedBuildingId}`);
      return;
    }
    setActiveTab("microclimate");
  }, [fetchMicroclimate, popupData, popupError, popupLoading, selectedBuildingId]);
  const showMicroclimateTab = Boolean(selectedId) || activeTab === "microclimate";

  const liveTraffic = useLiveTraffic();
  const { frameloop, animateFor } = useDemandLoop({ modalOpen: buildingViewMode === "section", liveTraffic });
  const interactionDpr = useInteractionDpr();
  const { quality, qualitySource, setQuality, applyDetectedDefault } = useQualityPreset();
  const qualityRenderer = QUALITY_RENDERER[quality];
  const canvasDpr = useMemo(
    () => capCanvasDpr(interactionDpr.dpr, qualityRenderer.maxDpr),
    [interactionDpr.dpr, qualityRenderer.maxDpr],
  );
  useEffect(() => {
    animateFor(SELECTION_ANIMATION_MS);
  }, [animateFor, selectedId, sunState.visible, isSceneLoading]);
  useEffect(() => {
    if (!liveTraffic) animateFor(TRAFFIC_SETTLE_MS);
  }, [animateFor, liveTraffic]);
  useEffect(() => {
    animateFor(PANEL_TRANSITION_MS);
  }, [animateFor, isPanelOpen, activeTab, buildingViewMode]);
  const handleCanvasCreated = useCallback((state) => {
    canvasStateRef.current = state;
    attachCanvasLifecycle(state);
    applyDetectedDefault(state.gl);
  }, [applyDetectedDefault]);
  const getCanvasScene = useCallback(() => canvasStateRef.current?.scene ?? null, []);
  const { flyTo } = useFlyTo({ controlsRef: orbitControlsRef, getScene: getCanvasScene });
  useEffect(() => {
    activePresetRef.current = activePresetId;
  }, [activePresetId]);
  const goToPreset = useCallback((preset) => {
    if (!flyTo(preset)) return;
    setActivePresetId(preset.id);
  }, [flyTo]);
  const { touring, toggleTour, stopTour } = useCameraTour({
    presets: CAMERA_PRESETS,
    activeId: activePresetId,
    goToPreset,
  });
  const selectPreset = useCallback((preset) => {
    stopTour();
    goToPreset(preset);
  }, [goToPreset, stopTour]);
  // D4 상세가 열리면 캠퍼스 카메라와 시간 재생을 멈춘다. 뒤에 가려진 장면을 계속 움직일 이유가 없다.
  useEffect(() => {
    if (buildingViewMode === "campus") return;
    stopTour();
    setIsTimePlaying(false);
  }, [buildingViewMode, stopTour]);
  const modelProgress = useCampusModelProgress(isSceneLoading);
  const modelProgressLabel = formatModelProgress(modelProgress, CAMPUS_MODEL_URL.split("/").pop());

  // 대시보드는 1초 시계로 매초 다시 렌더된다. 씬 트리까지 다시 렌더되면 인라인 이벤트 핸들러가 바뀐 것으로
  // 보고 R3F가 invalidate해서 demand 루프가 매초 그리므로, 씬에 실제로 들어가는 값이 바뀔 때만 다시 만든다.
  const sunVisible = sunState.visible;
  const sunAltitude = sunState.altitude;
  const labelsHidden = buildingViewMode !== "campus";
  const { onStart: lowerDprOnOrbitStart, onEnd: handleOrbitEnd } = interactionDpr;
  // 사용자가 직접 궤도 조작을 시작하면(시점 비행이 보낸 start는 제외) 투어를 멈추고 눌린 시점 표시를 지운다.
  const handleOrbitStart = useCallback((event) => {
    lowerDprOnOrbitStart();
    if (isFlyToEvent(event)) return;
    stopTour();
    setActivePresetId(null);
  }, [lowerDprOnOrbitStart, stopTour]);
  const campusScene = useMemo(() => (
    <>
      <color attach="background" args={[sceneBackground]} />
      <CampusLighting
        sunVector={sunVector}
        sunVisible={sunVisible}
        sunAltitude={sunAltitude}
        shadowMapSize={qualityRenderer.shadowMapSize}
      />
      <SceneWeatherBinding
        sunIntensityScale={sceneWeatherScene.sunIntensityScale}
        fogDensityScale={sceneWeatherScene.fogDensityScale}
        turbidityDelta={sceneWeatherScene.turbidityDelta}
        ambientScale={sceneWeatherScene.ambientScale}
      />
      {sunVisible && (
        <mesh position={sunVector.map(v => v * 100)}>
          <sphereGeometry args={[10, 32, 32]} />
          <meshBasicMaterial color="#ffe87c" />
        </mesh>
      )}
      <Suspense fallback={<SceneLoadingSignal onChange={setIsSceneLoading} />}>
        <CityModel
          position={[0, 0, 0]}
          controlsRef={orbitControlsRef}
          isNight={!sunVisible}
          selectedId={selectedId}
          onSelect={handleSelect}
          onBuildingClick={handleBuildingClick}
          onBuildingProximity={handleBuildingProximity}
          onD4Enter={handleD4Enter}
          labelsHidden={labelsHidden}
          occluderRef={panelRef}
        />
        <CampusTrafficSimulation />
        <ShadowBaker sunKey={sunVector.join(",")} />
      </Suspense>
      <OrbitControls
        ref={orbitControlsRef}
        onStart={handleOrbitStart}
        onEnd={handleOrbitEnd}
        enableDamping
        dampingFactor={0.05}
        enableZoom
        zoomSpeed={1}
        minDistance={30}
        maxDistance={520}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.2}
        target={[0, 0, 0]}
      />
      {quality !== "low" && (
        <Suspense fallback={null}>
          <HighTierEffects tier={quality} sunAltitude={sunAltitude} />
        </Suspense>
      )}
    </>
  ), [
    sceneBackground, sunVector, sunVisible, sunAltitude, selectedId, labelsHidden, sceneWeatherScene, quality, qualityRenderer,
    handleSelect, handleBuildingClick, handleBuildingProximity, handleD4Enter, handleOrbitStart, handleOrbitEnd,
  ]);

  // 루트는 overflow: clip으로 자른다. hidden은 스크롤 컨테이너라서, 닫힌 패널이 화면 밖에 만드는 공간 때문에
  // Tab 포커스가 화면 밖 요소로 가면 브라우저가 대시보드 전체를 옆으로 밀어 둔 채 남긴다.
  return (
    <div className="dashboard-root relative h-dvh w-screen overflow-clip bg-[var(--colors-canvas)] text-[var(--colors-ink)]">
      <div className="absolute inset-0" style={{ background: sceneBackground }} />

      {/* 지도 위 조작: 카메라 시점(왼쪽 위)과 시간 슬라이더(왼쪽 아래). 지도보다 앞에 두어 Tab이 라벨보다 먼저 닿는다. 오른쪽 끝은 패널 토글(w-7)과 그 여백만큼 비운다.
          좁은 화면에서 열린 패널이 지도를 다 덮으면 보이지 않게 하고 inert로 뺀다. */}
      {buildingViewMode === "campus" && (
        <div
          ref={hudRef}
          data-qa="campus-hud"
          className={`pointer-events-none absolute inset-y-0 left-0 z-[6] transition-[right] duration-300 ${isMapCoveredByPanel ? "invisible" : ""}`}
          style={{ right: `calc(${mapInsetRight} + 2.75rem)` }}
        >
          <CameraPresetBar
            presets={CAMERA_PRESETS}
            activeId={activePresetId}
            onSelect={selectPreset}
            touring={touring}
            onToggleTour={toggleTour}
            className="absolute left-4 top-4 max-w-[calc(100%-2rem)]"
          />
          <TimeSlider
            minuteOfDay={sceneMinuteOfDay}
            onMinuteChange={setSceneMinuteOfDay}
            playing={isTimePlaying}
            onPlayingChange={setIsTimePlaying}
            live={isLiveMode}
            className="absolute bottom-4 left-4 w-[min(24rem,calc(100%-2rem))]"
            caption={(
              <p
                data-qa="scene-weather"
                data-estimated={sceneWeather.label.estimated ? "true" : "false"}
                className="flex items-start gap-1.5 text-[11px] font-[500] leading-[1.4] text-[var(--colors-ink-subtle)]"
              >
                <CloudSun size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-keep">{sceneWeather.label.text}</span>
              </p>
            )}
          />
        </div>
      )}

      <div ref={mapLayerRef} data-qa="campus-map-layer" className={`absolute inset-0 z-0 flex items-center justify-center ${CANVAS_FALLBACK_SURFACE_CLASS}`}>
        <PanelErrorBoundary
          label="3D 캠퍼스"
          message="3D 캠퍼스 모델을 불러오지 못했습니다"
          fallbackClassName="absolute inset-y-0 left-0 flex items-center justify-center px-10 transition-[right] duration-300"
          fallbackStyle={{ right: mapInsetRight }}
        >
          {/* R3F 래퍼의 기본 overflow: hidden은 스크롤 컨테이너라서, Tab으로 캔버스 밖 라벨에 포커스가 가면
              브라우저가 래퍼를 스크롤해 3D 화면이 밀린 채 남는다. clip은 똑같이 잘라 내되 스크롤되지 않는다. */}
          <Canvas
            camera={{ position: [0, 260, 260], fov: 50 }}
            shadows="percentage"
            gl={CAMPUS_CANVAS_GL}
            frameloop={frameloop}
            dpr={canvasDpr}
            onCreated={handleCanvasCreated}
            style={{ overflow: "clip" }}
          >
            {campusScene}
          </Canvas>
        </PanelErrorBoundary>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(1,1,2,0.02)_0%,rgba(1,1,2,0.08)_50%,rgba(1,1,2,0.16)_100%)]" />

      {isSceneLoading && (
        <div
          ref={sceneStatusRef}
          role="status"
          className="pointer-events-none absolute inset-y-0 left-0 z-[5] flex items-center justify-center px-10 transition-[right] duration-300"
          style={{ right: mapInsetRight }}
        >
          <div className="flex items-center gap-3 rounded-[12px] border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] px-4 py-3 text-sm font-medium text-[var(--colors-ink-muted)] shadow-[0_20px_48px_rgba(0,0,0,0.28)]">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--colors-hairline)] border-t-[var(--colors-primary)]" />
            {isSceneSlow ? (
              <>
                <span className="min-w-0 break-keep">3D 캠퍼스 모델 응답이 지연되고 있습니다. 네트워크를 확인하세요.</span>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="pointer-events-auto shrink-0 rounded-md border border-[var(--colors-hairline-strong)] bg-[var(--colors-surface-1)] px-3 py-1.5 text-sm font-[600] text-[var(--colors-ink)] transition hover:bg-[var(--colors-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--colors-primary)]"
                >
                  다시 시도
                </button>
              </>
            ) : (
              <span className="min-w-0 break-keep">
                3D 캠퍼스 모델을 불러오는 중입니다
                {modelProgressLabel && (
                  <span data-qa="scene-loading-progress" className="ml-2 tabular-nums text-[var(--colors-ink-subtle)]">
                    {modelProgressLabel}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {buildingViewMode === "section" && (
        <D4SectionExperience
          buildingId={editorRequest?.buildingId ?? selectedBuildingId}
          scenarioId={editorRequest?.scenarioId}
          installationPlanId={editorRequest?.installationPlanId}
          startInstallation={Boolean(editorRequest?.scenarioId || editorRequest?.installationPlanId)}
          onClose={handleExitD4Section}
          onPlanSaved={() => {
            setInstallationRefreshKey((value) => value + 1);
            setOverlayRefreshKey((value) => value + 1);
          }}
          createInstallationPlanDraft={createInstallationPlanDraft}
          onPlansChange={handleInstallationPlansChange}
          onRepresentativeChange={handleRepresentativeInstallationPlanChange}
          planRefreshKey={installationRefreshKey}
        />
      )}

      {/* 패널 토글 버튼 */}
      {buildingViewMode === "campus" && (
      <button
        onClick={() => setIsPanelOpen(v => !v)}
        aria-label={isPanelOpen ? "패널 닫기" : "패널 열기"}
        title={isPanelOpen ? "패널 닫기" : "패널 열기"}
        className="pointer-events-auto absolute z-20 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-14 rounded-l-xl border border-r-0 border-[var(--colors-hairline)] shadow-lg transition-right duration-300"
        style={{
          right: isPanelOpen
            ? 'min(var(--dashboard-panel-width), calc(100vw - 1.75rem))'
            : '0px',
          backgroundColor: 'var(--colors-surface-1)',
          transition: 'right 0.3s ease',
        }}
      >
        {isPanelOpen ? <ChevronRight size={16} className="text-[var(--colors-ink-subtle)]" /> : <ChevronLeft size={16} className="text-[var(--colors-ink-subtle)]" />}
      </button>
      )}

      <div
        ref={panelRef}
        data-qa="dashboard-panel"
        aria-hidden={isPanelVisible ? undefined : "true"}
        className="pointer-events-none absolute top-0 bottom-0 z-10 w-[var(--dashboard-panel-width)]"
        style={{
          right: isPanelVisible ? '0' : 'calc(-1 * min(var(--dashboard-panel-width), 100vw))',
          width: 'min(var(--dashboard-panel-width), 100vw)',
          transition: 'right 0.3s ease',
        }}
      >
        <div
          className="pointer-events-auto h-full w-full border-l border-[var(--colors-hairline)] shadow-2xl flex flex-col"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--colors-surface-1) 30%, transparent)',
            backdropFilter: 'blur(16px)'
          }}
        >
          {/* Header & Tabs */}
          <div className="px-6 pt-8 pb-4">
            <h2 className="text-xl font-[800] tracking-tight mb-5">스마트 시티 대시보드</h2>
            <div className="flex rounded-lg p-1 border border-[var(--colors-hairline)] gap-0.5" style={{ backgroundColor: 'color-mix(in srgb, var(--colors-surface-2) 50%, transparent)' }}>
              {[
                { id: "dashboard", label: "기본 현황" },
                { id: "parking_safety", label: "주차·안전" },
                { id: "energy", label: "에너지" },
                { id: "environment", label: "환경 시뮬" },
              ].map(tab => (
                <button
                  key={tab.id}
                  data-qa={`dashboard-tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={tabButtonClassName(activeTab === tab.id)}
                >
                  {tab.label}
                </button>
              ))}
              {showMicroclimateTab && (
                <button
                  type="button"
                  data-qa="dashboard-tab-microclimate"
                  onClick={openMicroclimateTab}
                  className={tabButtonClassName(activeTab === "microclimate")}
                >
                  미기후
                </button>
              )}
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto px-6 pb-8 space-y-6">
            {activeTab === "dashboard" && (
              <PanelErrorBoundary label="기본 현황">
                <>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-[600] text-3xl leading-[1.2] tracking-[-0.8px] font-['Linear_Display']">{formattedTime}</div>
                      <div className="mt-1 flex items-center gap-1 text-sm font-medium text-[var(--colors-ink-muted)]">
                        <CalendarDays size={14} />
                        {formattedDate}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        aria-label="설정"
                        title="설정"
                        onClick={() => setIsSettingsOpen(true)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] text-[var(--colors-ink-muted)] transition hover:text-[var(--colors-ink)] hover:bg-[var(--colors-surface-2)]"
                      >
                        <Settings size={18} />
                      </button>
                      <button
                        type="button"
                        aria-label="기상 데이터 새로고침"
                        title="기상 데이터 새로고침"
                        onClick={refreshWeather}
                        disabled={isWeatherBusy}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] text-[var(--colors-ink-muted)] transition hover:text-[var(--colors-ink)] hover:bg-[var(--colors-surface-2)] disabled:opacity-50"
                      >
                        <RefreshCw size={18} className={isWeatherBusy ? "animate-spin" : ""} />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] p-4 flex justify-between items-center gap-3">
                    <div className="shrink-0 text-sm font-medium text-[var(--colors-ink-subtle)]">시스템 상태</div>
                    <div data-qa="weather-status" className="flex min-w-0 items-center gap-2 text-right text-base font-[700]">
                      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: FEED_TONE_COLORS[systemStatusTone] }} />
                      <span className="min-w-0 break-keep">{systemStatus}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-[var(--colors-ink-subtle)]">
                        <Thermometer size={16} /> 현재 기온
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-2xl font-semibold tracking-[-0.8px]">{activeWeather?.temperature ?? "-"}°C</span>
                        {isSimulationMode && (
                          <span className="dashboard-status-badge inline-flex items-center border border-[var(--colors-hairline-strong)] font-[700] leading-4">
                            시뮬레이션 값
                          </span>
                        )}
                      </div>
                      {!isSimulationMode && lastGoodCaption}
                    </div>
                    <div className="rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-[var(--colors-ink-subtle)]">
                        <Wind size={16} /> 풍속 / 습도
                      </div>
                      <div className="mt-3 text-sm font-semibold text-[var(--colors-ink)]">
                        {activeWeather?.wind_speed ?? "-"}m/s · {activeWeather?.humidity ?? "-"}%
                      </div>
                      {lastGoodCaption}
                    </div>
                    <div className="rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-[var(--colors-ink-subtle)]">
                        <Cloud size={16} /> 하늘 상태
                      </div>
                      <div className="mt-3 text-sm font-semibold text-[var(--colors-ink)]">
                        {activeWeather?.sky ?? weatherData?.summary?.sky_status ?? "-"}
                      </div>
                      {lastGoodCaption}
                    </div>
                    <div className="rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-[var(--colors-ink-subtle)]">
                        <Sun size={16} /> 태양 고도
                      </div>
                      <div className="mt-3 text-sm font-semibold text-[var(--colors-ink)]">
                        {formatNumber(sunAltitudeDegrees, 1)}°
                      </div>
                    </div>
                    <div className="col-span-2 rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-[var(--colors-ink-subtle)]">
                        <Gauge size={16} /> 대기질
                      </div>
                      <div className="mt-3 text-sm font-semibold text-[var(--colors-ink)]">
                        {weatherData?.summary?.air_quality_status ?? "-"}
                      </div>
                      {lastGoodCaption}
                    </div>
                  </div>
                  {(activeAlerts.length > 0 || weatherTimeline.length > 0) && (
                    <div className="grid gap-2">
                      {activeAlerts.map((alert) => (
                        <div
                          key={alert.id}
                          className="flex items-center gap-2 rounded-lg border border-[rgba(94,106,210,0.35)] bg-[rgba(94,106,210,0.14)] px-3 py-2 text-sm font-medium text-[var(--colors-ink)]"
                        >
                          <AlertTriangle size={16} className="text-[var(--colors-primary)]" />
                          {alert.label}
                        </div>
                      ))}
                      {weatherTimeline.map((item, index) => (
                        <div
                          key={`${item.fcstTime ?? index}`}
                          className="flex items-center justify-between rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] px-3 py-2 text-sm"
                        >
                          <span className="font-medium text-[var(--colors-ink-subtle)]">{item.fcstTime ?? `${index + 1}차 예보`}</span>
                          <span className="font-[700] text-[var(--colors-ink)]">
                            {item.tmp ?? item.temperature ?? "-"}°C
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              </PanelErrorBoundary>
            )}

            {activeTab === "microclimate" && (
              <PanelErrorBoundary label="미기후">
                <MicroclimatePanel
                  data={popupData}
                  loading={popupLoading}
                  error={popupError}
                  title={selectedId}
                  onClose={closeMicroclimatePanel}
                />
              </PanelErrorBoundary>
            )}

            {activeTab === "parking_safety" && (
              <PanelErrorBoundary label="주차·안전">
                <div className="space-y-6">
                  <div className="pb-4 border-b border-[var(--colors-hairline)]/50">
                    <div className="text-base font-[700] text-[var(--colors-ink)] flex items-center gap-2">
                      <Car size={18} className="text-[var(--colors-primary)]" />
                      D4 입출차 현황
                    </div>
                  </div>
                  <div>
                    <div data-qa="traffic-status" className="mb-3 text-sm font-[700] text-[var(--colors-ink-subtle)] flex items-center gap-2">
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: FEED_TONE_COLORS[trafficTone] }} />
                      <span className="min-w-0 break-words break-keep">{trafficFeed.message}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <MetricCard label="주차 대수" value={isTrafficLive ? `${trafficStats?.current_cars ?? 0}대` : "-"} hint={isTrafficLive ? `총 ${trafficStats?.total_spaces ?? "-"}면` : "-"} accent />
                      <MetricCard label="누적 입차" value={isTrafficLive ? `${trafficStats?.entered ?? 0}대` : "-"} hint="오늘" />
                      <MetricCard label="누적 출차" value={isTrafficLive ? `${trafficStats?.exited ?? 0}대` : "-"} hint="오늘" />
                    </div>
                  </div>

                  <TrafficSafetyPanel />
                  <div className="pb-4 border-b border-[var(--colors-hairline)]/50">
                    <div className="text-base font-[700] text-[var(--colors-ink)] flex items-center gap-2">
                      <ShieldAlert size={18} className="text-[var(--colors-primary)]" />
                      안전 모니터링
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <MetricCard label="위험 구역 접수" value={`${trafficData.length}건`} hint="샘플 데이터" />
                    <MetricCard
                      label="AI 자동 분류"
                      value={`${trafficData.filter((item) => item.ai_confidence >= 0.45).length}건`}
                      hint="우선 처리 대상"
                      accent
                    />
                  </div>
                  <div className="pt-2">
                    <div className="mb-3 text-sm font-[700] text-[var(--colors-ink-subtle)] flex items-center gap-2">
                      <ShieldAlert size={14} />
                      위험 구역 접수 현황 (샘플 데이터)
                    </div>
                    <div className="space-y-2">
                      {riskReports.map((item) => (
                        <div
                          key={item.report_id}
                          className="rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-[700] text-[var(--colors-ink)]">{item.category}</div>
                              <div className="mt-1 text-[13px] font-medium text-[var(--colors-ink-subtle)]">
                                {formatShortTime(item.timestamp)}
                              </div>
                            </div>
                            <span className="rounded-full border border-[var(--colors-hairline)] bg-[var(--colors-canvas)] px-2 py-1 text-[12px] font-[700] text-[var(--colors-ink-muted)]">
                              {item.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </PanelErrorBoundary>
            )}

            {activeTab === "energy" && (
              <PanelErrorBoundary label="에너지">
                <div className="space-y-4">
                  {installationPlansStatus === "error" && (
                    <div
                      role="alert"
                      data-qa="installation-plan-error"
                      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-medium text-[var(--colors-ink)]"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--colors-semantic-danger) 14%, var(--colors-surface-1))",
                        borderColor: "color-mix(in srgb, var(--colors-semantic-danger) 30%, var(--colors-hairline))",
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <AlertTriangle size={16} aria-hidden="true" className="shrink-0 text-[var(--colors-semantic-danger)]" />
                        <span className="min-w-0 break-keep">설치 계획을 불러오지 못했습니다</span>
                      </span>
                      <button
                        type="button"
                        onClick={retryInstallationPlans}
                        className="shrink-0 rounded-md border border-[var(--colors-hairline-strong)] bg-[var(--colors-surface-1)] px-3 py-1.5 text-sm font-[600] text-[var(--colors-ink)] transition hover:bg-[var(--colors-surface-2)]"
                      >
                        다시 시도
                      </button>
                    </div>
                  )}
                  <VWorldCampusStatus
                    onSelection={(selection) => selectBuilding(selection)}
                    className="w-full"
                  />
                  <RepresentativePlanOverlayController
                    buildingIds={CAMPUS_REPRESENTATIVE_BUILDING_IDS}
                    refreshKey={overlayRefreshKey}
                    onOverlayDataChange={() => {}}
                    onBuildingSelect={(buildingId) => {
                      const elementId = selectBuilding({
                        elementId: `BLD_${buildingId}`,
                        buildingId,
                        displayName: buildingId,
                      });
                      if (isD4ElementId(elementId)) openD4Section();
                    }}
                    className="w-full"
                    widthClassName="max-w-none"
                  />
                  <BuildingAnalysis
                    key={`${selectedBuildingId}:${representativePlanId ?? "none"}`}
                    buildingId={selectedBuildingId}
                    plans={installationPlans}
                    plansStatus={installationPlansStatus}
                    representativePlanId={representativePlanId}
                  />
                  <CampusComparison
                    onOpenRecommendation={(request) => {
                      setSelectedBuildingId(request.buildingId);
                      openD4Section(request);
                    }}
                  />
                  <EnergyDashboard key={selectedBuildingId} buildingId={selectedBuildingId} />
                </div>
              </PanelErrorBoundary>
            )}

            {activeTab === "environment" && (
              <PanelErrorBoundary label="환경 시뮬">
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4 pb-4 border-b border-[var(--colors-hairline)]/50">
                    <div className="flex items-center gap-2 text-base font-[700]">
                      <SlidersHorizontal size={18} className="text-[var(--colors-primary)]" />
                      환경 시뮬레이션
                    </div>
                    <div className="flex rounded-md border border-[var(--colors-hairline)] bg-[var(--colors-canvas)] p-1 text-sm font-[600]">
                      <button
                        type="button"
                        onClick={() => setMode("live")}
                        className={`rounded px-3 py-1.5 transition-colors ${mode === "live" ? "bg-[var(--colors-surface-2)] shadow-sm text-[var(--colors-ink)] border border-[var(--colors-hairline)]" : "text-[var(--colors-ink-subtle)]"}`}
                      >
                        Live
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("simulation")}
                        className={`rounded px-3 py-1.5 transition-colors ${mode === "simulation" ? "bg-[var(--colors-primary)] shadow-sm text-white" : "text-[var(--colors-ink-subtle)]"}`}
                      >
                        Sim
                      </button>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="text-sm font-[700] text-[var(--colors-ink-subtle)]">가상 환경 파라미터</div>
                    <SliderRow
                      label="온도 조절"
                      valueLabel={`${simTemp}°C`}
                      min={-10}
                      max={40}
                      value={simTemp}
                      onValueChange={setSimTemp}
                    />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-2">
                      <SliderRow
                        label="월"
                        valueLabel={`${sunMonth}월`}
                        min={1}
                        max={12}
                        value={sunMonth}
                        onValueChange={setSunMonth}
                      />
                      <SliderRow
                        label="일"
                        valueLabel={`${sunDay}일`}
                        min={1}
                        max={31}
                        value={sunDay}
                        onValueChange={setSunDay}
                      />
                      <SliderRow
                        label="시"
                        valueLabel={`${sunHour}시`}
                        min={0}
                        max={23}
                        value={sunHour}
                        onValueChange={setSunHour}
                      />
                      <SliderRow
                        label="분"
                        valueLabel={`${sunMinute}분`}
                        min={0}
                        max={59}
                        value={sunMinute}
                        onValueChange={setSunMinute}
                      />
                    </div>
                    <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] px-3 py-2 text-xs">
                      <span className="text-[var(--colors-ink-subtle)]">태양 방향</span>
                      <span className="font-semibold text-[var(--colors-ink)]">
                        {getCompassDirection(sunBearingDegrees)} {sunBearingDegrees.toFixed(0)}° · 고도{" "}
                        {sunAltitudeDegrees.toFixed(1)}°
                      </span>
                    </div>
                  </div>
                </div>
              </PanelErrorBoundary>
            )}
          </div>

          {weatherState === "error" && (
            <div
              role="alert"
              data-qa="weather-error-banner"
              className="mx-6 mb-6 mt-2 flex shrink-0 items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-medium text-[var(--colors-ink)]"
              style={{
                backgroundColor: "color-mix(in srgb, var(--colors-semantic-danger) 14%, var(--colors-surface-1))",
                borderColor: "color-mix(in srgb, var(--colors-semantic-danger) 30%, var(--colors-hairline))",
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <AlertTriangle size={16} aria-hidden="true" className="shrink-0 text-[var(--colors-semantic-danger)]" />
                <span className="min-w-0 break-keep">{weatherMessage}</span>
              </span>
              <button
                type="button"
                onClick={refreshWeather}
                disabled={isWeatherBusy}
                className="shrink-0 rounded-md border border-[var(--colors-hairline-strong)] bg-[var(--colors-surface-1)] px-3 py-1.5 text-sm font-[600] text-[var(--colors-ink)] transition hover:bg-[var(--colors-surface-2)] disabled:opacity-50"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <AccessibleDialog open onClose={closeSettings} title="설정" className="[&>h2]:sr-only">
            <FloatingPanel className="w-[min(400px,calc(100vw-2rem))] px-0 py-0 overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between border-b border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] px-5 py-4">
                <h3 className="font-[600] text-[18px] text-[var(--colors-ink)] tracking-[-0.1px]">설정</h3>
                <button
                  type="button"
                  aria-label="닫기"
                  title="닫기"
                  onClick={closeSettings}
                  className="text-[var(--colors-ink-muted)] hover:text-[var(--colors-ink)] transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <div className="mb-3 text-[13px] font-medium text-[var(--colors-ink-subtle)]">테마</div>
                  <div className="flex rounded-full border border-[var(--colors-hairline)] bg-[var(--colors-canvas)] p-1">
                    {[
                      { value: "light", icon: <Sun size={14} />, label: "라이트" },
                      { value: "system", icon: <Monitor size={14} />, label: "시스템" },
                      { value: "dark", icon: <Moon size={14} />, label: "다크" },
                    ].map(({ value, icon, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setThemeMode(value)}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm transition ${themeMode === value ? "bg-[var(--colors-surface-2)] text-[var(--colors-ink)]" : "text-[var(--colors-ink-subtle)] hover:text-[var(--colors-ink)]"}`}
                      >
                        {icon}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div role="group" aria-labelledby="render-quality-label" data-qa="render-quality">
                  <div id="render-quality-label" className="mb-3 text-[13px] font-medium text-[var(--colors-ink-subtle)]">3D 렌더링 품질</div>
                  <div className="flex rounded-full border border-[var(--colors-hairline)] bg-[var(--colors-canvas)] p-1">
                    {QUALITY_TIERS.map((tier) => (
                      <button
                        key={tier}
                        type="button"
                        aria-pressed={quality === tier}
                        data-qa={`render-quality-${tier}`}
                        onClick={() => setQuality(tier)}
                        className={`flex flex-1 items-center justify-center rounded-full px-3 py-2 text-sm transition ${quality === tier ? "bg-[var(--colors-surface-2)] text-[var(--colors-ink)]" : "text-[var(--colors-ink-subtle)] hover:text-[var(--colors-ink)]"}`}
                      >
                        {QUALITY_LABELS[tier]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] leading-[1.5] text-[var(--colors-ink-subtle)] break-keep">
                    낮음은 기본 렌더러, 보통은 계단 현상 보정과 가벼운 접촉 그림자, 높음은 정밀한 접촉 그림자와 밤 조명 번짐을 더합니다.
                    {qualitySource === "auto" ? " 지금은 이 기기의 그래픽 성능을 보고 자동으로 고른 값입니다." : ""}
                  </p>
                </div>
              </div>
            </FloatingPanel>
          </AccessibleDialog>
        </div>
      )}
    </div>
  );
}

import { WEATHER_STATE_TONES, formatClockTime } from "../hooks/feedStatus.mjs";

export const ALERT_RULES = Object.freeze([
  { id: "heat_island", label: "열섬 현상", check: (d) => (d?.heat_island_index ?? 0) >= 0.5 },
  { id: "high_temp", label: "고온 경보", check: (d) => (d?.temperature ?? 0) >= 35 },
  { id: "high_pm10", label: "PM10 초과", check: (d) => (d?.pm10 ?? 0) >= 80 },
  { id: "high_pm25", label: "PM2.5 초과", check: (d) => (d?.pm25 ?? 0) >= 50 },
  { id: "strong_wind", label: "강풍 경보", check: (d) => (d?.wind_speed ?? 0) >= 15 },
]);

function describeState({ isSimulationMode, state, message, observedClock }) {
  if (isSimulationMode) return "시뮬레이션 모드";
  if (state === "live") return `실시간 연동 정상${observedClock ? ` · 관측 ${observedClock}` : ""}`;
  if (state === "stale") return "저장된 기상 데이터 표시 중";
  if (state === "error") return message;
  return "기상 데이터 갱신 중";
}

// 기본 현황 탭이 보여 줄 기상 요약. 두 대시보드가 같은 문구(frontend/AGENTS.md 공용 상태 어휘)를 쓰도록 여기서만 만든다.
// 시뮬레이션 모드의 기온은 사용자가 고른 값(simTemp)으로 바꾼다.
export function summarizeWeather({ feed, mode, simTemp }) {
  const { data, state, message, lastUpdatedAt, isRefreshing } = feed;
  const isSimulationMode = mode === "simulation";
  let weather = data?.base_weather ?? null;
  if (weather && isSimulationMode) weather = { ...weather, temperature: simTemp };

  const freshness = data?.freshness?.weather;
  const observedClock = formatClockTime(freshness?.observed_at)
    ?? formatClockTime(freshness?.fetched_at)
    ?? formatClockTime(lastUpdatedAt);
  const lastGoodClock = formatClockTime(freshness?.fetched_at) ?? formatClockTime(lastUpdatedAt);
  const lastGoodLabel = state !== "live" && data && lastGoodClock ? `마지막 정상 수신 ${lastGoodClock}` : null;

  return {
    weather,
    isSimulationMode,
    status: describeState({ isSimulationMode, state, message, observedClock }),
    statusTone: isSimulationMode ? "neutral" : (WEATHER_STATE_TONES[state] ?? "neutral"),
    isBusy: state === "loading" || isRefreshing,
    observedClock,
    lastGoodLabel,
    skyStatus: weather?.sky ?? data?.summary?.sky_status ?? null,
    airQuality: data?.summary?.air_quality_status ?? null,
    alerts: weather ? ALERT_RULES.filter((rule) => rule.check(weather)) : [],
    timeline: Array.isArray(data?.weather_timeline) ? data.weather_timeline.slice(0, 3) : [],
  };
}

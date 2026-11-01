import { useEffect, useMemo, useState } from "react";

// 장면 날씨: 하늘·안개·햇빛 연출에 쓰는 현재 날씨 추정값. 프로젝트 기상 서비스(/environment/full)의 base_weather를
// 먼저 쓰고, 그것이 없을 때만 키 없는 Open-Meteo 예보 격자(D4에서 약 2.5 km)로 대신한다. 둘 다 추정값이며
// 화면 문구는 항상 "추정"으로 적고 "관측"이라고 적지 않는다.
export const OPEN_METEO_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=34.9700&longitude=127.4764&current=cloud_cover,precipitation,weather_code,visibility,is_day";
export const SCENE_WEATHER_REFRESH_MS = 600000;
export const OPEN_METEO_TIMEOUT_MS = 8000;

export const SCENE_WEATHER_SOURCE_LABELS = Object.freeze({
  project: "기상청 PTY 기반 운량",
  "open-meteo": "Open-Meteo 격자, D4에서 약 2.5 km",
});
export const SCENE_WEATHER_DEFAULT_TEXT = "하늘 연출 기본값 · 기상 정보 없음";

// 운량 c -> 햇빛 x (1 - 0.6c), 하늘 탁도 +6c. 시정 v(m) -> 안개가 90 %가 되는 거리를 300..1200 units로 두고
// 맑을 때(1200)와 비교한 밀도 배율. 강수 -> 환경광 감쇠. 모두 가정한 매핑(ASSUMED)이고 측정값이 아니다.
const SCENE_UNITS_PER_METRE = 0.6242171526;
const FOG_CLEAR_FAR_UNITS = 1200;
const FOG_MIN_FAR_UNITS = 300;
const CLOUD_SUN_LOSS = 0.6;
const CLOUD_TURBIDITY_GAIN = 6;
const RAIN_AMBIENT_LOSS = 0.3;
const RAIN_REFERENCE_MM = 2;
const RAIN_ASSUMED_VISIBILITY_M = 1500;

export const NEUTRAL_SCENE_WEATHER = Object.freeze({
  sunIntensityScale: 1,
  fogDensityScale: 1,
  turbidityDelta: 0,
  ambientScale: 1,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

// KMA PTY: 0 없음, 1 비, 2 비/눈, 3 눈, 5 빗방울, 6 빗방울/눈날림, 7 눈날림.
const PTY_PRECIPITATION_MM = { 0: 0, 1: 1.5, 2: 1.5, 3: 1.5, 5: 0.3, 6: 0.3, 7: 0.3 };
const PTY_SNOW = new Set([3, 7]);
// WMO weather_code: 71..77 눈, 85..86 소나기성 눈.
const isSnowCode = (code) => (code >= 71 && code <= 77) || code === 85 || code === 86;

export function sceneWeatherFromProject(weatherData) {
  const base = weatherData?.base_weather;
  const cloudCover = finiteOrNull(base?.cloud_cover);
  if (cloudCover === null) return null;
  const pty = finiteOrNull(base?.precipitation_type) ?? 0;
  return {
    source: "project",
    cloudCover: clamp(cloudCover, 0, 1),
    precipitation: PTY_PRECIPITATION_MM[pty] ?? 0,
    snow: PTY_SNOW.has(pty),
    visibility: null,
    isDay: null,
  };
}

export function parseOpenMeteoCurrent(body) {
  const current = body?.current;
  const cloudPercent = finiteOrNull(current?.cloud_cover);
  if (cloudPercent === null) return null;
  const code = finiteOrNull(current?.weather_code) ?? 0;
  return {
    source: "open-meteo",
    cloudCover: clamp(cloudPercent / 100, 0, 1),
    precipitation: Math.max(0, finiteOrNull(current?.precipitation) ?? 0),
    snow: isSnowCode(code),
    visibility: finiteOrNull(current?.visibility),
    isDay: current?.is_day === undefined ? null : Number(current.is_day) === 1,
  };
}

export function mapSceneWeather(observation) {
  if (!observation) return NEUTRAL_SCENE_WEATHER;
  const { cloudCover, precipitation } = observation;
  const visibilityMetres = observation.visibility ?? (precipitation > 0 ? RAIN_ASSUMED_VISIBILITY_M : null);
  let fogDensityScale = 1;
  if (visibilityMetres !== null) {
    const farUnits = clamp(visibilityMetres * SCENE_UNITS_PER_METRE, FOG_MIN_FAR_UNITS, FOG_CLEAR_FAR_UNITS);
    fogDensityScale = FOG_CLEAR_FAR_UNITS / farUnits;
  }
  return {
    sunIntensityScale: 1 - CLOUD_SUN_LOSS * cloudCover,
    fogDensityScale,
    turbidityDelta: CLOUD_TURBIDITY_GAIN * cloudCover,
    ambientScale: 1 - RAIN_AMBIENT_LOSS * clamp(precipitation / RAIN_REFERENCE_MM, 0, 1),
  };
}

export function describeSky({ cloudCover, precipitation, snow }) {
  if (precipitation > 0) return snow ? "눈" : "비";
  if (cloudCover < 0.25) return "맑음";
  if (cloudCover < 0.5) return "구름 조금";
  if (cloudCover < 0.75) return "구름 많음";
  return "흐림";
}

export function describeSceneWeather(observation) {
  if (!observation) {
    return { sky: null, source: null, estimated: false, text: SCENE_WEATHER_DEFAULT_TEXT };
  }
  const sky = describeSky(observation);
  const cloudPercent = Math.round(observation.cloudCover * 100);
  const source = SCENE_WEATHER_SOURCE_LABELS[observation.source];
  return {
    sky,
    source,
    estimated: true,
    text: `하늘 연출 ${sky} · 운량 ${cloudPercent}% · 추정(${source})`,
  };
}

export async function fetchOpenMeteo(fetchImpl = globalThis.fetch, { signal, timeoutMs = OPEN_METEO_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller);
  try {
    const response = await fetchImpl(OPEN_METEO_URL, { signal: controller.signal });
    if (!response?.ok) return null;
    return parseOpenMeteoCurrent(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

// weatherData/weatherState는 useWeatherFeed의 값이다. 프로젝트 피드가 아직 로딩 중이면 Open-Meteo를 부르지 않는다.
export function useSceneWeather({ weatherData, weatherState, fetchImpl }) {
  const project = useMemo(() => sceneWeatherFromProject(weatherData), [weatherData]);
  const needsFallback = project === null && weatherState !== "loading";
  const [fallback, setFallback] = useState({ observation: null, status: "idle" });

  useEffect(() => {
    if (!needsFallback) return undefined;
    const controller = new AbortController();
    let active = true;
    const load = async () => {
      setFallback((previous) => ({ ...previous, status: "loading" }));
      const observation = await fetchOpenMeteo(fetchImpl, { signal: controller.signal });
      if (!active) return;
      setFallback({ observation, status: observation ? "ready" : "error" });
    };
    load();
    const timer = setInterval(load, SCENE_WEATHER_REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [fetchImpl, needsFallback]);

  const observation = project ?? (needsFallback ? fallback.observation : null);
  const scene = useMemo(() => mapSceneWeather(observation), [observation]);
  const label = useMemo(() => describeSceneWeather(observation), [observation]);
  const status = project ? "project" : needsFallback ? fallback.status : "loading";
  return { observation, scene, label, status };
}

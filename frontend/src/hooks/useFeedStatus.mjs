import { useEffect, useReducer, useRef } from "react";
import { useSimulationStore } from "../simulation";
import { INITIAL_FEED_STATUS, reduceFeedStatus } from "./feedStatusModel.mjs";

const INITIAL = { weather: INITIAL_FEED_STATUS, traffic: INITIAL_FEED_STATUS, energy: INITIAL_FEED_STATUS, simulation: INITIAL_FEED_STATUS };
const isBrowserOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

function reducer(state, { feed, event }) {
  if (feed === "*") return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, reduceFeedStatus(value, event)]));
  return { ...state, [feed]: reduceFeedStatus(state[feed], event) };
}

// 피드 넷의 출력(useWeatherFeed, useTrafficFeed, useInstallationPlans, 시뮬레이션 소켓 상태)을 feedStatusModel로 모은다.
// 기상·에너지는 실패하면 1, 2, 4 ... 30초 간격으로 스스로 다시 묻는다(오프라인 동안은 멈춘다). 교통은 자기 폴링 간격을 쓰고,
// 시뮬레이션 소켓은 스스로 다시 연결한다. 반환값의 retry[feed]가 그 피드의 `다시 시도` 하나다.
export function useFeedStatus({ weather, traffic, plans }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const connection = useSimulationStore((snapshot) => snapshot.connectionStatus);

  useEffect(() => {
    // 요청이 끝날 때마다(isRefreshing true -> false) 한 번 센다. 같은 실패가 되풀이되어도 attempt가 늘어난다.
    if (weather.state === "loading" || weather.isRefreshing) return;
    const at = new Date();
    if (weather.state === "error") dispatch({ feed: "weather", event: { type: "failure", at, cause: weather.message } });
    else dispatch({ feed: "weather", event: { type: "success", at: weather.lastUpdatedAt ?? at, stale: weather.state === "stale", value: weather.data } });
  }, [weather.state, weather.message, weather.lastUpdatedAt, weather.data, weather.isRefreshing]);

  useEffect(() => {
    if (!traffic.lastUpdatedAt) return;
    if (traffic.state === "offline") dispatch({ feed: "traffic", event: { type: "failure", at: traffic.lastUpdatedAt, cause: traffic.message } });
    else dispatch({ feed: "traffic", event: { type: "success", at: traffic.lastUpdatedAt, value: traffic.stats } });
  }, [traffic.state, traffic.message, traffic.lastUpdatedAt, traffic.stats]);

  useEffect(() => {
    if (plans.status === "loading") return;
    const at = new Date();
    if (plans.status === "error") dispatch({ feed: "energy", event: { type: "failure", at, cause: "설치 계획을 불러오지 못했습니다" } });
    else dispatch({ feed: "energy", event: { type: "success", at, value: plans.plans } });
  }, [plans.status, plans.plans]);

  useEffect(() => {
    const at = new Date();
    if (connection === "연결됨") dispatch({ feed: "simulation", event: { type: "success", at } });
    else if (connection !== "연결 중") dispatch({ feed: "simulation", event: { type: "failure", at, cause: "교통 시뮬레이션 연결 끊김" } });
  }, [connection]);

  useEffect(() => {
    const offline = () => dispatch({ feed: "*", event: { type: "offline" } });
    const online = () => dispatch({ feed: "*", event: { type: "online" } });
    if (isBrowserOffline()) offline();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  // 기상·에너지 자동 다시 묻기. 실패할 때마다 attempt가 늘어 간격이 두 배가 된다.
  const retryRef = useRef({});
  retryRef.current = { weather: weather.refresh, energy: plans.retry };
  const weatherDelay = state.weather.status === "down" ? state.weather.retryInMs : null;
  const energyDelay = state.energy.status === "down" ? state.energy.retryInMs : null;
  useEffect(() => {
    if (weatherDelay == null) return undefined;
    const timer = setTimeout(() => retryRef.current.weather?.(), weatherDelay);
    return () => clearTimeout(timer);
  }, [weatherDelay, state.weather.attempt]);
  useEffect(() => {
    if (energyDelay == null) return undefined;
    const timer = setTimeout(() => retryRef.current.energy?.(), energyDelay);
    return () => clearTimeout(timer);
  }, [energyDelay, state.energy.attempt]);

  return { ...state, retry: { weather: weather.refresh, traffic: traffic.refresh, energy: plans.retry } };
}

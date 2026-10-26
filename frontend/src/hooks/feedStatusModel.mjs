import { formatClockTime } from "./feedStatus.mjs";

// 데이터 피드 넷(기상·교통·에너지·교통 시뮬레이션)의 상태를 한 모양으로 다룬다. DOM·타이머 없이 시험한다.
// status: loading(처음 받는 중) | live | stale(저장된 값) | down(실패) | paused(오프라인이라 묻지 않음).
export const FEEDS = Object.freeze(["weather", "traffic", "energy", "simulation"]);
export const FEED_LABELS = Object.freeze({ weather: "기상", traffic: "교통", energy: "에너지", simulation: "교통 시뮬레이션" });
export const RETRY_CAP_MS = 30000;

export const INITIAL_FEED_STATUS = Object.freeze({
  status: "loading", lastGood: null, lastGoodAt: null, checkedAt: null, cause: null, attempt: 0, retryInMs: null, offline: false,
});

// 연속 실패 attempt번째 뒤 다시 묻기까지: 1, 2, 4, 8 ... 초, 30초 상한.
export function nextRetryDelay(attempt) {
  if (attempt < 1) return 0;
  return Math.min(1000 * 2 ** (attempt - 1), RETRY_CAP_MS);
}

export function reduceFeedStatus(state = INITIAL_FEED_STATUS, event) {
  switch (event.type) {
    case "success":
      return {
        ...state, status: event.stale ? "stale" : "live", lastGood: event.value ?? state.lastGood, lastGoodAt: event.at,
        checkedAt: event.at, cause: null, attempt: 0, retryInMs: null,
      };
    case "failure": {
      if (state.offline) return { ...state, status: "paused", checkedAt: event.at, cause: event.cause ?? state.cause };
      const attempt = state.attempt + 1;
      return { ...state, status: "down", checkedAt: event.at, cause: event.cause ?? state.cause, attempt, retryInMs: nextRetryDelay(attempt) };
    }
    case "offline":
      return { ...state, offline: true, status: state.status === "live" || state.status === "stale" ? state.status : "paused", retryInMs: null };
    case "online":
      return { ...state, offline: false, status: state.status === "paused" ? "down" : state.status, attempt: 0, retryInMs: state.status === "paused" ? 0 : state.retryInMs };
    default:
      return state;
  }
}

export const isFeedDown = (state) => state.status === "down" || state.status === "paused";

// 사람이 읽는 한 줄: 원인(title)과 시각·다음 동작(detail). 저장된 값을 실시간이라고 하지 않는다.
export function describeFeedStatus(feed, state) {
  const label = FEED_LABELS[feed];
  const lastGood = formatClockTime(state.lastGoodAt);
  const checked = formatClockTime(state.checkedAt);
  const shown = lastGood ? `${lastGood} 값 표시 중` : "받은 값 없음";
  if (state.status === "live") return { title: `${label} 정상`, detail: lastGood ? `갱신 ${lastGood}` : "" };
  if (state.status === "stale") return { title: `저장된 ${label} 데이터 표시 중`, detail: lastGood ? `마지막 정상 수신 ${lastGood}` : "" };
  if (state.status === "loading") return { title: `${label} 데이터 갱신 중`, detail: "" };
  const cause = state.cause ?? `${label} 서버 응답 없음`;
  if (state.status === "paused") {
    return { title: cause, detail: [shown, "오프라인이라 묻기를 멈춤", "연결되면 다시 시도"].join(" · ") };
  }
  const next = feed === "simulation"
    ? "자동으로 다시 연결"
    : state.retryInMs ? `${Math.round(state.retryInMs / 1000)}초 뒤 다시 시도` : "다시 시도 대기";
  return { title: cause, detail: [shown, checked ? `확인 ${checked}` : null, next].filter(Boolean).join(" · ") };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTrafficOnce } from "./trafficFeedCore.mjs";
import { VISION_API_URL } from "../utils/apiConfig";
import { TRAFFIC_FEED_BACKOFF, nextPollWait } from "./agentDetailsBackoff.mjs";

const INITIAL_RESULT = {
  state: "offline",
  stats: null,
  message: "영상 분석 서버 연결 없음",
  lastUpdatedAt: null,
};

const isBrowserOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

// 영상 분석 서버를 2초마다 묻는다. 서버에 닿지 않으면(offline) 5 -> 10 -> 20 -> 30초로 간격을 늘려 1분에 많아야 4번만 묻는다.
// 브라우저가 오프라인이면 묻지 않고(paused), 다시 연결되면 바로 묻는다. refresh는 사용자가 누른 다시 시도다.
export function useTrafficFeed() {
  const [result, setResult] = useState(INITIAL_RESULT);
  const [paused, setPaused] = useState(isBrowserOffline);
  const pollNowRef = useRef(() => {});

  useEffect(() => {
    let active = true;
    let timer;
    let failures = 0;
    // 앞 요청 시작에서 이번 시작까지(장애 중 간격이 줄지 않게: nextPollWait).
    let previousGap = 0;

    const poll = async () => {
      clearTimeout(timer);
      if (isBrowserOffline()) return;
      const startedAt = Date.now();
      const next = await fetchTrafficOnce(fetch, `${VISION_API_URL}/api/traffic`);
      if (!active) return;
      setResult({ ...next, lastUpdatedAt: new Date() });
      failures = next.state === "offline" ? failures + 1 : 0;
      clearTimeout(timer);
      const { wait, gap } = nextPollWait({ failures, startedAt, completedAt: Date.now(), previousGap, backoff: TRAFFIC_FEED_BACKOFF });
      previousGap = failures > 0 ? gap : 0;
      if (!isBrowserOffline()) timer = setTimeout(poll, wait);
    };
    const goOffline = () => {
      clearTimeout(timer);
      setPaused(true);
    };
    const goOnline = () => {
      setPaused(false);
      failures = 0;
      previousGap = 0;
      poll();
    };

    pollNowRef.current = () => {
      failures = 0;
      previousGap = 0;
      poll();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    // 첫 요청은 한 틱 뒤에: 곧바로 정리되는 마운트(StrictMode의 시험 마운트)는 요청을 보내지 않는다.
    timer = setTimeout(poll, 0);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  const refresh = useCallback(() => pollNowRef.current(), []);
  return { ...result, paused, refresh };
}

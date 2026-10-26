import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTrafficOnce } from "./trafficFeedCore.mjs";
import { VISION_API_URL } from "../utils/apiConfig";
import { TRAFFIC_FEED_BACKOFF, nextPollDelay } from "./agentDetailsBackoff.mjs";

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

    const poll = async () => {
      clearTimeout(timer);
      if (isBrowserOffline()) return;
      const next = await fetchTrafficOnce(fetch, `${VISION_API_URL}/api/traffic`);
      if (!active) return;
      setResult({ ...next, lastUpdatedAt: new Date() });
      failures = next.state === "offline" ? failures + 1 : 0;
      clearTimeout(timer);
      if (!isBrowserOffline()) timer = setTimeout(poll, nextPollDelay(failures, TRAFFIC_FEED_BACKOFF));
    };
    const goOffline = () => {
      clearTimeout(timer);
      setPaused(true);
    };
    const goOnline = () => {
      setPaused(false);
      failures = 0;
      poll();
    };

    pollNowRef.current = () => {
      failures = 0;
      poll();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    poll();
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

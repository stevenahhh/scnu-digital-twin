import { useEffect, useState } from "react";
import { fetchTrafficOnce } from "./trafficFeedCore.mjs";
import { VISION_API_URL } from "../utils/apiConfig";
import { TRAFFIC_FEED_BACKOFF, nextPollDelay } from "./agentDetailsBackoff.mjs";

const INITIAL_RESULT = {
  state: "offline",
  stats: null,
  message: "영상 분석 서버 연결 없음",
  lastUpdatedAt: null,
};

// 영상 분석 서버를 2초마다 묻는다. 서버에 닿지 않으면(offline) 5 -> 10 -> 20 -> 30초로 간격을 늘려 1분에 많아야 4번만 묻는다.
export function useTrafficFeed() {
  const [result, setResult] = useState(INITIAL_RESULT);

  useEffect(() => {
    let active = true;
    let timer;
    let failures = 0;

    const poll = async () => {
      const next = await fetchTrafficOnce(fetch, `${VISION_API_URL}/api/traffic`);
      if (!active) return;
      setResult({ ...next, lastUpdatedAt: new Date() });
      failures = next.state === "offline" ? failures + 1 : 0;
      timer = setTimeout(poll, nextPollDelay(failures, TRAFFIC_FEED_BACKOFF));
    };

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  return result;
}

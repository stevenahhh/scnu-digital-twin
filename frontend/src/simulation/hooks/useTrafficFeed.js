import { useEffect, useState } from "react";
import { fetchTrafficOnce } from "./trafficFeedCore.mjs";
import { VISION_API_URL } from "../utils/apiConfig";

const INITIAL_RESULT = {
  state: "offline",
  stats: null,
  message: "영상 분석 서버 연결 없음",
  lastUpdatedAt: null,
};

export function useTrafficFeed() {
  const [result, setResult] = useState(INITIAL_RESULT);

  useEffect(() => {
    let active = true;
    let timer;

    const poll = async () => {
      const next = await fetchTrafficOnce(fetch, `${VISION_API_URL}/api/traffic`);
      if (!active) return;
      setResult({ ...next, lastUpdatedAt: new Date() });
      timer = setTimeout(poll, 2000);
    };

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  return result;
}

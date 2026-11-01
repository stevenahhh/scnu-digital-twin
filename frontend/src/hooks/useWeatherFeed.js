import { useCallback, useEffect, useRef, useState } from "react";
import { WEATHER_API_URL } from "../simulation/utils/apiConfig";
import { fetchEnvironment } from "./weatherFeedCore.mjs";

const REFRESH_INTERVAL_MS = 600000;

export function useWeatherFeed(baseUrl = WEATHER_API_URL) {
  const [feed, setFeed] = useState({
    state: "loading",
    data: null,
    freshness: null,
    message: "기상 데이터 갱신 중",
    lastUpdatedAt: null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const latestRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setIsRefreshing(true);
    try {
      const result = await fetchEnvironment(fetch, baseUrl);
      // 나중에 시작한 갱신이 있으면 늦게 도착한 이전 응답은 화면에 반영하지 않는다.
      if (requestId !== latestRequestRef.current) return;
      setFeed((previous) => {
        const successful = result.state === "live" || result.state === "stale";
        return {
          state: result.state,
          data: successful ? result.data : previous.data,
          freshness: result.freshness,
          message: result.message,
          lastUpdatedAt: successful ? new Date() : previous.lastUpdatedAt,
        };
      });
    } finally {
      if (requestId === latestRequestRef.current) setIsRefreshing(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { ...feed, isRefreshing, refresh };
}

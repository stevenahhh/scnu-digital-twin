import { useCallback, useEffect, useState } from "react";
import { fetchEnvironment } from "./weatherFeedCore.mjs";

const REFRESH_INTERVAL_MS = 600000;
const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

export function useWeatherFeed(baseUrl = API_BASE_URL) {
  const [feed, setFeed] = useState({
    state: "loading",
    data: null,
    freshness: null,
    message: "기상 데이터 갱신 중",
    lastUpdatedAt: null,
  });

  const refresh = useCallback(async () => {
    const result = await fetchEnvironment(fetch, baseUrl);
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
  }, [baseUrl]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { ...feed, refresh };
}

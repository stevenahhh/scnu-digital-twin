export function resolveServiceEndpoints(env = {}) {
  const trimTrailingSlashes = (url) => url.replace(/\/+$/, "");

  return {
    WEATHER_API_URL: trimTrailingSlashes(
      env.VITE_API_URL || env.VITE_WEATHER_API_URL || "http://127.0.0.1:8000"
    ),
    VISION_API_URL: trimTrailingSlashes(env.VITE_VISION_API_URL || "http://127.0.0.1:8001"),
    SIMULATION_API_URL: trimTrailingSlashes(env.VITE_SIMULATION_API_URL || "http://127.0.0.1:8002"),
    SIMULATION_WS_URL: trimTrailingSlashes(
      env.VITE_SIMULATION_WS_URL || "ws://127.0.0.1:8002/ws/simulation"
    ),
  };
}

const serviceEndpoints = resolveServiceEndpoints(import.meta.env ?? {});

export const WEATHER_API_URL = serviceEndpoints.WEATHER_API_URL;
export const VISION_API_URL = serviceEndpoints.VISION_API_URL;
export const SIMULATION_API_URL = serviceEndpoints.SIMULATION_API_URL;
export const SIMULATION_WS_URL = serviceEndpoints.SIMULATION_WS_URL;

export async function requestEnvironment(apiUrl, fetcher = globalThis.fetch, options) {
  const baseUrl = apiUrl.replace(/\/$/, "");
  const fullResponse = await fetcher(`${baseUrl}/environment/full`, options);
  if (fullResponse.ok) return fullResponse;

  const currentResponse = await fetcher(`${baseUrl}/microclimate/elements`, options);
  if (!currentResponse.ok) return fullResponse;

  const current = await currentResponse.json();
  return {
    ok: true,
    status: 200,
    json: async () => ({
      timestamp: current.timestamp,
      base_weather: current.base_weather,
      summary: { air_quality_status: "정보 없음" },
      weather_timeline: [],
      environment_status: "current-weather-only",
      freshness: {
        weather: current.freshness?.weather ?? { stale: true },
        forecast: null,
        air_quality: { stale: true, error: "unavailable" },
      },
      ...(current.sample_data === undefined ? {} : { sample_data: current.sample_data }),
    }),
  };
}

export async function loadEnvironment(apiUrl, fetcher = globalThis.fetch) {
  const response = await requestEnvironment(apiUrl, fetcher);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

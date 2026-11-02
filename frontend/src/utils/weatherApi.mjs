export async function loadEnvironment(apiUrl, fetcher = globalThis.fetch) {
  const baseUrl = apiUrl.replace(/\/$/, "");
  const fullResponse = await fetcher(`${baseUrl}/environment/full`);
  if (fullResponse.ok) return fullResponse.json();

  const currentResponse = await fetcher(`${baseUrl}/microclimate/elements`);
  if (!currentResponse.ok) throw new Error(`HTTP ${fullResponse.status}`);

  const current = await currentResponse.json();
  return {
    timestamp: current.timestamp,
    base_weather: current.base_weather,
    summary: { air_quality_status: "정보 없음" },
    weather_timeline: [],
    environment_status: "current-weather-only",
  };
}

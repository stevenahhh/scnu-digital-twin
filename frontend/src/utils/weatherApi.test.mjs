import assert from "node:assert/strict";
import test from "node:test";

import { loadEnvironment } from "./weatherApi.mjs";

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

test("falls back to current KMA weather when the full environment endpoint fails", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.endsWith("/environment/full")) return response(500, { detail: "AirKorea unavailable" });
    return response(200, {
      timestamp: "20260820T2300",
      base_weather: { temperature: 23.6, humidity: 97, wind_speed: 0.1 },
    });
  };

  const result = await loadEnvironment("http://127.0.0.1:8000", fetcher);

  assert.deepEqual(calls, [
    "http://127.0.0.1:8000/environment/full",
    "http://127.0.0.1:8000/microclimate/elements",
  ]);
  assert.equal(result.base_weather.temperature, 23.6);
  assert.equal(result.summary.air_quality_status, "정보 없음");
  assert.deepEqual(result.weather_timeline, []);
});

test("uses the complete environment response without a fallback request", async () => {
  const expected = { base_weather: { temperature: 25 }, weather_timeline: [{ lead_hour: 1 }] };
  let calls = 0;
  const result = await loadEnvironment("http://127.0.0.1:8000", async () => {
    calls += 1;
    return response(200, expected);
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, expected);
});

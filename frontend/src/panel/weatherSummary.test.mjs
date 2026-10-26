import assert from "node:assert/strict";
import test from "node:test";
import { summarizeWeather } from "./weatherSummary.mjs";

const feed = (overrides = {}) => ({ data: null, state: "loading", message: "", lastUpdatedAt: null, isRefreshing: false, ...overrides });

test("simulation mode names itself and replaces only the temperature", () => {
  const data = { base_weather: { temperature: 12, wind_speed: 2 }, summary: { sky_status: "맑음", air_quality_status: "좋음" } };
  const summary = summarizeWeather({ feed: feed({ data, state: "live" }), mode: "simulation", simTemp: 30 });
  assert.equal(summary.status, "시뮬레이션 모드");
  assert.equal(summary.statusTone, "neutral");
  assert.deepEqual(summary.weather, { temperature: 30, wind_speed: 2 });
  assert.equal(summary.skyStatus, "맑음");
  assert.equal(summary.airQuality, "좋음");
});

test("live mode reports the observation time and the feed tone", () => {
  const data = { base_weather: { temperature: 12 }, freshness: { weather: { observed_at: "2026-10-26T15:00:00" } } };
  const summary = summarizeWeather({ feed: feed({ data, state: "live" }), mode: "live", simTemp: 20 });
  assert.equal(summary.status, "실시간 연동 정상 · 관측 15:00");
  assert.equal(summary.statusTone, "success");
  assert.equal(summary.lastGoodLabel, null);
});

test("a failed feed keeps its message, its last good time and no weather values", () => {
  const down = summarizeWeather({ feed: feed({ state: "error", message: "기상 서버에 연결할 수 없습니다" }), mode: "live", simTemp: 20 });
  assert.equal(down.status, "기상 서버에 연결할 수 없습니다");
  assert.equal(down.statusTone, "danger");
  assert.equal(down.weather, null);
  assert.deepEqual(down.alerts, []);

  const stale = summarizeWeather({
    feed: feed({ state: "stale", data: { base_weather: { temperature: 36 }, freshness: { weather: { fetched_at: "2026-10-26T09:05:00" } } } }),
    mode: "live",
    simTemp: 20,
  });
  assert.equal(stale.status, "저장된 기상 데이터 표시 중");
  assert.equal(stale.lastGoodLabel, "마지막 정상 수신 09:05");
  assert.deepEqual(stale.alerts.map((alert) => alert.id), ["high_temp"]);
});

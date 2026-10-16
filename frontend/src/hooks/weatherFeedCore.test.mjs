import assert from "node:assert/strict";
import test from "node:test";
import { fetchEnvironment } from "./weatherFeedCore.mjs";

const C1_UNAVAILABLE = {
  detail: {
    code: "weather_upstream_unavailable",
    source: "kma_current",
    reason: "timeout",
    message_ko: "기상청 응답 지연으로 최신 기상 데이터를 가져오지 못했습니다",
    message_en: "Weather data unavailable",
    retry_after_s: 60,
  },
};

const C1_KEY_MISSING = {
  detail: {
    code: "weather_api_key_missing",
    source: "kma_current",
    reason: "configuration",
    message_ko: "기상 API 키가 설정되지 않았습니다 (KMA_SERVICE_KEY)",
    message_en: "Weather API key is missing",
    retry_after_s: 60,
  },
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("200 response with fresh weather is live", async () => {
  const data = { base_weather: { temperature: 22 }, freshness: { weather: { stale: false } } };
  const result = await fetchEnvironment(async () => response(200, data), "http://api.test");
  assert.deepEqual(result, { state: "live", data, freshness: data.freshness, code: null, message: null });
});

test("200 response with stale weather is stale", async () => {
  const data = { base_weather: {}, freshness: { weather: { stale: true } } };
  const result = await fetchEnvironment(async () => response(200, data), "http://api.test");
  assert.equal(result.state, "stale");
  assert.deepEqual(result.data, data);
});

test("C1 upstream unavailable returns its typed Korean message", async () => {
  const result = await fetchEnvironment(async () => response(503, C1_UNAVAILABLE), "http://api.test");
  assert.equal(result.state, "error");
  assert.equal(result.code, "weather_upstream_unavailable");
  assert.equal(result.message, C1_UNAVAILABLE.detail.message_ko);
  assert.equal(result.data, null);
});

test("C1 missing API key returns its typed Korean message", async () => {
  const result = await fetchEnvironment(async () => response(503, C1_KEY_MISSING), "http://api.test");
  assert.equal(result.state, "error");
  assert.equal(result.code, "weather_api_key_missing");
  assert.equal(result.message, C1_KEY_MISSING.detail.message_ko);
});

test("network failures use the C5 network message", async () => {
  const result = await fetchEnvironment(async () => { throw new TypeError("offline"); }, "http://api.test");
  assert.equal(result.state, "error");
  assert.equal(result.code, "network_error");
  assert.equal(result.message, "기상 서버에 연결할 수 없습니다");
});

test("abort uses the C5 timeout message and abort signal", async () => {
  let signal;
  const result = await fetchEnvironment((_url, options) => {
    signal = options.signal;
    return new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  }, "http://api.test", { timeoutMs: 1 });
  assert.equal(signal.aborted, true);
  assert.equal(result.state, "error");
  assert.equal(result.code, "timeout");
  assert.equal(result.message, "기상 서버 응답이 지연되고 있습니다");
});

test("non-C1 HTTP errors remain typed errors", async () => {
  const result = await fetchEnvironment(async () => response(404, { detail: { code: "not_found", message_ko: "찾을 수 없습니다" } }), "http://api.test");
  assert.equal(result.state, "error");
  assert.equal(result.code, "not_found");
  assert.equal(result.message, "찾을 수 없습니다");
});

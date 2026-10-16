import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrafficResult, fetchTrafficOnce } from "./trafficFeedCore.mjs";

test("classifies a network error as offline", () => {
  assert.equal(classifyTrafficResult({
    ok: false,
    status: 0,
    body: null,
    error: new TypeError("Failed to fetch"),
  }).state, "offline");
});

test("classifies an HTTP 500 response as offline", () => {
  assert.deepEqual(classifyTrafficResult({
    ok: false,
    status: 500,
    body: {},
    error: null,
  }), {
    state: "offline",
    stats: null,
    message: "영상 분석 서버 연결 없음",
  });
});

test("classifies an aborted timeout as offline with timeout text", async () => {
  const result = await fetchTrafficOnce(
    (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    "http://vision.test/api/traffic",
    { timeoutMs: 5 },
  );

  assert.equal(result.state, "offline");
  assert.equal(result.message, "영상 분석 서버 연결 없음");
});

test("classifies a stopped camera and retains server error text", () => {
  const result = classifyTrafficResult({
    ok: true,
    status: 200,
    body: { is_running: false, error: "camera unavailable" },
    error: null,
  });

  assert.equal(result.state, "camera-off");
  assert.equal(result.message, "카메라·모델 미작동: camera unavailable");
});

test("classifies a running camera as live", () => {
  const stats = { is_running: true, current_cars: 3 };
  assert.deepEqual(classifyTrafficResult({
    ok: true,
    status: 200,
    body: stats,
    error: null,
  }), {
    state: "live",
    stats,
    message: "실시간 영상 분석 중",
  });
});

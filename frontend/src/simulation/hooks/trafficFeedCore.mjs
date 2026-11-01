const MESSAGES = {
  live: "실시간 영상 분석 중",
  offline: "영상 분석 서버 연결 없음",
  "camera-off": "카메라·모델 미작동",
};

export function classifyTrafficResult({ ok, status, body, error }) {
  if (error) {
    return { state: "offline", stats: null, message: MESSAGES.offline };
  }

  if (!ok || status < 200 || status >= 300) {
    return { state: "offline", stats: null, message: MESSAGES.offline };
  }

  if (body?.is_running === false) {
    return {
      state: "camera-off",
      stats: body,
      message: body.error ? `${MESSAGES["camera-off"]}: ${body.error}` : MESSAGES["camera-off"],
    };
  }

  return { state: "live", stats: body, message: MESSAGES.live };
}

export async function fetchTrafficOnce(fetchImpl, url, { timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    let body = null;
    try {
      body = await response.json();
    } catch {
      // A non-JSON response is classified using its HTTP status.
    }
    return classifyTrafficResult({
      ok: response.ok,
      status: response.status,
      body,
      error: null,
    });
  } catch (error) {
    return classifyTrafficResult({ ok: false, status: 0, body: null, error });
  } finally {
    clearTimeout(timeout);
  }
}

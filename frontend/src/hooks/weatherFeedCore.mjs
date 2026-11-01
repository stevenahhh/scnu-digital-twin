const NETWORK_MESSAGE = "기상 서버에 연결할 수 없습니다";
const TIMEOUT_MESSAGE = "기상 서버 응답이 지연되고 있습니다";
const UPSTREAM_MESSAGE = "기상청 응답 지연으로 최신 기상 데이터를 가져오지 못했습니다";

export async function fetchEnvironment(fetchImpl, baseUrl, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/environment/full`, { signal: controller.signal });
    const body = await response.json();

    if (response.ok) {
      return {
        state: body.freshness?.weather?.stale ? "stale" : "live",
        data: body,
        freshness: body.freshness ?? null,
        code: null,
        message: null,
      };
    }

    const detail = body?.detail;
    if (response.status === 503 && detail?.code?.startsWith("weather_")) {
      return {
        state: "error",
        data: null,
        freshness: null,
        code: detail.code,
        message: detail.message_ko ?? UPSTREAM_MESSAGE,
      };
    }

    return {
      state: "error",
      data: null,
      freshness: null,
      code: detail?.code ?? `http_${response.status}`,
      message: detail?.message_ko ?? UPSTREAM_MESSAGE,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === "AbortError";
    return {
      state: "error",
      data: null,
      freshness: null,
      code: timedOut ? "timeout" : "network_error",
      message: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE,
    };
  } finally {
    clearTimeout(timeout);
  }
}

import { SIMULATION_API_URL } from "../utils/apiConfig";

// 시뮬레이션 서버가 2xx가 아닌 답을 줬다. detail은 서버가 보낸 설명(있으면)이다.
export class SimulationHttpError extends Error {
  constructor(status, detail) {
    super(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`);
    this.name = "SimulationHttpError";
    this.status = status;
    this.detail = detail ?? null;
  }
}

async function readDetail(response) {
  try {
    const body = await response.json();
    return typeof body?.detail === "string" ? body.detail : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function request(path, init, fetchImpl) {
  const response = await (fetchImpl ?? globalThis.fetch)(`${SIMULATION_API_URL}${path}`, init);
  if (!response.ok) throw new SimulationHttpError(response.status, await readDetail(response));
  return response.json();
}

// 시뮬레이션 HTTP API의 GET 하나. 2xx가 아니면 SimulationHttpError, 연결 실패는 fetch의 TypeError 그대로다.
export function getJson(path, { signal, fetchImpl } = {}) {
  return request(path, { signal }, fetchImpl);
}

export function postJson(path, body, { fetchImpl } = {}) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, fetchImpl);
}

// 알려진 실패를 한국어 문구로. 그 밖의 오류는 부르는 쪽이 다시 던진다(null을 돌려준다).
export function describeSimulationError(error) {
  if (error instanceof SimulationHttpError) {
    if (error.status === 404) return "요청한 시뮬레이션 자료가 없습니다";
    return `시뮬레이션 서버 요청이 실패했습니다 (HTTP ${error.status})`;
  }
  if (error instanceof TypeError) return "시뮬레이션 서버에 연결할 수 없습니다";
  return null;
}

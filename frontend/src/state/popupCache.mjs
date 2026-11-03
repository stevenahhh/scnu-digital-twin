import { WEATHER_API_URL } from "../simulation/utils/apiConfig";

// 건물 미기후 팝업 응답의 공용 캐시(인스펙터와 비교 패인이 함께 쓴다). 인스펙터가 받은 응답을 넣어 두고,
// 비교 패인은 없는 건물만 같은 요청(`/microclimate/elements/{id}/popup`)으로 한 번 받는다. 진행 중인 요청도 한 번만 보낸다.
const cache = new Map();
const inFlight = new Map();

export function rememberPopup(elementId, data) {
  if (elementId && data) cache.set(elementId, data);
}

export function cachedPopup(elementId) {
  return cache.get(elementId) ?? null;
}

export function loadPopupOnce(elementId, { apiUrl = WEATHER_API_URL, fetchImpl = globalThis.fetch } = {}) {
  if (cache.has(elementId)) return Promise.resolve(cache.get(elementId));
  if (inFlight.has(elementId)) return inFlight.get(elementId);
  const request = fetchImpl(`${apiUrl}/microclimate/elements/${elementId}/popup`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      cache.set(elementId, data);
      return data;
    })
    .finally(() => inFlight.delete(elementId));
  inFlight.set(elementId, request);
  return request;
}

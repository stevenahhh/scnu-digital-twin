import { useCallback, useEffect, useRef, useState } from "react";
import { WEATHER_API_URL } from "../simulation/utils/apiConfig";

export const POPUP_ERRORS = Object.freeze({
  network: "기상 서버에 연결할 수 없습니다",
  notFound: "이 건물의 미기후 데이터가 없습니다",
  http: "미기후 추정을 불러오지 못했습니다",
});

class PopupHttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.name = "PopupHttpError";
    this.status = status;
  }
}

// 건물 하나의 미기후 팝업(`/microclimate/elements/{id}/popup`, 완전한 응답 하나)을 받는다.
// 새 요청이나 언마운트는 이전 요청을 끊는다. 알려진 실패만 문구로 바꾸고, 그 밖의 오류는 다시 던진다.
// lastData는 같은 건물의 마지막 정상 응답이다. 다시 시도가 실패해도 그 값을 알림 아래에 그대로 보여 줄 수 있다.
const EMPTY = Object.freeze({ data: null, loading: false, error: null, errorDetail: null, lastData: null });

export function usePopupData({ apiUrl = WEATHER_API_URL, fetchImpl } = {}) {
  const [state, setState] = useState(EMPTY);
  const controllerRef = useRef(null);
  const elementIdRef = useRef(null);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    elementIdRef.current = null;
    setState(EMPTY);
  }, []);

  const load = useCallback(async (elementId) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const sameElement = elementIdRef.current === elementId;
    elementIdRef.current = elementId;
    setState((previous) => ({ ...EMPTY, loading: true, lastData: sameElement ? previous.data ?? previous.lastData : null }));
    const request = fetchImpl ?? globalThis.fetch;
    try {
      const response = await request(`${apiUrl}/microclimate/elements/${elementId}/popup`, { signal: controller.signal });
      if (!response.ok) throw new PopupHttpError(response.status);
      const data = await response.json();
      if (controllerRef.current === controller) setState({ ...EMPTY, data, lastData: data });
    } catch (error) {
      if (error?.name === "AbortError" || controllerRef.current !== controller) return;
      let message;
      if (error instanceof PopupHttpError) message = error.status === 404 ? POPUP_ERRORS.notFound : POPUP_ERRORS.http;
      else if (error instanceof TypeError) message = POPUP_ERRORS.network;
      else {
        setState((previous) => ({ ...previous, loading: false }));
        throw error;
      }
      setState((previous) => ({ ...previous, loading: false, error: message, errorDetail: `${elementId}: ${error.message}` }));
    }
  }, [apiUrl, fetchImpl]);

  const retry = useCallback(() => {
    if (elementIdRef.current) load(elementIdRef.current);
  }, [load]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, load, retry, clear };
}

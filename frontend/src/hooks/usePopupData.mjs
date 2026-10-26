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
export function usePopupData({ apiUrl = WEATHER_API_URL, fetchImpl } = {}) {
  const [state, setState] = useState({ data: null, loading: false, error: null, errorDetail: null });
  const controllerRef = useRef(null);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ data: null, loading: false, error: null, errorDetail: null });
  }, []);

  const load = useCallback(async (elementId) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ data: null, loading: true, error: null, errorDetail: null });
    const request = fetchImpl ?? globalThis.fetch;
    try {
      const response = await request(`${apiUrl}/microclimate/elements/${elementId}/popup`, { signal: controller.signal });
      if (!response.ok) throw new PopupHttpError(response.status);
      const data = await response.json();
      if (controllerRef.current === controller) setState({ data, loading: false, error: null, errorDetail: null });
    } catch (error) {
      if (error?.name === "AbortError" || controllerRef.current !== controller) return;
      let message;
      if (error instanceof PopupHttpError) message = error.status === 404 ? POPUP_ERRORS.notFound : POPUP_ERRORS.http;
      else if (error instanceof TypeError) message = POPUP_ERRORS.network;
      else {
        setState((previous) => ({ ...previous, loading: false }));
        throw error;
      }
      setState({ data: null, loading: false, error: message, errorDetail: `${elementId}: ${error.message}` });
    }
  }, [apiUrl, fetchImpl]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, load, clear };
}

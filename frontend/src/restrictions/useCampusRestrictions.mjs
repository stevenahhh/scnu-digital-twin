import { useCallback, useEffect, useRef, useState } from "react";
import { deleteJson, getJson, postJson } from "../simulation/api/simulationHttp.mjs";
import { parseRestrictions } from "./restrictionModel.mjs";

const POLL_MS = 5000;
const DOWN_POLL_MS = 30000;
const PATH = "/api/simulation/restrictions";

export const createRestriction = (body) => postJson(PATH, body);
export const removeRestriction = (id) => deleteJson(`${PATH}/${encodeURIComponent(id)}`);
export const fetchRestrictionTargets = (options) => getJson(`${PATH}/targets`, options);

// 진행 중인 통제·공사 알림을 시뮬레이션 서버에서 주기적으로 읽는다. 서버가 끊기면 마지막 목록을 두고 천천히 다시 묻는다.
// 내용이 그대로면 같은 배열을 유지해 3D 장면이 다시 그려지지 않는다.
export function useCampusRestrictions() {
  const [state, setState] = useState({ items: [], status: "loading" });
  const pollRef = useRef(() => {});

  useEffect(() => {
    let disposed = false;
    let timer = null;
    let controller = null;
    let lastBody = "[]";
    const poll = async () => {
      window.clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      let wait = POLL_MS;
      try {
        if (!document.hidden) {
          const items = parseRestrictions(await getJson(PATH, { signal: controller.signal }));
          if (disposed) return;
          const body = JSON.stringify(items);
          const changed = body !== lastBody;
          lastBody = body;
          setState((previous) => (changed || previous.status !== "live" ? { items: changed ? items : previous.items, status: "live" } : previous));
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (disposed) return;
        wait = DOWN_POLL_MS;
        setState((previous) => (previous.status === "down" ? previous : { ...previous, status: "down" }));
      }
      timer = window.setTimeout(poll, wait);
    };
    pollRef.current = poll;
    poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  const refresh = useCallback(() => pollRef.current(), []);
  return { ...state, refresh };
}

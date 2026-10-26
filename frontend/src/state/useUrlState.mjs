import { useEffect, useRef } from "react";
import { decodeViewState, encodeViewState, normalizeSearch } from "./urlState.mjs";

const CAMERA_CHECK_MS = 1000;
const CAMERA_WAIT_MS = 10000;

// 화면 상태를 주소에 담고, 처음 열 때 주소의 상태를 평소 경로로 되살린다(두 대시보드 공용).
// state: { building, minute, date, mode, panelOpen, tab } 지금 값. apply: 같은 이름의 setter(없는 것은 건너뛴다)와 camera(pose).
// getCamera(): { position, target } 또는 null(카메라를 담지 않는 화면은 주지 않는다).
// 쓰기는 history.replaceState로 debounceMs 뒤 한 번(기록을 쌓지 않는다). 카메라는 1초마다 바뀌었는지만 본다.
export function useUrlState({ knownIds, state, apply, getCamera = null, debounceMs = 300, win = window }) {
  const appliedRef = useRef(false);
  const pendingCameraRef = useRef(null);
  const timerRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const getCameraRef = useRef(getCamera);
  getCameraRef.current = getCamera;

  // 처음 한 번: 주소 -> 화면. 잘못된 키는 주소에서 지운다.
  useEffect(() => {
    const { location, history } = win;
    const decoded = decodeViewState(location.search, { knownIds });
    const actions = applyRef.current;
    if (decoded.mode) actions.mode?.(decoded.mode);
    // 실측(live)은 지금 시각을 따르므로 주소의 날짜·시각을 놓지 않는다(놓으면 시뮬레이션으로 바뀐다).
    if (decoded.mode !== "live" && decoded.date) actions.date?.(decoded.date);
    if (decoded.mode !== "live" && decoded.minute !== undefined) actions.minute?.(decoded.minute);
    if (decoded.tab) actions.tab?.(decoded.tab);
    if (decoded.panelOpen !== undefined) actions.panelOpen?.(decoded.panelOpen);
    if (decoded.building) actions.building?.(decoded.building);
    const normalized = normalizeSearch(location.search, { knownIds });
    if (normalized !== location.search) history.replaceState(history.state, "", `${location.pathname}${normalized}${location.hash}`);
    appliedRef.current = true;
    if (!decoded.camera || !actions.camera) return undefined;
    // 카메라는 조작기가 생긴 뒤에 놓는다(비행 없이). 그 사이 쓰기는 주소의 카메라 값을 그대로 둔다.
    pendingCameraRef.current = decoded.camera;
    const started = Date.now();
    let frame = 0;
    const tryApply = () => {
      if (applyRef.current.camera(decoded.camera) || Date.now() - started > CAMERA_WAIT_MS) {
        pendingCameraRef.current = null;
        return;
      }
      frame = win.requestAnimationFrame(tryApply);
    };
    tryApply();
    return () => win.cancelAnimationFrame(frame);
  }, []); // 처음 열 때 한 번만 읽는다.

  // 화면 -> 주소(debounce). 카메라는 1초마다 비교해 바뀌었을 때만 같은 쓰기를 부른다.
  const { building, minute, date, mode, panelOpen, tab } = state;
  useEffect(() => {
    if (!appliedRef.current) return undefined;
    const write = () => {
      const { location, history } = win;
      const camera = pendingCameraRef.current ?? getCameraRef.current?.() ?? null;
      const next = encodeViewState({ ...stateRef.current, camera }, location.search);
      if (next !== location.search) history.replaceState(history.state, "", `${location.pathname}${next}${location.hash}`);
    };
    win.clearTimeout(timerRef.current);
    timerRef.current = win.setTimeout(write, debounceMs);
    let lastCamera = JSON.stringify(getCameraRef.current?.() ?? null);
    const watch = getCameraRef.current ? win.setInterval(() => {
      const now = JSON.stringify(getCameraRef.current?.() ?? null);
      if (now === lastCamera) return;
      lastCamera = now;
      win.clearTimeout(timerRef.current);
      timerRef.current = win.setTimeout(write, debounceMs);
    }, CAMERA_CHECK_MS) : null;
    return () => {
      win.clearTimeout(timerRef.current);
      if (watch !== null) win.clearInterval(watch);
    };
  }, [building, minute, date, mode, panelOpen, tab, debounceMs, win]);
}

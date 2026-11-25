// 로그인부터 3D 장면이 보일 때까지의 진행 상태. three를 불러오지 않아 첫 번들에 들어가도 가볍다.
const MEGABYTE = 1024 * 1024;
const DOWNLOAD_SHARE = 0.78;
const PARSE_SHARE = 0.2;
const UNKNOWN_SIZE_SCALE_BYTES = 40 * MEGABYTE;
const INITIAL = Object.freeze({ bytesLoaded: 0, bytesTotal: 0, downloadedAt: null, sceneReady: false, failed: false, settled: false });

// 내려받기는 실제 바이트로, 모델 해석은 파일 크기에 비례한 시간 상수로 다가가게 계산한다. 장면이 뜨기 전에는 1에 닿지 않는다.
export function overallProgress({ bytesLoaded, bytesTotal, downloadedAt, sceneReady, failed = false }, now) {
  if (sceneReady || failed) return 1;
  if (downloadedAt !== null) {
    const parseMs = Math.max(800, (bytesTotal / MEGABYTE) * 60);
    return DOWNLOAD_SHARE + PARSE_SHARE * (1 - Math.exp(-Math.max(0, now - downloadedAt) / parseMs));
  }
  const fraction = bytesTotal > 0 ? Math.min(1, bytesLoaded / bytesTotal) : 1 - Math.exp(-bytesLoaded / UNKNOWN_SIZE_SCALE_BYTES);
  return DOWNLOAD_SHARE * fraction;
}

// 프레임 간격과 상관없이 같은 곡선으로 target에 다가간다.
export const approach = (value, target, dt, tau) => value + (target - value) * (1 - Math.exp(-dt / tau));

// 걷히는 시간은 화면 대각선에 비례한다. 움직임 줄이기에서는 짧은 페이드만 남는다.
export function revealSeconds(width, height, reducedMotion) {
  if (reducedMotion) return 0.2;
  return Math.min(1.4, Math.max(0.7, Math.hypot(width, height) / 1500));
}

export function createCampusLoad(now = Date.now) {
  let state = INITIAL;
  const listeners = new Set();
  const update = (patch) => {
    const next = { ...state, ...patch };
    state = { ...next, settled: next.sceneReady || next.failed };
    listeners.forEach((listener) => listener());
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reportBytes: (bytesLoaded, bytesTotal) => update({ bytesLoaded, bytesTotal }),
    reportDownloaded: () => update({ bytesLoaded: state.bytesTotal || state.bytesLoaded, downloadedAt: now() }),
    markSceneReady: () => update({ sceneReady: true, failed: false }),
    markSceneGone: () => update({ sceneReady: false }),
    markFailed: () => update({ failed: true }),
    restart: () => update(INITIAL),
  };
}

export const campusLoad = createCampusLoad();

import { useCallback, useState } from "react";

// 3D 캠퍼스 렌더링 품질 단계.
// - low: 지금까지의 렌더러 그대로(후처리 없음). 후처리 청크도 받지 않는다.
// - medium: SMAA + 절반 해상도 N8AO(가벼운 접촉 그림자).
// - high: 전체 해상도 N8AO + SMAA + 밤의 창문·가로등에만 은은한 bloom.
// 톤 매핑은 모든 단계에서 Neutral이다(후처리 단계에서는 컴포저의 ToneMapping 효과가 맡는다).
export const QUALITY_TIERS = Object.freeze(["low", "medium", "high"]);
export const QUALITY_LABELS = Object.freeze({ low: "낮음", medium: "보통", high: "높음" });
export const QUALITY_STORAGE_KEY = "scnu.renderQuality";

export function parseQuality(value) {
  return QUALITY_TIERS.includes(value) ? value : null;
}

// 후처리 단계별 설정. low는 null이라 효과 청크를 아예 마운트하지 않는다.
export const QUALITY_EFFECTS = Object.freeze({
  low: null,
  medium: Object.freeze({ ao: Object.freeze({ halfRes: true, quality: "performance", intensity: 1.5 }), bloom: false }),
  high: Object.freeze({ ao: Object.freeze({ halfRes: false, quality: "medium", intensity: 2 }), bloom: true }),
});

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobi/i;
const CAPABLE_GPU = /nvidia|geforce|quadro|\brtx\b|radeon (rx|pro)|apple m\d/i;

// 첫 방문자의 기본 단계를 고르는 가벼운 추정. 측정이 아니라 GPU 이름과 화면 배율만 본다.
// 소프트웨어 렌더러와 모바일은 low, 외장급·Apple Silicon GPU는 high(배율이 2를 넘으면 medium),
// 그 밖(내장 GPU·이름을 모름)은 배율 1.5 이하에서만 medium이다.
export function pickDefaultQuality({ renderer = "", devicePixelRatio = 1, userAgent = "" } = {}) {
  if (SOFTWARE_GPU.test(renderer) || MOBILE_UA.test(userAgent)) return "low";
  if (CAPABLE_GPU.test(renderer)) return devicePixelRatio > 2 ? "medium" : "high";
  return devicePixelRatio <= 1.5 ? "medium" : "low";
}

export function readGpuRenderer(gl) {
  const context = gl?.getContext?.();
  if (!context) return "";
  const info = context.getExtension("WEBGL_debug_renderer_info");
  return String(context.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : context.RENDERER) ?? "");
}

// localStorage는 사생활 보호 모드 등에서 예외를 던질 수 있다. 저장을 못 해도 이번 세션의 선택은 유지된다.
export function readStoredQuality(storage) {
  try {
    return parseQuality(storage?.getItem(QUALITY_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredQuality(storage, tier) {
  try {
    storage?.setItem(QUALITY_STORAGE_KEY, tier);
    return true;
  } catch {
    return false;
  }
}

// ?quality=low|medium|high가 가장 우선이고(저장하지 않는 일회성 지정), 다음이 저장된 선택이다.
// 둘 다 없으면 null: 캔버스가 만들어진 뒤 GPU 이름으로 pickDefaultQuality를 적용한다.
export function resolveInitialQuality({ search = "", storage } = {}) {
  const fromUrl = parseQuality(new URLSearchParams(search).get("quality"));
  if (fromUrl) return { tier: fromUrl, source: "url" };
  const stored = readStoredQuality(storage);
  if (stored) return { tier: stored, source: "stored" };
  return { tier: null, source: "auto" };
}

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function useQualityPreset() {
  const [state, setState] = useState(() => resolveInitialQuality({
    search: globalThis.location?.search ?? "",
    storage: browserStorage(),
  }));

  const setQuality = useCallback((tier) => {
    const next = parseQuality(tier);
    if (!next) return;
    writeStoredQuality(browserStorage(), next);
    setState({ tier: next, source: "stored" });
  }, []);

  // 캔버스 생성 직후 한 번 호출된다. 사용자가 고른 값이나 URL 지정이 있으면 건드리지 않는다.
  const applyDetectedDefault = useCallback((gl) => {
    setState((current) => {
      if (current.tier) return current;
      const tier = pickDefaultQuality({
        renderer: readGpuRenderer(gl),
        devicePixelRatio: globalThis.devicePixelRatio ?? 1,
        userAgent: globalThis.navigator?.userAgent ?? "",
      });
      return { tier, source: "auto" };
    });
  }, []);

  return { quality: state.tier ?? "low", qualitySource: state.source, setQuality, applyDetectedDefault };
}

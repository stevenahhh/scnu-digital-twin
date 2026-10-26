import { useCallback, useState } from "react";
import { INTERACTION_DPR_FACTOR } from "../render/interactionDpr.mjs";

// 3D 캠퍼스 렌더링 품질 단계.
// - low: 지금까지의 렌더러 그대로(후처리 없음). 후처리 청크도 받지 않는다.
// - medium: SMAA(+ 선택 건물 외곽선).
// - high: SMAA + 밤의 창문·가로등에만 은은한 bloom(+ 선택 건물 외곽선).
// 화면 공간 AO(N8AO)처럼 깊이 버퍼를 따라 광선을 진행하는 패스는 어느 단계에도 없다. 접촉 그늘은 모든 단계에서
// GLB에 구워 둔 AO 아틀라스(ao-buildings·ao-ground, 추정 시뮬레이션 값)가 맡는다.
// 톤 매핑은 모든 단계에서 Neutral이다(후처리 단계에서는 컴포저의 ToneMapping 효과가 맡는다).
// 단계마다 렌더러 비용도 정한다(QUALITY_RENDERER): 캔버스 픽셀 비율 상한과 태양 그림자 맵(캐스케이드) 구성.
export const QUALITY_TIERS = Object.freeze(["low", "medium", "high"]);
export const QUALITY_LABELS = Object.freeze({ low: "낮음", medium: "보통", high: "높음" });
export const QUALITY_STORAGE_KEY = "scnu.renderQuality";

export function parseQuality(value) {
  return QUALITY_TIERS.includes(value) ? value : null;
}

// 후처리 단계별 설정. low는 null이라 효과 청크를 아예 마운트하지 않는다.
export const QUALITY_EFFECTS = Object.freeze({
  low: null,
  medium: Object.freeze({ bloom: false }),
  high: Object.freeze({ bloom: true }),
});

// 단계별 렌더러 비용. maxDpr은 캔버스 픽셀 비율 상한(조작 중 DPR 낮추기는 이 상한 위에서 다시 0.75배)이다.
// shadowMapSizes는 태양 그림자 맵 한 변의 텍셀 수를 가는 것부터 적는다(기기 한도·모바일 1024 상한은 CampusLighting이 씌운다).
// - low: 캠퍼스 전체를 덮는 정적 맵 한 장. 모델이 들어올 때와 태양이 움직인 뒤에만 다시 굽는다.
// - medium: 캐스케이드 2단. 카메라 절두체에 맞춘 한 장 + 캠퍼스 전체 한 장.
// - high: 캐스케이드 3단. 절두체에 맞춘 두 장 + 캠퍼스 전체 4096² 한 장(조감 시점은 이전 high와 같은 해상도).
// 멀리서 본 시점처럼 절두체 조각이 캠퍼스만큼 커져 캠퍼스 맵보다 거칠어지는 캐스케이드는 쉬게 한다(SunCascades).
// 캐스케이드는 태양이 움직이거나(1분 단위) 카메라가 맞춘 범위를 벗어날 때만 다시 그리고, 멈춘 화면에서는 그리지 않는다.
// 메모리(깊이 4바이트/텍셀, 추정): low 4 MB, medium 32 MB(이전과 같음), high 96 MB(이전 단일 4096² 64 MB). 모바일은 장당 4 MB.
export const QUALITY_RENDERER = Object.freeze({
  low: Object.freeze({ maxDpr: 1, shadowMapSizes: Object.freeze([1024]) }),
  medium: Object.freeze({ maxDpr: 1.5, shadowMapSizes: Object.freeze([2048, 2048]) }),
  high: Object.freeze({ maxDpr: 2, shadowMapSizes: Object.freeze([2048, 2048, 4096]) }),
});

// useInteractionDpr의 dpr(평소 [min, max], 조작 중에는 기준 비율 x factor인 숫자)에 단계 상한을 씌운다.
// 조작 중 값은 기준 비율을 되살려 상한으로 자른 뒤 다시 factor를 곱하므로, 상한 1에서도 드래그하면 0.75로 내려간다.
export function capCanvasDpr(dpr, maxDpr) {
  if (Array.isArray(dpr)) return [Math.min(dpr[0], maxDpr), Math.min(dpr[1], maxDpr)];
  return Math.min(dpr / INTERACTION_DPR_FACTOR, maxDpr) * INTERACTION_DPR_FACTOR;
}

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

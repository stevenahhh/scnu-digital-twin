import { useCallback, useEffect, useMemo } from "react";
import { useDemandLoop } from "./useDemandLoop.mjs";
import { attachCanvasLifecycle } from "./canvasLifecycle.mjs";
import { useLiveTraffic } from "./useLiveTraffic";
import { QUALITY_RENDERER, capCanvasDpr, useQualityPreset } from "../settings/qualityPreset.mjs";
import { FLY_DURATION_MS } from "../camera/cameraPresets.mjs";
import { SETTLE_MS } from "../labels/motionSettle.mjs";

// 선택 뒤에는 클릭 포커스 비행(useFlyTo, FLY_DURATION_MS)과 정착 시간만큼 루프를 always로 돌린다. 재질 색 전환은 스스로 invalidate한다.
// 교통 시뮬레이션이 멈춘 뒤에는 보간이 끝날 때까지, 패널을 여닫은 뒤에는 전환이 끝난 화면으로 라벨 가림을 다시 판정할 때까지.
const SELECTION_ANIMATION_MS = FLY_DURATION_MS + SETTLE_MS;
const TRAFFIC_SETTLE_MS = 1500;
const PANEL_TRANSITION_MS = 450;

// Legacy 3D Canvas의 그리기 정책: demand 루프, 조작 중 DPR 낮추기, 품질 단계, Canvas 생성 뒤 처리.
// selectionKey·panelKey가 바뀌면 전환 애니메이션이 끝날 때까지 루프를 잠시 계속 돌린다.
// canvasStateRef는 생성된 R3F 상태를 담는다(카메라 비행이 장면을 읽는다). interactionDpr은 useInteractionDpr()의 값이다.
export function useCampusRendering({ canvasStateRef, interactionDpr, modalOpen, selectionKey, panelKey }) {
  const liveTraffic = useLiveTraffic();
  const { frameloop, animateFor } = useDemandLoop({ modalOpen, liveTraffic });
  const { quality, qualitySource, setQuality, applyDetectedDefault } = useQualityPreset();
  const renderer = QUALITY_RENDERER[quality];
  const dpr = useMemo(() => capCanvasDpr(interactionDpr.dpr, renderer.maxDpr), [interactionDpr.dpr, renderer.maxDpr]);

  useEffect(() => {
    animateFor(SELECTION_ANIMATION_MS);
  }, [animateFor, selectionKey]);
  useEffect(() => {
    if (!liveTraffic) animateFor(TRAFFIC_SETTLE_MS);
  }, [animateFor, liveTraffic]);
  useEffect(() => {
    animateFor(PANEL_TRANSITION_MS);
  }, [animateFor, panelKey]);

  const onCreated = useCallback((state) => {
    canvasStateRef.current = state;
    attachCanvasLifecycle(state);
    applyDetectedDefault(state.gl);
  }, [applyDetectedDefault, canvasStateRef]);

  return { frameloop, dpr, onCreated, quality, qualitySource, setQuality, renderer };
}

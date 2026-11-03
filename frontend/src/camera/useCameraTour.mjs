import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CAMERA_PRESETS, TOUR_INTERVAL_MS, findCameraPreset, nextPresetId } from "./cameraPresets.mjs";

// 투어: 켜면 바로 다음 시점으로 가고, intervalMs마다 한 칸씩 돈다. 사용자 조작으로 멈추는 것은 호출 쪽이
// stopTour로 처리한다(OrbitControls start 중 비행 표식이 없는 것).
export function useCameraTour({ presets = CAMERA_PRESETS, activeId, goToPreset, intervalMs = TOUR_INTERVAL_MS }) {
  const [touring, setTouring] = useState(false);
  const activeIdRef = useRef(activeId);

  useLayoutEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (!touring) return undefined;
    const step = () => {
      const preset = findCameraPreset(nextPresetId(activeIdRef.current, presets), presets);
      if (preset) goToPreset(preset);
    };
    step();
    const timer = setInterval(step, intervalMs);
    return () => clearInterval(timer);
  }, [goToPreset, intervalMs, presets, touring]);

  const stopTour = useCallback(() => setTouring(false), []);
  const toggleTour = useCallback(() => setTouring((value) => !value), []);

  return { touring, toggleTour, stopTour };
}

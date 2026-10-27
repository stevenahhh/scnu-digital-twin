import { useCallback, useState } from "react";
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { useCameraTour } from "../camera/useCameraTour.mjs";

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

// VWorld 지도의 시점 버튼·투어: Legacy useCampusCamera와 같은 규칙(누른 시점 표시, 투어, 사용자가 지도를 끌면 둘 다 멈춤).
// campusCamera는 VWorldRenderer가 넘기는 createVWorldCampusCamera 결과다(오버레이·GLB가 준비되기 전에는 null).
export function useVWorldCampusCamera(campusCamera) {
  const [activePresetId, setActivePresetId] = useState(null);
  const goToPreset = useCallback((preset) => {
    if (campusCamera?.flyTo(preset, { reducedMotion: reducedMotion() })) setActivePresetId(preset.id);
  }, [campusCamera]);
  const { touring, toggleTour, stopTour } = useCameraTour({ presets: CAMERA_PRESETS, activeId: activePresetId, goToPreset });
  const selectPreset = useCallback((preset) => {
    stopTour();
    goToPreset(preset);
  }, [goToPreset, stopTour]);
  const handleUserCameraStart = useCallback(() => {
    stopTour();
    setActivePresetId(null);
  }, [stopTour]);
  return { ready: Boolean(campusCamera), activePresetId, selectPreset, touring, toggleTour, stopTour, handleUserCameraStart };
}

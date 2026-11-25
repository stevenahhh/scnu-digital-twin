import { useCallback, useState } from "react";
import { CAMERA_PRESETS, OVERVIEW_PRESET_ID } from "../camera/cameraPresets.mjs";
import { useCameraTour } from "../camera/useCameraTour.mjs";

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

// VWorld 지도의 시점 버튼·투어: Main useCampusCamera와 같은 규칙(누른 시점 표시, 투어, 사용자가 지도를 끌면 둘 다 멈춤).
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
  // 카메라 단추: 확대·회전은 사용자가 지도를 움직인 것과 같다(투어와 누른 시점 표시를 멈춤). 처음 시점은 전체 시점이다.
  const zoomBy = useCallback((factor) => {
    handleUserCameraStart();
    campusCamera?.zoomBy(factor);
  }, [campusCamera, handleUserCameraStart]);
  const rotateBy = useCallback((angle) => {
    handleUserCameraStart();
    campusCamera?.rotateBy(angle);
  }, [campusCamera, handleUserCameraStart]);
  const goHome = useCallback(() => selectPreset(CAMERA_PRESETS.find((preset) => preset.id === OVERVIEW_PRESET_ID)), [selectPreset]);
  return { ready: Boolean(campusCamera), activePresetId, selectPreset, touring, toggleTour, stopTour, handleUserCameraStart, zoomBy, rotateBy, goHome };
}

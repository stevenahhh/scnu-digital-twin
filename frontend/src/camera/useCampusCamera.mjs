import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_PRESETS, OVERVIEW_PRESET_ID } from "./cameraPresets.mjs";
import { isFlyToEvent, useFlyTo } from "./useFlyTo.mjs";
import { useCameraTour } from "./useCameraTour.mjs";

// Legacy 3D 캠퍼스의 시점 버튼·투어·궤도 조작. 눌린 시점(activePresetId)은 사용자가 직접 궤도 조작을 시작하면 지운다.
// activePresetRef는 "카메라가 시점 버튼으로 간 자리에 있는가"를 렌더 없이 읽어야 하는 근접 판정용이다.
export function useCampusCamera({ controlsRef, getScene, onOrbitStart, onOrbitEnd }) {
  const [activePresetId, setActivePresetId] = useState(OVERVIEW_PRESET_ID);
  const activePresetRef = useRef(activePresetId);
  const { flyTo } = useFlyTo({ controlsRef, getScene });

  useEffect(() => {
    activePresetRef.current = activePresetId;
  }, [activePresetId]);

  const goToPreset = useCallback((preset) => {
    if (!flyTo(preset)) return;
    setActivePresetId(preset.id);
  }, [flyTo]);
  const { touring, toggleTour, stopTour } = useCameraTour({ presets: CAMERA_PRESETS, activeId: activePresetId, goToPreset });

  const selectPreset = useCallback((preset) => {
    stopTour();
    goToPreset(preset);
  }, [goToPreset, stopTour]);

  // 시점 비행이 보낸 start는 사용자 조작이 아니므로 투어와 눌린 표시를 그대로 둔다.
  const handleOrbitStart = useCallback((event) => {
    onOrbitStart();
    if (isFlyToEvent(event)) return;
    stopTour();
    setActivePresetId(null);
  }, [onOrbitStart, stopTour]);

  return {
    activePresetId, activePresetRef, selectPreset, touring, toggleTour, stopTour,
    handleOrbitStart, handleOrbitEnd: onOrbitEnd,
  };
}

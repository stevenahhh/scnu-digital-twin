import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_PRESETS, D4_CAMERA_OFFSET, OVERVIEW_PRESET_ID } from "./cameraPresets.mjs";

const OVERVIEW_PRESET = CAMERA_PRESETS.find((preset) => preset.id === OVERVIEW_PRESET_ID);
import { isFlyToEvent, useFlyTo } from "./useFlyTo.mjs";
import { isCameraStepEvent } from "./cameraCommands.mjs";
import { useCameraTour } from "./useCameraTour.mjs";

// Main 3D 캠퍼스의 시점 버튼·투어·궤도 조작. 눌린 시점(activePresetId)은 사용자가 직접 궤도 조작을 시작하면 지운다.
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

  // 검색으로 고른 건물로 날아간다(D4 시점과 같은 거리). 장면에서 그 노드를 못 찾으면 전체 시점 좌표를 쓴다.
  const flyToBuilding = useCallback((elementId) => {
    stopTour();
    const preset = { id: `building:${elementId}`, focus: [elementId], offset: D4_CAMERA_OFFSET, position: OVERVIEW_PRESET.position, target: OVERVIEW_PRESET.target };
    if (flyTo(preset)) setActivePresetId(null);
  }, [flyTo, stopTour]);

  // 처음 시점(카메라 단추·H 키): 전체 시점으로 돌아간다.
  const goHome = useCallback(() => selectPreset(OVERVIEW_PRESET), [selectPreset]);

  // 시점 비행이 보낸 start는 사용자 조작이 아니므로 투어와 눌린 표시를 그대로 둔다. 단추·키 한 단계 이동은 해상도를 낮추지 않는다
  // (연속 제스처와 비행만 낮춘다). 카메라가 시점에서 벗어나므로 눌린 표시와 투어는 풀린다.
  const handleOrbitStart = useCallback((event) => {
    if (!isCameraStepEvent(event)) onOrbitStart();
    if (isFlyToEvent(event)) return;
    stopTour();
    setActivePresetId(null);
  }, [onOrbitStart, stopTour]);
  const handleOrbitEnd = useCallback((event) => {
    if (!isCameraStepEvent(event)) onOrbitEnd();
  }, [onOrbitEnd]);

  return {
    controlsRef, activePresetId, activePresetRef, selectPreset, goHome, flyToBuilding, touring, toggleTour, stopTour,
    handleOrbitStart, handleOrbitEnd,
  };
}

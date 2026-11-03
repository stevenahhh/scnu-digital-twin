import commonElements from "../../../common/data/common_elemetns.json";
import { applyMove } from "../camera/cameraCommands.mjs";
import { parseSceneDate } from "../components/timeControl.mjs";
import { useUrlState } from "../state/useUrlState.mjs";

const KNOWN_IDS = commonElements.elements.map((element) => element.element_id);
const NAMES = new Map(commonElements.elements.map((element) => [element.element_id, element.name]));

// 주소의 건물 id로 고르기 대상({ elementId, buildingId, displayName })을 만든다(VWorld의 선택 경로용).
export const urlSelectionTarget = (elementId) => ({ elementId, buildingId: elementId.slice("BLD_".length), displayName: NAMES.get(elementId) ?? elementId });
const toArray = (vector) => [vector.x, vector.y, vector.z];

// 두 대시보드의 공유 링크: 건물, 장면 날짜·시각·모드, 패널 열림, 탭, 그리고 카메라 시점(Legacy는 controlsRef,
// VWorld는 cameraPose { get(), apply(pose) }: 같은 Legacy 장면 좌표).
// building은 지금 고른 요소 id(Legacy는 D4 패인이면 BLD_D4), onBuilding(id)은 주소의 건물을 평소 길로 고른다.
export function useDashboardUrlState({ building, onBuilding, clock, panelState, activeTab, setActiveTab, controlsRef = null, cameraPose = null }) {
  useUrlState({
    knownIds: KNOWN_IDS,
    state: {
      building: building?.startsWith?.("BLD_") ? building : null,
      minute: clock.sceneMinuteOfDay,
      date: clock.sceneDate,
      mode: clock.mode,
      panelOpen: panelState.open,
      tab: activeTab,
    },
    apply: {
      building: onBuilding,
      minute: clock.setSceneMinuteOfDay,
      date: (text) => {
        const parts = parseSceneDate(text);
        if (parts) clock.setSceneDate(parts);
      },
      mode: clock.setMode,
      panelOpen: panelState.setUserOpen,
      tab: setActiveTab,
      camera: controlsRef ? (pose) => applyMove(controlsRef.current, pose) : cameraPose ? cameraPose.apply : undefined,
    },
    getCamera: controlsRef ? () => {
      const controls = controlsRef.current;
      return controls?.object ? { position: toArray(controls.object.position), target: toArray(controls.target) } : null;
    } : cameraPose ? cameraPose.get : null,
  });
}

import { useMemo } from "react";

// 선택된 건물(라벨 앵커 id)의 메시. CityModel이 메시마다 userData.selectableElementId를 남기고, 선택 대리 프리즘(BLD_SCNU_*)은
// 노드 이름이 곧 앵커 id다. 보통·높음 단계의 외곽선(Outline)이 이 목록을 쓴다.
export function collectSelectedMeshes(scene, elementId) {
  if (!scene || !elementId) return [];
  const meshes = [];
  scene.traverse((object) => {
    if (!object.isMesh) return;
    if (object.userData?.selectableElementId === elementId || (object.userData?.pickProxy && object.name === elementId)) {
      meshes.push(object);
    }
  });
  return meshes;
}

export function useSelectedMeshes(scene, elementId) {
  return useMemo(() => collectSelectedMeshes(scene, elementId), [scene, elementId]);
}

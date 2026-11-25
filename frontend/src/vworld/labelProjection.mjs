import { CAMPUS_GLTF_OVERLAY_CONFIG } from "./campusGltfOverlay.mjs";

// VWorld(Cesium) 카메라로 라벨 앵커를 화면에 투영해 CampusLabelLayer의 frame.points를 만든다.
// 앵커는 campus-buildings.glb 장면 좌표(Y 위)다. Cesium은 glTF를 Y-up -> Z-up, Z-up -> X-up으로 돌려 읽으므로 모델 지역 좌표는
// (glTF z, x, y)이고(campusGltfOverlay의 D4 기준점과 같은 축), 지도 위치는 오버레이의 modelMatrix가 정한다.
// 모델 한 단위는 modelScale(1.602) m다. 거리를 장면 단위로 바꿔 Main와 같은 줌 단계(labelBands) 문턱을 그대로 쓴다.

export const VWORLD_SCENE_UNITS_PER_METRE = 1 / CAMPUS_GLTF_OVERLAY_CONFIG.modelScale.east;
const MIN_VIEW_SINE = Math.sin((5 * Math.PI) / 180);

export function sceneToModelLocal([x, y, z]) {
  return [z, x, y];
}

// getModelMatrix: 지금 오버레이의 modelMatrix(지형 높이로 다시 맞추면 바뀐다)를 돌려주는 함수.
export function createVWorldLabelProjector({ Cesium, scene, getModelMatrix }) {
  const worldOf = (position, matrix) => {
    const [lx, ly, lz] = sceneToModelLocal(position);
    return Cesium.Matrix4.multiplyByPoint(matrix, new Cesium.Cartesian3(lx, ly, lz), new Cesium.Cartesian3());
  };

  // 화면 가운데가 보는 땅까지의 거리(장면 단위)와 내려다보는 각도(도). Main의 궤도 목표점 거리·피치에 해당한다.
  const view = (matrix) => {
    const camera = scene.camera;
    const ground = Cesium.Cartographic.fromCartesian(Cesium.Matrix4.getTranslation(matrix, new Cesium.Cartesian3()));
    const height = Math.max(1, camera.positionCartographic.height - (ground?.height ?? 0));
    const pitchDegrees = (-camera.pitch * 180) / Math.PI;
    const sine = Math.max(MIN_VIEW_SINE, Math.sin(-camera.pitch));
    return { distance: (height / sine) * VWORLD_SCENE_UNITS_PER_METRE, pitchDegrees };
  };

  // entries: 레지스트리 항목(position = 장면 좌표). area: 지도 캔버스의 화면 사각형.
  // keepId: 화면 밖이어도 남길 항목(선택된 건물). 카메라 뒤, 투영이 안 되는 앵커는 뺀다.
  // clip=false(카메라가 움직이는 동안)면 화면 밖·패널 밑 앵커도 남긴다(보이던 칩이 밖으로 미끄러져 나가게, Main와 같다).
  const project = (entries, area, { keepId = null, occluder = null, clip = true } = {}) => {
    const matrix = getModelMatrix();
    const points = new Map();
    if (!matrix) return { points, ...view(Cesium.Matrix4.IDENTITY) };
    const camera = scene.camera;
    const eye = camera.positionWC;
    const forward = camera.directionWC;
    const scratch = new Cesium.Cartesian3();
    for (const entry of entries) {
      if (!entry.position) continue;
      const world = worldOf(entry.position, matrix);
      const toAnchor = Cesium.Cartesian3.subtract(world, eye, scratch);
      if (Cesium.Cartesian3.dot(toAnchor, forward) <= 0) continue;
      const window = Cesium.SceneTransforms.wgs84ToWindowCoordinates(scene, world);
      if (!window || !Number.isFinite(window.x) || !Number.isFinite(window.y)) continue;
      const x = area.left + window.x;
      const y = area.top + window.y;
      if (clip && entry.elementId !== keepId) {
        const outside = x < area.left || x > area.right || y < area.top || y > area.bottom;
        const underPanel = occluder && x >= occluder.left && x <= occluder.right && y >= occluder.top && y <= occluder.bottom;
        if (outside || underPanel) continue;
      }
      const depth = Cesium.Cartesian3.distance(eye, world) * VWORLD_SCENE_UNITS_PER_METRE;
      points.set(entry.elementId, { x, y, depth, distance: depth });
    }
    return { points, ...view(matrix) };
  };

  // 앵커의 경도·위도(도). 칩으로 고른 건물로 카메라를 옮길 때 쓴다.
  const lonLatOf = (position) => {
    const matrix = getModelMatrix();
    if (!matrix || !position) return null;
    const cartographic = Cesium.Cartographic.fromCartesian(worldOf(position, matrix));
    if (!cartographic) return null;
    return { longitude: (cartographic.longitude * 180) / Math.PI, latitude: (cartographic.latitude * 180) / Math.PI };
  };

  return { project, lonLatOf };
}

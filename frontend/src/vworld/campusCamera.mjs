import { FLY_DURATION_MS, resolveCameraPreset } from "../camera/cameraPresets.mjs";
import { sceneToModelLocal } from "./labelProjection.mjs";
import { TILT_LIMITS } from "../camera/cameraCommands.mjs";

// Legacy 카메라 시점(cameraPresets.mjs, 재중심화한 장면 좌표)을 VWorld(Cesium) 카메라로 옮긴다.
// 장면 좌표 + 캠퍼스 중심(D4 앵커로 구한 재중심화 값) = campus-buildings.glb 모델 좌표 -> 모델 지역 좌표(glTF z, x, y)
// -> 오버레이 modelMatrix -> 지구 고정 좌표. focus 시점은 GLB 노드 경계 상자로 다시 풀고, 나머지는 Legacy와 같은 고정 좌표다.

// GLTFLoader가 노드 이름에서 지우는 글자(PropertyBinding.sanitizeNodeName): 공백은 _로, [ ] . : / 는 뺀다.
export function runtimeNodeName(name) {
  return String(name).replace(/\s/g, "_").replace(/[[\].:/]/g, "");
}

// boxes: Map(런타임 노드 이름 -> [min, max], 모델 좌표). center: { x, z }(재중심화 값).
export function sceneLookups({ boxes, center }) {
  const boundsOf = (name) => {
    const box = boxes.get(name);
    if (!box) return null;
    const [min, max] = box;
    return { min: [min[0] - center.x, min[1], min[2] - center.z], max: [max[0] - center.x, max[1], max[2] - center.z] };
  };
  return { boundsOf };
}

export function createVWorldCampusCamera({ Cesium, scene, getModelMatrix, boxes, center }) {
  const lookups = sceneLookups({ boxes, center });
  const toWorld = ([x, y, z], matrix) => {
    const [lx, ly, lz] = sceneToModelLocal([x + center.x, y, z + center.z]);
    return Cesium.Matrix4.multiplyByPoint(matrix, new Cesium.Cartesian3(lx, ly, lz), new Cesium.Cartesian3());
  };

  // 시점 하나의 지구 고정 좌표 카메라: 위치, 보는 방향, 위쪽(그 자리 지표면 법선을 방향에 수직으로 맞춘 것).
  const viewOf = (preset) => {
    const matrix = getModelMatrix();
    if (!matrix) return null;
    const { position, target } = resolveCameraPreset(preset, lookups);
    const destination = toWorld(position, matrix);
    const look = toWorld(target, matrix);
    const direction = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(look, destination, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(destination, new Cesium.Cartesian3());
    const along = Cesium.Cartesian3.multiplyByScalar(direction, Cesium.Cartesian3.dot(normal, direction), new Cesium.Cartesian3());
    const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(normal, along, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    return { destination, orientation: { direction, up } };
  };

  // 비행이 끝나면 onFinish. 움직임 줄이기에서는 바로 옮긴다. 시점을 못 풀면(오버레이 전) false.
  const flyTo = (preset, { onFinish, reducedMotion = false } = {}) => {
    const view = viewOf(preset);
    if (!view) return false;
    if (reducedMotion) {
      scene.camera.setView(view);
      onFinish?.();
    } else {
      scene.camera.flyTo({ ...view, duration: FLY_DURATION_MS / 1000, complete: onFinish });
    }
    scene.requestRender?.();
    return true;
  };

  // 화면 가운데 지표점: 확대·회전의 중심(Legacy OrbitControls의 target에 해당). 지형을 못 집으면 타원체로.
  const viewCenter = () => {
    const canvas = scene.canvas;
    const middle = new Cesium.Cartesian2((canvas?.clientWidth ?? 0) / 2, (canvas?.clientHeight ?? 0) / 2);
    const ray = scene.camera.getPickRay?.(middle);
    return (ray && scene.globe?.pick?.(ray, scene)) ?? scene.camera.pickEllipsoid?.(middle) ?? null;
  };

  // 카메라 단추(Legacy CameraControls와 같은 단계): factor < 1이면 가운데 지표점으로 그만큼 다가가고, > 1이면 물러난다.
  const zoomBy = (factor) => {
    const pivot = viewCenter();
    if (!pivot) return false;
    const distance = Cesium.Cartesian3.distance(scene.camera.positionWC, pivot);
    // 휠 확대와 같은 범위(cameraLimits.mjs) 안에 머문다. 트랙패드 핀치는 이 길로 연속해서 들어온다.
    const controller = scene.screenSpaceCameraController;
    const next = Math.min(controller?.maximumZoomDistance ?? Infinity, Math.max(controller?.minimumZoomDistance ?? 0, distance * factor));
    scene.camera.moveForward(distance - next);
    scene.requestRender?.();
    return true;
  };

  // 기울이기(Legacy tiltBy와 같은 뜻): 가운데 지표점에서 본 카메라의 극각(그 자리 법선과 이루는 각)을 angle만큼 늘린다.
  // 양수면 지평선 쪽으로 눕는다. 극각은 Legacy OrbitControls의 범위(TILT_LIMITS) 안에 머문다.
  const tiltBy = (angle) => {
    const pivot = viewCenter();
    if (!pivot) return false;
    const camera = scene.camera;
    const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(pivot, new Cesium.Cartesian3());
    const offset = { x: camera.positionWC.x - pivot.x, y: camera.positionWC.y - pivot.y, z: camera.positionWC.z - pivot.z };
    const distance = Math.hypot(offset.x, offset.y, offset.z);
    const cross = { x: normal.y * offset.z - normal.z * offset.y, y: normal.z * offset.x - normal.x * offset.z, z: normal.x * offset.y - normal.y * offset.x };
    const crossLength = Math.hypot(cross.x, cross.y, cross.z);
    if (distance === 0 || crossLength === 0) return false;
    const polar = Math.acos(Math.min(1, Math.max(-1, (normal.x * offset.x + normal.y * offset.y + normal.z * offset.z) / distance)));
    const next = Math.min(TILT_LIMITS.maxPolarAngle, Math.max(TILT_LIMITS.minPolarAngle, polar + angle));
    const axis = { x: cross.x / crossLength, y: cross.y / crossLength, z: cross.z / crossLength };
    const turn = (v) => rotateAbout(v, axis, next - polar);
    const moved = turn(offset);
    const direction = turn(camera.directionWC);
    const up = turn(camera.upWC);
    camera.setView({
      destination: new Cesium.Cartesian3(pivot.x + moved.x, pivot.y + moved.y, pivot.z + moved.z),
      orientation: { direction: new Cesium.Cartesian3(direction.x, direction.y, direction.z), up: new Cesium.Cartesian3(up.x, up.y, up.z) },
    });
    scene.requestRender?.();
    return true;
  };

  // 가운데 지표점을 지나는 그 자리 법선을 축으로 카메라를 돌린다(양수 = 위에서 보아 반시계).
  const rotateBy = (angle) => {
    const pivot = viewCenter();
    if (!pivot) return false;
    const axis = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(pivot, new Cesium.Cartesian3());
    const turn = (v) => rotateAbout(v, axis, angle);
    const camera = scene.camera;
    const offset = turn({ x: camera.positionWC.x - pivot.x, y: camera.positionWC.y - pivot.y, z: camera.positionWC.z - pivot.z });
    const destination = new Cesium.Cartesian3(pivot.x + offset.x, pivot.y + offset.y, pivot.z + offset.z);
    const direction = turn(camera.directionWC);
    const up = turn(camera.upWC);
    camera.setView({
      destination,
      orientation: { direction: new Cesium.Cartesian3(direction.x, direction.y, direction.z), up: new Cesium.Cartesian3(up.x, up.y, up.z) },
    });
    scene.requestRender?.();
    return true;
  };

  // 방향키(Legacy OrbitControls처럼 땅 위로 옮기기): right·forward는 화면 가운데까지 거리에 대한 비율. 높이와 보는 방향은 그대로.
  const panBy = (right, forward) => {
    const pivot = viewCenter();
    if (!pivot) return false;
    const camera = scene.camera;
    const distance = Cesium.Cartesian3.distance(camera.positionWC, pivot);
    const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(pivot, new Cesium.Cartesian3());
    const flat = (v) => {
      const along = Cesium.Cartesian3.dot(v, up);
      const x = v.x - up.x * along; const y = v.y - up.y * along; const z = v.z - up.z * along;
      const length = Math.hypot(x, y, z) || 1;
      return { x: x / length, y: y / length, z: z / length };
    };
    const r = flat(camera.rightWC);
    const f = flat(camera.directionWC);
    const step = { x: (r.x * right + f.x * forward) * distance, y: (r.y * right + f.y * forward) * distance, z: (r.z * right + f.z * forward) * distance };
    camera.setView({
      destination: new Cesium.Cartesian3(camera.positionWC.x + step.x, camera.positionWC.y + step.y, camera.positionWC.z + step.z),
      orientation: { direction: camera.directionWC, up: camera.upWC },
    });
    scene.requestRender?.();
    return true;
  };

  // 지구 고정 좌표 -> Legacy 장면 좌표(toWorld의 역). 공유 링크의 cam=이 두 대시보드에서 같은 뜻이 된다.
  const toScene = (world, matrix) => {
    const inverse = Cesium.Matrix4.inverse(matrix, new Cesium.Matrix4());
    const local = Cesium.Matrix4.multiplyByPoint(inverse, world, new Cesium.Cartesian3());
    return [local.y - center.x, local.z, local.x - center.z];
  };
  // 지금 시점(Legacy 장면 좌표의 카메라 위치와 화면 가운데 지표점). 오버레이 전이나 가운데에 땅이 없으면 null.
  const poseOf = () => {
    const matrix = getModelMatrix();
    const pivot = matrix ? viewCenter() : null;
    if (!pivot) return null;
    return { position: toScene(scene.camera.positionWC, matrix), target: toScene(pivot, matrix) };
  };
  // 공유 링크의 시점을 비행 없이 놓는다. 오버레이 전이면 false(호출하는 쪽이 다시 시도한다).
  const applyPose = (pose) => {
    const view = viewOf({ id: "url", position: pose.position, target: pose.target });
    if (!view) return false;
    scene.camera.setView(view);
    scene.requestRender?.();
    return true;
  };

  return { viewOf, flyTo, zoomBy, rotateBy, tiltBy, panBy, poseOf, applyPose };
}

// Rodrigues: v rotated by angle (radians) about the unit axis.
function rotateAbout(v, k, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = k.x * v.x + k.y * v.y + k.z * v.z;
  const cross = { x: k.y * v.z - k.z * v.y, y: k.z * v.x - k.x * v.z, z: k.x * v.y - k.y * v.x };
  return {
    x: v.x * cos + cross.x * sin + k.x * dot * (1 - cos),
    y: v.y * cos + cross.y * sin + k.y * dot * (1 - cos),
    z: v.z * cos + cross.z * sin + k.z * dot * (1 - cos),
  };
}

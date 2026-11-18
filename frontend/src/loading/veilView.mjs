import { CAMPUS_INITIAL_CAMERA } from "../camera/initialCamera.mjs";
import { campusModelCenter } from "../simulation/utils/campusTrafficCoordinates.mjs";
import { decodeViewState } from "../state/urlState.mjs";

// campus-v2.glb의 BLD_D4 상자 중심(모델 좌표). 모델이 오기 전에 장면 좌표를 계산하는 데 쓰고, campusModelAsset.test.mjs가 실제 파일과 맞는지 본다.
export const D4_MODEL_CENTRE = Object.freeze([46.186, 0, -266.597]);
const HORIZON_Y = -0.01;
const MIN_SCALE = 60;
const CORNERS = Object.freeze([[-1, -1], [1, -1], [-1, 1], [1, 1]]);

const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normal = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };

// 장면이 아직 없을 때의 시점: 주소에 담긴 카메라(장면이 뜨면 그 자리로 간다), 없으면 캠퍼스 첫 카메라.
export function initialPose(search) {
  return { ...CAMPUS_INITIAL_CAMERA, ...(decodeViewState(search).camera ?? {}) };
}

// 화면의 각 점으로 나가는 광선의 기준: 눈, 오른쪽·위·앞 단위 벡터, 화면 절반의 탄젠트.
export function viewFromPose({ position, target, fov }, aspect) {
  const forward = normal(sub(target, position));
  const right = normal(cross(forward, [0, 1, 0]));
  const tanY = Math.tan((fov * Math.PI) / 360);
  return { eye: [...position], right, up: cross(right, forward), forward, tanX: tanY * aspect, tanY };
}

// 같은 값을 살아 있는 three 카메라의 행렬에서 읽는다. 궤도 조작·비행·화면 비 변화가 그대로 들어온다.
export function viewFromCamera(camera) {
  camera.updateMatrixWorld();
  const m = camera.matrixWorld.elements;
  const p = camera.projectionMatrix.elements;
  return { eye: [m[12], m[13], m[14]], right: [m[0], m[1], m[2]], up: [m[4], m[5], m[6]], forward: [-m[8], -m[9], -m[10]], tanX: 1 / p[0], tanY: 1 / p[5] };
}

function groundHit(eye, dir, groundY) {
  if (dir[1] > HORIZON_Y) return null;
  const t = (groundY - eye[1]) / dir[1];
  return [eye[0] + dir[0] * t, eye[2] + dir[2] * t];
}

// 0(중심)에서 1(지평선)로 가는 거리. 셰이더의 radial()과 같은 식이다.
export const radialDistance = ({ centre, scale }, [x, z]) => 1 - Math.exp(-Math.hypot(x - centre[0], z - centre[1]) / scale);

// 파면과 걷힘의 기준: 시선이 땅에 닿는 점에서 시작하고, 화면 네 귀퉁이가 닿는 땅까지(maxR) 가야 화면이 다 덮인다.
export function revealFrame(view, groundY) {
  const { eye, forward, right, up, tanX, tanY } = view;
  const centre = groundHit(eye, forward, groundY) ?? [eye[0], eye[2]];
  const frame = { centre, scale: Math.max(MIN_SCALE, Math.hypot(centre[0] - eye[0], groundY - eye[1], centre[1] - eye[2])) };
  const reach = CORNERS.map(([x, y]) => {
    const hit = groundHit(eye, forward.map((v, i) => v + right[i] * x * tanX + up[i] * y * tanY), groundY);
    return hit ? radialDistance(frame, hit) : 1;
  });
  return { ...frame, maxR: Math.max(...reach) };
}

// 지형 격자의 (0, 0) 표본이 놓이는 장면 좌표 [x, z]. CityModel이 모델을 옮기는 것과 같은 규칙이다.
export function fieldOriginInScene(field) {
  const center = campusModelCenter(D4_MODEL_CENTRE, { frameVersion: 2 });
  return [field.originX - center.x, field.originZ - center.z];
}

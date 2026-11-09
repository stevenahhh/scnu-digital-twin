// 카메라 단추·키보드 조작의 순수 계산과, 그것을 OrbitControls에 적용하는 얇은 층.
// 위치·목표는 [x, y, z] 배열이다. 회전은 목표점을 지나는 세로축 둘레, 확대는 목표점까지 거리의 배율이다.
export const ORBIT_LIMITS = Object.freeze({ minDistance: 30, maxDistance: 520 });
export const ZOOM_STEP = 0.8;
export const ROTATE_STEP = Math.PI / 12;
export const PAN_STEP = 12;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const length = (a) => Math.hypot(a[0], a[1], a[2]);

// factor < 1이면 가까이, > 1이면 멀리. 거리는 OrbitControls의 한계 안에 머문다.
export function zoomPosition(position, target, factor, limits = ORBIT_LIMITS) {
  const offset = sub(position, target);
  const distance = length(offset);
  if (distance === 0) return [...position];
  const next = Math.min(limits.maxDistance, Math.max(limits.minDistance, distance * factor));
  return add(target, scale(offset, next / distance));
}

// radians만큼 위에서 볼 때 시계 반대 방향으로 돈다. 높이(y)는 그대로다.
export function rotatePosition(position, target, radians) {
  const [dx, dy, dz] = sub(position, target);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return add(target, [dx * cos + dz * sin, dy, -dx * sin + dz * cos]);
}

// 기울이기: 목표점에서 본 카메라의 극각(세로축과 이루는 각)을 radians만큼 늘린다(양수 = 지평선 쪽으로 눕기).
// 극각은 OrbitControls의 minPolarAngle..maxPolarAngle 안에 머물고, 거리와 방위는 그대로다.
export const TILT_LIMITS = Object.freeze({ minPolarAngle: Math.PI / 6, maxPolarAngle: Math.PI / 2.2 });
export function tiltPosition(position, target, radians, limits = TILT_LIMITS) {
  const [dx, dy, dz] = sub(position, target);
  const distance = Math.hypot(dx, dy, dz);
  if (distance === 0) return [...position];
  const flat = Math.hypot(dx, dz);
  const polar = Math.atan2(flat, dy);
  const next = Math.min(limits.maxPolarAngle, Math.max(limits.minPolarAngle, polar + radians));
  const azimuth = Math.atan2(dx, dz);
  return add(target, [distance * Math.sin(next) * Math.sin(azimuth), distance * Math.cos(next), distance * Math.sin(next) * Math.cos(azimuth)]);
}

// 화면 기준 옆(right)·앞(forward)으로 위치와 목표를 함께 옮긴다. 앞은 바닥에 투영한 시선 방향이다.
export function panPositions(position, target, right, forward) {
  const view = sub(target, position);
  const flat = Math.hypot(view[0], view[2]) || 1;
  const ahead = [view[0] / flat, 0, view[2] / flat];
  const side = [-ahead[2], 0, ahead[0]];
  const delta = add(scale(side, right), scale(ahead, forward));
  return { position: add(position, delta), target: add(target, delta) };
}

const toArray = (vector) => [vector.x, vector.y, vector.z];

// 앞선 드래그의 관성(감쇠로 남은 회전·이동)을 지운다. three의 OrbitControls는 감쇠를 끈 채 update하면 남은 양을 한 번에 쓰고
// 0으로 만든다. 시점 비행은 이것으로 시작해야 도착한 자리에 그대로 멈춘다(관성이 비행 뒤에도 카메라를 계속 돌리지 않는다).
export function clearOrbitInertia(controls) {
  if (!controls?.enableDamping) return false;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  return true;
}

// 단추·키 한 단계 이동이 보내는 start/end 표식. 눌린 시점 표시와 투어, 진행 중인 비행은 사용자 조작처럼 풀리지만,
// 한 번에 끝나는 이동이라 라벨 층 흐림과 조작 중 해상도 낮춤은 일어나지 않는다.
export const CAMERA_STEP_START_EVENT = Object.freeze({ type: "start", step: true });
export const CAMERA_STEP_END_EVENT = Object.freeze({ type: "end", step: true });
export const isCameraStepEvent = (event) => Boolean(event?.step);

// 한 번에 옮기는 이동. 공유 링크의 카메라도 이 길로 놓는다(비행 없음).
export function applyMove(controls, { position, target }) {
  if (!controls) return false;
  controls.dispatchEvent?.({ ...CAMERA_STEP_START_EVENT });
  controls.object.position.set(...position);
  if (target) controls.target.set(...target);
  controls.update();
  controls.dispatchEvent?.({ ...CAMERA_STEP_END_EVENT });
  return true;
}

export function zoomBy(controls, factor) {
  if (!controls) return false;
  return applyMove(controls, { position: zoomPosition(toArray(controls.object.position), toArray(controls.target), factor) });
}

export function rotateBy(controls, radians) {
  if (!controls) return false;
  return applyMove(controls, { position: rotatePosition(toArray(controls.object.position), toArray(controls.target), radians) });
}

export function tiltBy(controls, radians) {
  if (!controls) return false;
  const limits = {
    minPolarAngle: controls.minPolarAngle ?? TILT_LIMITS.minPolarAngle,
    maxPolarAngle: controls.maxPolarAngle ?? TILT_LIMITS.maxPolarAngle,
  };
  return applyMove(controls, { position: tiltPosition(toArray(controls.object.position), toArray(controls.target), radians, limits) });
}

// 손가락 비틀기처럼 OrbitControls가 이미 끌기 중일 때의 회전: start/end를 다시 보내지 않고 위치만 돌린다
// (끌기 도중 end를 보내면 끌기가 끝난 것으로 보고 해상도·클릭 판별이 흐트러진다).
export function rotateDuringDrag(controls, radians) {
  if (!controls) return false;
  controls.object.position.set(...rotatePosition(toArray(controls.object.position), toArray(controls.target), radians));
  controls.update();
  return true;
}

export function panBy(controls, right, forward) {
  if (!controls) return false;
  return applyMove(controls, panPositions(toArray(controls.object.position), toArray(controls.target), right, forward));
}

// 처음 시점: 전체 시점으로 날아간다(움직임 줄이기에서는 useFlyTo가 바로 옮긴다).
export function resetTo(selectPreset, overviewPreset) {
  selectPreset(overviewPreset);
}

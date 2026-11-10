// 캠퍼스 캔버스의 클릭/드래그 판별. 건물 메시(R3F pointerup)와 라벨 버튼(drei Html click)이 같은 기준을 쓴다.
// - 누른 곳에서 CLICK_MAX_DISTANCE_PX 넘게 움직였거나 CLICK_MAX_DURATION_MS보다 오래 누르면 드래그다.
// - 드래그로 끝난 놓기, 다른 곳(패널·라벨 등)에서 시작한 누르기, 두 손가락 핀치는 클릭이 아니다.
// - 카메라가 움직이는 동안(시점 비행, OrbitControls 감쇠, 클릭 포커스 비행)과 멈춘 뒤 CAMERA_SETTLE_MS 동안은
//   클릭을 받지 않는다. 움직이는 화면에서 누른 건물은 사용자가 겨눈 건물이 아닐 수 있다.
// - 드래그가 움직인 카메라(놓은 뒤 감쇠 포함)로는 근접 자동 열기와 마우스오버 강조를 하지 않는다.
// 키보드로 누른 라벨(click.detail === 0)은 포인터 제스처가 아니므로 항상 받는다.
import { SETTLE_MS } from "../labels/motionSettle.mjs";

export const CLICK_MAX_DISTANCE_PX = 6;
export const CLICK_MAX_DURATION_MS = 600;
// 정착 시간은 라벨 층·해상도 복원과 같은 값 하나(--motion-settle)를 쓴다.
export const CAMERA_SETTLE_MS = SETTLE_MS;
// pointerup 뒤 같은 제스처의 click이 이 시간 안에 와야 한다(그보다 늦은 click은 짝이 없는 것으로 본다).
export const RELEASE_MATCH_MS = 500;
// 프레임당 카메라 이동(장면 단위)과 회전(1 - |q·q'|)이 이보다 크면 "움직이는 중"이다.
export const CAMERA_MOVE_EPSILON = 0.02;
export const CAMERA_TURN_EPSILON = 1e-7;

export function isClickGesture(down, up, { maxDistance = CLICK_MAX_DISTANCE_PX, maxDuration = CLICK_MAX_DURATION_MS } = {}) {
  if (!down || !up) return false;
  const dx = up.x - down.x;
  const dy = up.y - down.y;
  return dx * dx + dy * dy <= maxDistance * maxDistance && up.time - down.time <= maxDuration;
}

// 직전 프레임과 비교해 카메라가 움직였는지. position은 {x,y,z}, quaternion은 {x,y,z,w}.
export function hasCameraMoved(previous, current, { moveEpsilon = CAMERA_MOVE_EPSILON, turnEpsilon = CAMERA_TURN_EPSILON } = {}) {
  if (!previous) return false;
  const dx = current.position.x - previous.position.x;
  const dy = current.position.y - previous.position.y;
  const dz = current.position.z - previous.position.z;
  if (dx * dx + dy * dy + dz * dz > moveEpsilon * moveEpsilon) return true;
  const a = previous.quaternion;
  const b = current.quaternion;
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 1 - Math.min(1, dot) > turnEpsilon;
}

export function createPointerGuard({
  now = () => performance.now(),
  maxDistance = CLICK_MAX_DISTANCE_PX,
  maxDuration = CLICK_MAX_DURATION_MS,
  settleMs = CAMERA_SETTLE_MS,
  releaseMatchMs = RELEASE_MATCH_MS,
} = {}) {
  let press = null; // { id, x, y, time, origin }
  let dragging = false;
  let release = null; // { id, time, click, origin }
  let cameraMovedAt = -Infinity;
  let dragCamera = false;

  const startDrag = () => {
    dragging = true;
    dragCamera = true;
  };

  return {
    pointerDown({ pointerId, clientX, clientY }, origin = "other") {
      if (press) {
        // 두 번째 손가락: 핀치/두 손가락 회전이므로 이 제스처 전체를 드래그로 본다.
        if (pointerId !== press.id) startDrag();
        return;
      }
      press = { id: pointerId, x: clientX, y: clientY, time: now(), origin };
      dragging = false;
      release = null;
    },
    pointerMove({ pointerId, clientX, clientY }) {
      if (!press || dragging || pointerId !== press.id) return;
      const dx = clientX - press.x;
      const dy = clientY - press.y;
      if (dx * dx + dy * dy > maxDistance * maxDistance) startDrag();
    },
    pointerUp({ pointerId, clientX, clientY }) {
      if (!press || pointerId !== press.id) return;
      const time = now();
      const click = !dragging && isClickGesture(press, { x: clientX, y: clientY, time }, { maxDistance, maxDuration });
      release = { id: pointerId, time, click, origin: press.origin };
      press = null;
      dragging = false;
    },
    pointerCancel() {
      if (press) release = { id: press.id, time: now(), click: false, origin: press.origin };
      press = null;
      dragging = false;
    },
    // 렌더 프레임마다 부른다. 요청 렌더 루프라 카메라가 멈추면 프레임도 멈추므로, 다음 프레임에서 오래된 드래그 표시를 지운다.
    noteCameraFrame(moved) {
      const time = now();
      if (!press && dragCamera && time - cameraMovedAt > settleMs) dragCamera = false;
      if (moved) cameraMovedAt = time;
    },
    isPressed: () => press !== null,
    isDragging: () => dragging,
    isCameraSettling: () => now() - cameraMovedAt < settleMs,
    // 드래그 중이거나, 드래그가 움직인 카메라가 아직 멈추지 않았다.
    isDragDriven() {
      if (dragging) return true;
      if (!dragCamera) return false;
      if (press || now() - cameraMovedAt < settleMs) return true;
      dragCamera = false;
      return false;
    },
    // origin: 이 핸들러가 받아야 하는 누르기 시작 위치("canvas" 메시, "label" 라벨). keyboard: 키보드 활성화.
    acceptClick({ pointerId, origin, keyboard = false } = {}) {
      if (keyboard) return true;
      if (!release || !release.click) return false;
      if (origin && release.origin !== origin) return false;
      if (pointerId !== undefined && pointerId !== release.id) return false;
      if (now() - release.time > releaseMatchMs) return false;
      return now() - cameraMovedAt >= settleMs;
    },
  };
}

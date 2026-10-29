import { useCallback, useEffect, useRef, useState } from "react";
import { Box3, Raycaster, Vector3 } from "three";
import { clearOrbitInertia } from "./cameraCommands.mjs";
import { FLY_DURATION_MS, easeInOutQuad, lerpView, resolveCameraPreset } from "./cameraPresets.mjs";

// prefers-reduced-motion: reduce 이면 비행 대신 바로 점프한다. matchMedia가 없는 환경(테스트, SSR)은 비행한다.
export function prefersReducedMotion(matchMedia = globalThis.matchMedia) {
  if (typeof matchMedia !== "function") return false;
  return Boolean(matchMedia("(prefers-reduced-motion: reduce)")?.matches);
}

// 시간 기반 카메라 보간기. 프레임마다 apply(view)를 부르고 durationMs가 지나면 마지막 view로 끝낸다.
// 프레임 수가 아니라 시각으로 진행하므로 느린 프레임에서도 같은 시간 안에 끝난다.
// 새 비행이 시작되거나 cancel()이 불리면 진행 중인 비행은 onCancel 통지와 함께 끊긴다.
export function createFlyTo({
  now = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (frame) => cancelAnimationFrame(frame),
  durationMs = FLY_DURATION_MS,
} = {}) {
  let flight = null;
  let frame = null;

  const cancelFlight = () => {
    if (!flight) return false;
    const cancelled = flight;
    flight = null;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    cancelled.onCancel?.();
    return true;
  };

  const tick = () => {
    frame = null;
    if (!flight) return;
    const t = (now() - flight.startedAt) / flight.durationMs;
    if (t >= 1) {
      const finished = flight;
      flight = null;
      finished.apply(finished.to);
      finished.onFinish?.();
      return;
    }
    flight.apply(lerpView(flight.from, flight.to, easeInOutQuad(t)));
    frame = requestFrame(tick);
  };

  return {
    start({ from, to, apply, reducedMotion = false, onFinish, onCancel }) {
      cancelFlight();
      if (reducedMotion) {
        apply(to);
        onFinish?.();
        return;
      }
      flight = { from, to, apply, onFinish, onCancel, startedAt: now(), durationMs };
      frame = requestFrame(tick);
    },
    cancel: cancelFlight,
    isActive: () => flight !== null,
  };
}

// OrbitControls의 start 이벤트 중 비행이 스스로 보낸 것. 사용자 입력과 구분하는 표식이다.
export const FLY_TO_START_EVENT = Object.freeze({ type: "start", flyTo: true });
export const isFlyToEvent = (event) => Boolean(event?.flyTo);

const toArray = (vector) => [vector.x, vector.y, vector.z];
// 캠퍼스 지면: 자연 지면(Topography)과 그 밖의 바닥면(Ground_*), 노면 표시. 생성기가 바닥을 겹치지 않게 나누므로 셋을 함께 본다.
const TERRAIN_NAME = /^(Topography|Ground_|Road_Markings)/;

// 장면에서 BLD_* 경계 상자와 지형 높이를 읽는 조회 함수. 장면이 없으면 빈 조회(고정 좌표 사용)를 돌려준다.
export function createSceneLookups(scene) {
  if (!scene) return {};
  const boundsOf = (name) => {
    const object = scene.getObjectByName(name);
    if (!object) return null;
    const box = new Box3().setFromObject(object);
    return box.isEmpty() ? null : { min: toArray(box.min), max: toArray(box.max) };
  };
  const raycaster = new Raycaster();
  const groundAt = (x, z) => {
    const terrain = [];
    scene.traverse((object) => {
      if (object.isMesh && TERRAIN_NAME.test(object.name)) terrain.push(object);
    });
    if (terrain.length === 0) return null;
    raycaster.set(new Vector3(x, 2000, z), new Vector3(0, -1, 0));
    const [hit] = raycaster.intersectObjects(terrain, false);
    return hit ? hit.point.y : null;
  };
  return { boundsOf, groundAt };
}

// OrbitControls(controlsRef.current)의 camera.position/target을 시점으로 비행시킨다.
// - 비행 직전에 controls에 FLY_TO_START_EVENT를 보낸다. CityModel의 클릭 포커스 비행이 끊기고 조작 중 해상도가
//   낮아진다. 정상 종료 때만 end를 보낸다(사용자가 끊은 비행은 OrbitControls가 스스로 end를 낸다).
// - 사용자 조작(비행 표식이 없는 start)은 비행을 끊는다.
// - prefers-reduced-motion: reduce 이면 바로 점프한다.
// getScene()이 장면을 주면 BLD_* 경계 상자와 지형 높이로 시점을 풀고, 없으면 고정 좌표를 쓴다.
export function useFlyTo({ controlsRef, getScene }) {
  const [engine] = useState(() => createFlyTo());
  const [isFlying, setIsFlying] = useState(false);
  const listenerRef = useRef(null);

  const detachListener = useCallback(() => {
    listenerRef.current?.controls.removeEventListener("start", listenerRef.current.handler);
    listenerRef.current = null;
  }, []);

  useEffect(() => () => {
    engine.cancel();
    detachListener();
  }, [detachListener, engine]);

  const cancelFlight = useCallback(() => {
    if (engine.cancel()) setIsFlying(false);
  }, [engine]);

  const flyTo = useCallback((preset, { onFinish } = {}) => {
    const controls = controlsRef.current;
    if (!controls?.object) return false;
    const camera = controls.object;
    const to = resolveCameraPreset(preset, createSceneLookups(getScene?.() ?? null));
    clearOrbitInertia(controls);
    const from = { position: toArray(camera.position), target: toArray(controls.target) };

    if (listenerRef.current?.controls !== controls) {
      detachListener();
      const handler = (event) => {
        if (!isFlyToEvent(event) && engine.cancel()) setIsFlying(false);
      };
      controls.addEventListener("start", handler);
      listenerRef.current = { controls, handler };
    }
    controls.dispatchEvent({ ...FLY_TO_START_EVENT });

    const apply = (view) => {
      camera.position.set(view.position[0], view.position[1], view.position[2]);
      controls.target.set(view.target[0], view.target[1], view.target[2]);
      controls.update();
    };
    setIsFlying(true);
    engine.start({
      from,
      to,
      apply,
      reducedMotion: prefersReducedMotion(),
      onFinish: () => {
        setIsFlying(false);
        controls.dispatchEvent({ type: "end" });
        onFinish?.();
      },
      onCancel: () => setIsFlying(false),
    });
    return true;
  }, [controlsRef, detachListener, engine, getScene]);

  return { flyTo, cancelFlight, isFlying };
}

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EMERGENCY_HEX } from "../../ui/sceneTokens.mjs";
import { RISK_COLORS } from "./riskColors.mjs";

// 교통 에이전트를 종류·부품별 InstancedMesh 하나로 그리기 위한 순수 정의(부품 모양·색·행렬).
// 모양과 색은 VehicleEntity·PedestrianEntity·ScooterEntity와 같다. 부품의 위치·회전은 기하에 미리 구워 두고,
// 인스턴스 행렬은 에이전트의 위치와 방향만 담는다. 재질 색은 흰색이고 부품 색은 인스턴스 색으로 준다.

const CAR_BODY = "#25636b";
const PERSON_BODY = "#5b4b8a";
const SCOOTER_DECK = "#16866f";
const DARK = "#172029";
const FRAME = "#263238";
const SKIN = "#dfb69d";
const LIGHT_BAR = "#ef4444";
export const RISK_RING_FALLBACK = "#eab308";

const isEmergency = (entity) => String(entity.state).toLowerCase() === "emergency";

function placed(geometry, { position = [0, 0, 0], rotationZ = 0 } = {}) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotationZ),
    new THREE.Vector3(1, 1, 1),
  );
  return geometry.applyMatrix4(matrix);
}

const merged = (parts) => mergeGeometries(parts.map((part) => part.toNonIndexed()), false);

// 부품: name, geometry(에이전트 원점 기준), material(종류·거칠기), color(entity => hex), only(entity => 그릴지).
export function createAgentParts() {
  const wheelsCar = [[-0.72, 0.25, -0.75], [0.72, 0.25, -0.75], [-0.72, 0.25, 0.78], [0.72, 0.25, 0.78]]
    .map((position) => placed(new THREE.CylinderGeometry(0.25, 0.25, 0.16, 12), { position, rotationZ: Math.PI / 2 }));
  return {
    car: [
      { name: "car-body", geometry: placed(new THREE.BoxGeometry(1.35, 0.75, 2.6), { position: [0, 0.48, 0] }),
        material: { type: "standard", roughness: 0.55 },
        color: (entity) => (isEmergency(entity) ? EMERGENCY_HEX : RISK_COLORS[entity.risk_level] ?? CAR_BODY) },
      { name: "car-cabin", geometry: placed(new THREE.BoxGeometry(1.12, 0.45, 1.2), { position: [0, 0.95, -0.15] }),
        material: { type: "standard", roughness: 0.35 },
        color: (entity) => (isEmergency(entity) ? "#dbeafe" : "#d7e4e5") },
      { name: "car-wheels", geometry: merged(wheelsCar), material: { type: "standard", roughness: 1 }, color: () => DARK },
      { name: "car-light-bar", geometry: placed(new THREE.BoxGeometry(0.65, 0.12, 0.18), { position: [0, 1.22, 0] }),
        material: { type: "basic" }, color: () => LIGHT_BAR, only: isEmergency },
    ],
    person: [
      { name: "person-body", geometry: placed(new THREE.CapsuleGeometry(0.22, 0.72, 5, 10), { position: [0, 0.72, 0] }),
        material: { type: "standard", roughness: 0.75 }, color: (entity) => RISK_COLORS[entity.risk_level] ?? PERSON_BODY },
      { name: "person-head", geometry: placed(new THREE.SphereGeometry(0.25, 12, 12), { position: [0, 1.45, 0] }),
        material: { type: "standard", roughness: 0.8 }, color: () => SKIN },
    ],
    scooter: [
      { name: "scooter-deck", geometry: placed(new THREE.BoxGeometry(0.28, 0.12, 1.25), { position: [0, 0.18, 0] }),
        material: { type: "standard", roughness: 1 },
        color: (entity) => (entity.risk_level === "danger" || String(entity.state).toLowerCase() === "wrong_way"
          ? RISK_COLORS.danger : RISK_COLORS[entity.risk_level] ?? SCOOTER_DECK) },
      { name: "scooter-frame", geometry: merged([
        placed(new THREE.CylinderGeometry(0.045, 0.045, 1.2, 8), { position: [0, 0.75, -0.48] }),
        placed(new THREE.CylinderGeometry(0.04, 0.04, 0.62, 8), { position: [0, 1.32, -0.48], rotationZ: Math.PI / 2 }),
      ]), material: { type: "standard", roughness: 1 }, color: () => FRAME },
      { name: "scooter-wheels", geometry: merged([-0.48, 0.48].map((z) =>
        placed(new THREE.CylinderGeometry(0.18, 0.18, 0.09, 12), { position: [0, 0.18, z], rotationZ: Math.PI / 2 }))),
      material: { type: "standard", roughness: 1 }, color: () => DARK },
    ],
  };
}

// 걷는 보행자의 몸 흔들림(PedestrianEntity와 같은 식).
export function personBob(entity, elapsedSeconds) {
  return entity.type === "person" && Number(entity.speed) > 0.1 ? Math.sin(elapsedSeconds * 7) * 0.045 : 0;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SCRATCH_Q = new THREE.Quaternion();
const SCRATCH_P = new THREE.Vector3();
const UNIT = new THREE.Vector3(1, 1, 1);

// 에이전트 원점 행렬: 위치(+보행자 흔들림) x Y축 회전.
export function agentMatrix(target, position, headingY, bob = 0, scale = UNIT) {
  SCRATCH_P.set(position.x, position.y + bob, position.z);
  SCRATCH_Q.setFromAxisAngle(Y_AXIS, headingY);
  return target.compose(SCRATCH_P, SCRATCH_Q, scale);
}

// 위험 고리 색(TrafficEntity와 같다). 보통 단계는 고리가 없다.
export function riskRingColor(entity) {
  if (entity.risk_level === "normal" || entity.risk_level === undefined) return null;
  return RISK_COLORS[entity.risk_level] ?? RISK_RING_FALLBACK;
}

// 인스턴스 버퍼 크기: 부족할 때만 2의 거듭제곱으로 키워 InstancedMesh를 다시 만드는 횟수를 줄인다.
export function instanceCapacity(count, current = 0) {
  if (current > 0 && count <= current) return current;
  let capacity = 16;
  while (capacity < count) capacity *= 2;
  return capacity;
}

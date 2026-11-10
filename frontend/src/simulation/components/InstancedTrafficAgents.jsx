import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { simulationHeadingToThree, simulationToThree } from "../utils/coordinateTransform";
import { agentMatrix, createAgentParts, instanceCapacity, personBob, riskRingColor } from "../utils/agentInstances.mjs";
import { contactShadowResources, contactShadowSize } from "./ContactShadow";
import { SELECTION_HEX } from "../../ui/sceneTokens.mjs";

// 교통 에이전트를 종류·부품마다 InstancedMesh 하나로 그린다. 에이전트가 몇 대든 드로우콜은 부품 수(차 3~4, 사람 2,
// 킥보드 3)에 위험 고리·선택 고리·접촉 그림자 몇 개를 더한 만큼이다. 위치·방향 보간은 TrafficEntity와 같은 식이다.
// 클릭·호버는 보이지 않는 인스턴스 구(반지름 2.1)로 받는다(레이캐스트는 visible과 무관하게 맞는다).
const TYPES = ["car", "person", "scooter"];
const SCRATCH_TARGET = new THREE.Vector3();
const SCRATCH_MATRIX = new THREE.Matrix4();
const SCRATCH_COLOR = new THREE.Color();
const SCRATCH_SCALE = new THREE.Vector3();
const SHADOW_MATRIX = new THREE.Matrix4();
const BODY_MATRIX = new THREE.Matrix4();

function dampAngle(current, target, factor) {
  let difference = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return current + difference * factor;
}

function createMaterial({ type, roughness }, extra = {}) {
  return type === "basic"
    ? new THREE.MeshBasicMaterial({ color: 0xffffff, ...extra })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, ...extra });
}

function createInstanced(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, SCRATCH_COLOR.set(0xffffff));
  return mesh;
}

export function InstancedTrafficAgents({ entities, coordinateConfig, resolveHeight, selectedAgentId, onSelect, contactShadows = false }) {
  const parts = useMemo(() => createAgentParts(), []);
  const capacity = instanceCapacity(entities.length);
  const meshes = useMemo(() => {
    const byType = Object.fromEntries(TYPES.map((type) => [type, parts[type].map((part) => ({
      part, mesh: createInstanced(part.geometry, createMaterial(part.material), capacity),
    }))]));
    const hit = createInstanced(new THREE.SphereGeometry(2.1, 8, 8).translate(0, 1, 0), new THREE.MeshBasicMaterial(), capacity);
    hit.visible = false;
    for (const list of Object.values(byType)) for (const { mesh } of list) mesh.raycast = () => {};
    const ring = createInstanced(new THREE.RingGeometry(1.1, 1.35, 24).rotateX(-Math.PI / 2).translate(0, 0.05, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }), capacity);
    ring.raycast = () => {};
    const { geometry, material } = contactShadowResources();
    const shadow = createInstanced(geometry, material, capacity);
    shadow.renderOrder = -1;
    shadow.raycast = () => {};
    return { byType, hit, ring, shadow };
  }, [parts, capacity]);
  const selectedRing = useMemo(() => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.62, 32).rotateX(-Math.PI / 2).translate(0, 0.07, 0),
      new THREE.MeshBasicMaterial({ color: SELECTION_HEX, transparent: true, opacity: 0.95, depthWrite: false }));
    mesh.raycast = () => {};
    mesh.visible = false;
    return mesh;
  }, []);

  useEffect(() => () => {
    for (const list of Object.values(meshes.byType)) for (const { mesh } of list) { mesh.material.dispose(); mesh.dispose(); }
    meshes.hit.geometry.dispose(); meshes.hit.material.dispose(); meshes.hit.dispose();
    meshes.ring.geometry.dispose(); meshes.ring.material.dispose(); meshes.ring.dispose();
    meshes.shadow.dispose();
  }, [meshes]);
  useEffect(() => () => {
    for (const list of Object.values(parts)) for (const { geometry } of list) geometry.dispose();
    selectedRing.geometry.dispose(); selectedRing.material.dispose();
  }, [parts, selectedRing]);

  // 에이전트별 보간 상태(id -> 위치·방향). 사라진 에이전트는 다음 프레임에 지운다.
  const motion = useRef(new Map());
  const hitIds = useRef([]);
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const selectedRef = useRef(selectedAgentId);
  selectedRef.current = selectedAgentId;

  useFrame(({ clock }, delta) => {
    const smoothing = 1 - Math.exp(-10 * Math.min(delta, 0.1));
    const list = entitiesRef.current;
    const seen = new Set();
    const counts = Object.fromEntries(TYPES.map((type) => [type, meshes.byType[type].map(() => 0)]));
    let hitCount = 0;
    let ringCount = 0;
    let shadowCount = 0;
    selectedRing.visible = false;
    hitIds.current.length = 0;
    for (const entity of list) {
      const typeParts = meshes.byType[entity.type];
      if (!typeParts) continue;
      const target = simulationToThree(entity, coordinateConfig);
      const resolvedY = resolveHeight?.(target, entity);
      if (Number.isFinite(resolvedY)) target.y = resolvedY;
      if (![target.x, target.y, target.z].every(Number.isFinite)) continue;
      const heading = simulationHeadingToThree(entity.heading, coordinateConfig);
      let state = motion.current.get(entity.id);
      if (!state) {
        state = { position: new THREE.Vector3(target.x, target.y, target.z), heading };
        motion.current.set(entity.id, state);
      } else {
        state.position.lerp(SCRATCH_TARGET.set(target.x, target.y, target.z), smoothing);
        state.heading = dampAngle(state.heading, heading, smoothing);
      }
      seen.add(entity.id);

      const base = agentMatrix(SCRATCH_MATRIX, state.position, state.heading);
      meshes.hit.setMatrixAt(hitCount, base);
      hitIds.current[hitCount] = entity.id;
      hitCount += 1;
      const ringColor = riskRingColor(entity);
      if (ringColor) {
        meshes.ring.setMatrixAt(ringCount, base);
        meshes.ring.setColorAt(ringCount, SCRATCH_COLOR.set(ringColor));
        ringCount += 1;
      }
      if (contactShadows) {
        const size = contactShadowSize(entity.type);
        if (size) {
          meshes.shadow.setMatrixAt(shadowCount, agentMatrix(SHADOW_MATRIX, state.position, state.heading, 0,
            SCRATCH_SCALE.set(size[0], 1, size[1])));
          shadowCount += 1;
        }
      }
      if (entity.id === selectedRef.current) {
        selectedRing.visible = true;
        selectedRing.position.copy(state.position);
        selectedRing.rotation.set(0, state.heading, 0);
      }
      const body = agentMatrix(BODY_MATRIX, state.position, state.heading, personBob(entity, clock.elapsedTime));
      typeParts.forEach(({ part, mesh }, index) => {
        if (part.only && !part.only(entity)) return;
        const at = counts[entity.type][index];
        mesh.setMatrixAt(at, body);
        mesh.setColorAt(at, SCRATCH_COLOR.set(part.color(entity)));
        counts[entity.type][index] = at + 1;
      });
    }
    for (const id of motion.current.keys()) if (!seen.has(id)) motion.current.delete(id);

    // 인스턴스가 0개인 InstancedMesh도 그리면 빈 드로우콜이 남으므로 숨긴다(hit은 늘 숨김, 레이캐스트만 받는다).
    const finish = (mesh, count) => {
      mesh.count = count;
      if (mesh !== meshes.hit) mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.boundingSphere = null; // 프러스텀 컬링·레이캐스트가 바뀐 위치로 다시 계산한다.
    };
    for (const type of TYPES) meshes.byType[type].forEach(({ mesh }, index) => finish(mesh, counts[type][index]));
    finish(meshes.hit, hitCount);
    finish(meshes.ring, ringCount);
    finish(meshes.shadow, contactShadows ? shadowCount : 0);
  });

  // 핸들러는 고정 참조다. R3F는 바뀐 이벤트 핸들러·raycast를 prop 변경으로 보고 invalidate하므로, 인라인 함수를 쓰면
  // 시뮬레이션 스토어가 갱신될 때마다(일시 정지 중에도) 한 장씩 다시 그린다.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const agentAt = (event) => (Number.isInteger(event.instanceId) ? hitIds.current[event.instanceId] : undefined);
  const handleClick = useCallback((event) => { const id = agentAt(event); if (!id) return; event.stopPropagation(); onSelectRef.current?.(id); }, []);
  const handleOver = useCallback((event) => { if (!agentAt(event)) return; event.stopPropagation(); document.body.style.cursor = "pointer"; }, []);
  const handleOut = useCallback(() => { document.body.style.cursor = "default"; }, []);
  return (
    <group name="traffic-agents">
      {Object.values(meshes.byType).flat().map(({ part, mesh }) => <primitive key={part.name} object={mesh} />)}
      <primitive object={meshes.shadow} />
      <primitive object={meshes.ring} />
      <primitive object={selectedRing} />
      <primitive
        object={meshes.hit}
        onClick={handleClick}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
      />
    </group>
  );
}

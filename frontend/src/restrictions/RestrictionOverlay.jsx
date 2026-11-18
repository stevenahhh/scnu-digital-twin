import { useEffect, useMemo } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EMERGENCY_HEX, RISK_WARNING_HEX } from "../ui/sceneTokens.mjs";
import { simulationToThree } from "../simulation/utils/coordinateTransform";
import { describeRestriction, restrictionRibbon, roadLabelPoint } from "./restrictionModel.mjs";

const RIBBON_LIFT = 0.3;
const MARKER_LIFT = 5;
const RING_RADIUS = [13, 16];
const STRIPE_COLORS = [new THREE.Color(EMERGENCY_HEX), new THREE.Color("#ffffff")];

// 건물 표시는 그 건물 이름표 바로 아래에 둔다. 같은 앵커라 그대로 두면 이름표와 겹친다.
const BUILDING_MARKER_OFFSET = "translateY(30px)";

function Marker({ position, item, hidden, offset }) {
  if (hidden) return null;
  const text = describeRestriction(item);
  return (
    <Html center position={position} zIndexRange={[5, 1]} style={{ pointerEvents: "none" }}>
      <span data-qa="restriction-marker" data-target={item.target_id} style={{ transform: offset }} className="flex items-center gap-1 whitespace-nowrap rounded-control border border-warning bg-surface-1 px-2 py-1 text-caption font-semibold text-ink shadow-popover">
        <span aria-hidden="true" className="h-2 w-2 rounded-pill bg-warning motion-safe:animate-pulse" />
        {`${text.status} · ${text.title}`}
      </span>
    </Html>
  );
}

function RoadRestriction({ item, coordinateConfig, resolveHeight, hidden }) {
  const { geometry, label } = useMemo(() => {
    const toWorld = ([x, z]) => {
      const world = simulationToThree({ x, y: 0, z }, coordinateConfig);
      return [world.x, resolveHeight(world) + RIBBON_LIFT, world.z];
    };
    const ribbon = restrictionRibbon(item.segments, toWorld);
    const colors = new Float32Array((ribbon.positions.length / 3) * 3);
    ribbon.stripes.forEach((stripe, quad) => {
      for (let vertex = 0; vertex < 4; vertex += 1) STRIPE_COLORS[stripe].toArray(colors, (quad * 4 + vertex) * 3);
    });
    const built = new THREE.BufferGeometry();
    built.setAttribute("position", new THREE.Float32BufferAttribute(ribbon.positions, 3));
    built.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    built.setIndex(ribbon.indices);
    const middle = roadLabelPoint(item.segments);
    const point = middle && toWorld(middle);
    return { geometry: built, label: point && [point[0], point[1] + MARKER_LIFT, point[2]] };
  }, [coordinateConfig, item.segments, resolveHeight]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <>
      <mesh geometry={geometry} renderOrder={3} raycast={() => null}>
        <meshBasicMaterial vertexColors transparent opacity={0.82} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-6} />
      </mesh>
      {label && <Marker position={label} item={item} hidden={hidden} />}
    </>
  );
}

function BuildingRestriction({ item, labelRegistry, modelCenter, resolveHeight, hidden }) {
  const entries = labelRegistry ? [...labelRegistry.values()] : [];
  const anchor = entries.find((entry) => entry.position && (entry.elementId === item.target_id || entry.dataElementId === item.target_id));
  if (!anchor || !modelCenter) return null;
  const x = anchor.position[0] - modelCenter.x;
  const z = anchor.position[2] - modelCenter.z;
  const ground = resolveHeight({ x, z }) + RIBBON_LIFT;
  return (
    <>
      <mesh position={[x, ground, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} raycast={() => null}>
        <ringGeometry args={[...RING_RADIUS, 48]} />
        <meshBasicMaterial color={RISK_WARNING_HEX} transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <Marker position={[x, anchor.position[1], z]} item={item} hidden={hidden} offset={BUILDING_MARKER_OFFSET} />
    </>
  );
}

// 3D 장면 위 통제 표시: 막힌 도로에는 줄무늬 띠, 공사·행사 건물에는 바닥 고리, 둘 다 이름표를 단다. 새 모델은 쓰지 않는다.
export function RestrictionOverlay({ restrictions, labelRegistry, coordinateConfig, resolveHeight, modelCenter, labelsHidden }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => { invalidate(); }, [invalidate, restrictions, labelRegistry]);
  return (
    <group name="campus-restrictions">
      {restrictions.map((item) => (item.target_type === "road"
        ? <RoadRestriction key={item.id} item={item} coordinateConfig={coordinateConfig} resolveHeight={resolveHeight} hidden={labelsHidden} />
        : <BuildingRestriction key={item.id} item={item} labelRegistry={labelRegistry} modelCenter={modelCenter} resolveHeight={resolveHeight} hidden={labelsHidden} />))}
    </group>
  );
}

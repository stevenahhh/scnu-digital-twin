import React, { useEffect, useMemo, useState } from "react";
import { Line } from "@react-three/drei";
import { fetchNetwork, fetchNetworkQuality } from "../api/networkApi.mjs";
import { describeSimulationError } from "../api/simulationHttp.mjs";
import { simulationStore } from "../stores/simulationStore";
import { simulationToThree } from "../utils/coordinateTransform";
import { styleForEdge } from "./networkDebugStyle.mjs";

function positionsFor(feature, config, resolveHeight) {
  const coordinates = feature.geometry?.type === "Polygon" ? feature.geometry.coordinates?.[0] : feature.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  return coordinates.map(([x, z]) => {
    const point = simulationToThree({ x, y: 0, z }, config);
    point.y = (resolveHeight?.(point) ?? point.y) + 0.25;
    return [point.x, point.y, point.z];
  });
}

// 검증 오류·경고 하나가 가리키는 노드 id들. 끊긴 간선은 양 끝 노드를 함께 표시한다.
function invalidNodeIds(item) {
  if (item.node_id) return [item.node_id];
  if (item.code === "DISCONNECTED_EDGE") return [item.from, item.to];
  return [];
}

export function NetworkDebugLayer({ coordinateConfig, resolveHeight, enabled }) {
  const [network, setNetwork] = useState(null);
  const [validation, setValidation] = useState(null);
  useEffect(() => {
    if (!enabled || network) return undefined;
    const controller = new AbortController();
    Promise.all([fetchNetwork({ signal: controller.signal }), fetchNetworkQuality({ signal: controller.signal })])
      .then(([nextNetwork, nextValidation]) => {
        setNetwork(nextNetwork);
        setValidation(nextValidation);
        simulationStore.setNetworkError(null);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        const message = describeSimulationError(error);
        if (message === null) throw error;
        simulationStore.setNetworkError(`교통망 디버그 자료를 받지 못했습니다: ${message}`);
      });
    return () => controller.abort();
  }, [enabled, network]);
  const invalidNodes = useMemo(() => new Set([
    ...(validation?.errors || []), ...(validation?.warnings || []),
  ].flatMap(invalidNodeIds)), [validation]);
  if (!enabled || !network) return null;
  const nodes = new Map(network.features.filter((feature) => feature.properties?.feature_type === "node").map((feature) => [feature.properties.id, feature]));
  return (
    <group name="transport-network-debug">
      {network.features.filter((feature) => feature.properties?.feature_type === "edge").map((feature) => {
        const { color, dashed, opacity } = styleForEdge(feature.properties);
        const points = positionsFor(feature, coordinateConfig, resolveHeight);
        return points.length > 1 ? <Line key={feature.properties.id} points={points} color={color} lineWidth={dashed ? 1.5 : 2} dashed={dashed} dashSize={1.5} gapSize={1} transparent opacity={opacity} /> : null;
      })}
      {[...invalidNodes].map((nodeId) => {
        const feature = nodes.get(nodeId);
        if (!feature) return null;
        const [x, z] = feature.geometry.coordinates;
        const point = simulationToThree({ x, y: 0, z }, coordinateConfig);
        point.y = (resolveHeight?.(point) ?? point.y) + 0.5;
        return <mesh key={nodeId} position={[point.x, point.y, point.z]}><sphereGeometry args={[0.75, 10, 10]} /><meshBasicMaterial color="#ef4444" /></mesh>;
      })}
    </group>
  );
}

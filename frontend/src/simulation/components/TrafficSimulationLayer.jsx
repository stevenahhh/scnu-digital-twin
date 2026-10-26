import React, { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { simulationStore, useSimulationStore } from "../stores/simulationStore";
import { useAgentDetails } from "../hooks/useAgentDetails.mjs";
import { AgentTrajectory } from "./AgentTrajectory";
import { RiskEventLayer } from "./RiskEventLayer";
import { InstancedTrafficAgents } from "./InstancedTrafficAgents";
import { TrafficEntity } from "./TrafficEntity";
import { TrafficSignal } from "./TrafficSignal";

// R3F는 바뀐 이벤트 핸들러를 prop 변경으로 보고 invalidate한다. 연결 상태 갱신만으로 다시 그리지 않도록 참조를 고정한다.
const clearAgentSelection = () => simulationStore.selectAgent(null);
const selectAgent = (id) => simulationStore.selectAgent(id);

export function TrafficSimulationLayer({
  coordinateConfig,
  renderEntity,
  resolveHeight,
  showRiskEvents = true,
  showTrafficLights = false,
  contactShadows = false,
}) {
  const entities = useSimulationStore((state) => Array.from(state.entities.values()));
  const trafficLights = useSimulationStore((state) => state.trafficLights);
  const selectedAgentId = useSimulationStore((state) => state.selectedAgentId);
  const selectedAgentDetails = useSimulationStore((state) => state.selectedAgentDetails);
  const entityMap = useSimulationStore((state) => state.entities);
  const invalidate = useThree((state) => state.invalidate);

  // demand 루프에서는 새 시뮬레이션 틱마다 한 장을 그린다. 숨은 탭에는 그리지 않는다.
  useEffect(() => {
    if (!document.hidden) invalidate();
  }, [entityMap, invalidate]);

  useAgentDetails(selectedAgentId);

  return (
    <group name="campus-traffic-simulation" onPointerMissed={clearAgentSelection}>
      {showTrafficLights && trafficLights.map((signal) => (
        <TrafficSignal key={signal.signal_id} signal={signal} coordinateConfig={coordinateConfig} />
      ))}
      {renderEntity ? entities.map((entity) => (
        <TrafficEntity
          key={entity.id}
          entity={entity}
          coordinateConfig={coordinateConfig}
          renderEntity={renderEntity}
          resolveHeight={resolveHeight}
          selected={entity.id === selectedAgentId}
          onSelect={selectAgent}
          contactShadow={contactShadows}
        />
      )) : (
        // 기본 모양은 종류·부품별 InstancedMesh로 그린다(에이전트 수와 무관한 드로우콜). renderEntity를 주면 에이전트마다 그린다.
        <InstancedTrafficAgents
          entities={entities}
          coordinateConfig={coordinateConfig}
          resolveHeight={resolveHeight}
          selectedAgentId={selectedAgentId}
          onSelect={selectAgent}
          contactShadows={contactShadows}
        />
      )}
      <AgentTrajectory details={selectedAgentDetails} coordinateConfig={coordinateConfig} resolveHeight={resolveHeight} />
      {showRiskEvents && <RiskEventLayer coordinateConfig={coordinateConfig} resolveHeight={resolveHeight} />}
    </group>
  );
}

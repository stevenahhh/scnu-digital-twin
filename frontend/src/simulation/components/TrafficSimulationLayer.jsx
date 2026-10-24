import React, { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { simulationStore, useSimulationStore } from "../stores/simulationStore";
import { SIMULATION_API_URL } from "../utils/apiConfig";
import { AgentTrajectory } from "./AgentTrajectory";
import { RiskEventLayer } from "./RiskEventLayer";
import { TrafficEntity } from "./TrafficEntity";
import { TrafficSignal } from "./TrafficSignal";

// R3F는 바뀐 이벤트 핸들러를 prop 변경으로 보고 invalidate한다. 연결 상태 갱신만으로 다시 그리지 않도록 참조를 고정한다.
const clearAgentSelection = () => simulationStore.selectAgent(null);

export function TrafficSimulationLayer({
  coordinateConfig,
  renderEntity,
  resolveHeight,
  showRiskEvents = true,
  showTrafficLights = false,
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

  useEffect(() => {
    if (!selectedAgentId) return undefined;
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch(`${SIMULATION_API_URL}/api/simulation/agents/${encodeURIComponent(selectedAgentId)}`);
        if (!response.ok) throw new Error(response.status === 404 ? "Agent가 시뮬레이션을 종료했습니다." : `HTTP ${response.status}`);
        const details = await response.json();
        if (!disposed && details.id === selectedAgentId) simulationStore.setSelectedAgentDetails(details);
      } catch (error) {
        if (!disposed) simulationStore.setSelectedAgentDetails(null, error.message);
      }
    };
    load();
    const timer = setInterval(load, 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [selectedAgentId]);

  return (
    <group name="campus-traffic-simulation" onPointerMissed={clearAgentSelection}>
      {showTrafficLights && trafficLights.map((signal) => (
        <TrafficSignal key={signal.signal_id} signal={signal} coordinateConfig={coordinateConfig} />
      ))}
      {entities.map((entity) => (
        <TrafficEntity
          key={entity.id}
          entity={entity}
          coordinateConfig={coordinateConfig}
          renderEntity={renderEntity}
          resolveHeight={resolveHeight}
          selected={entity.id === selectedAgentId}
          onSelect={(id) => simulationStore.selectAgent(id)}
        />
      ))}
      <AgentTrajectory details={selectedAgentDetails} coordinateConfig={coordinateConfig} resolveHeight={resolveHeight} />
      {showRiskEvents && <RiskEventLayer coordinateConfig={coordinateConfig} resolveHeight={resolveHeight} />}
    </group>
  );
}

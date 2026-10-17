import { useCallback, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { TrafficSimulationLayer } from "./components/TrafficSimulationLayer";
import { NetworkDebugLayer } from "./components/NetworkDebugLayer";
import { RouteDigitizerLayer } from "./components/RouteDigitizerLayer";
import { useRouteEditorStore } from "./stores/routeEditorStore";
import { CAMPUS_TRAFFIC_COORDINATE_CONFIG } from "./utils/campusTrafficCoordinates.mjs";

export { CAMPUS_TRAFFIC_COORDINATE_CONFIG };

const DOWN = new THREE.Vector3(0, -1, 0);

export function CampusTrafficSimulation() {
  const { scene } = useGLTF("/uni.glb");
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const cache = useRef(new Map());
  const editorEnabled = useRouteEditorStore((state) => state.enabled);
  const showNetwork = useRouteEditorStore((state) => state.showNetwork);

  const resolveHeight = useCallback((position) => {
    const terrain = scene.getObjectByName("Topography");
    if (!terrain) return CAMPUS_TRAFFIC_COORDINATE_CONFIG.origin.y;

    const key = `${Math.round(position.x * 2)}:${Math.round(position.z * 2)}`;
    const cached = cache.current.get(key);
    if (cached !== undefined) return cached;

    scene.updateWorldMatrix(true, true);
    raycaster.set(new THREE.Vector3(position.x, 160, position.z), DOWN);
    raycaster.far = 240;
    const hit = raycaster.intersectObject(terrain, true)[0];
    const height = hit ? hit.point.y + 0.12 : CAMPUS_TRAFFIC_COORDINATE_CONFIG.origin.y;
    if (cache.current.size > 5000) cache.current.clear();
    cache.current.set(key, height);
    return height;
  }, [raycaster, scene]);

  return <>
    <TrafficSimulationLayer
      coordinateConfig={CAMPUS_TRAFFIC_COORDINATE_CONFIG}
      resolveHeight={resolveHeight}
      showTrafficLights={false}
      showRiskEvents
    />
    <NetworkDebugLayer coordinateConfig={CAMPUS_TRAFFIC_COORDINATE_CONFIG} resolveHeight={resolveHeight} enabled={editorEnabled && showNetwork} />
    <RouteDigitizerLayer coordinateConfig={CAMPUS_TRAFFIC_COORDINATE_CONFIG} resolveHeight={resolveHeight} />
  </>;
}

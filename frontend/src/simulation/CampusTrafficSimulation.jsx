import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { TrafficSimulationLayer } from "./components/TrafficSimulationLayer";
import { NetworkDebugLayer } from "./components/NetworkDebugLayer";
import { RouteDigitizerLayer } from "./components/RouteDigitizerLayer";
import { useRouteEditorStore } from "./stores/routeEditorStore";
import { CAMPUS_TRAFFIC_COORDINATE_CONFIG, campusModelCenter } from "./utils/campusTrafficCoordinates.mjs";
import { CAMPUS_MODEL_URL, CAMPUS_MODEL_URLS } from "../campusModelAsset.mjs";
import { CAMPUS_HEIGHTFIELD_URLS, loadHeightfield, sampleHeight } from "../terrain/heightfield.mjs";

export { CAMPUS_TRAFFIC_COORDINATE_CONFIG };

const DOWN = new THREE.Vector3(0, -1, 0);
const RAY_ORIGIN = new THREE.Vector3();
const GROUND_CLEARANCE = 0.12;
// The height sidecar is generated with campus-v2.glb; ?model=uni has none and keeps the raycast path.
const HEIGHTFIELD_URLS = CAMPUS_MODEL_URL === CAMPUS_MODEL_URLS.detailed ? CAMPUS_HEIGHTFIELD_URLS : null;

// Dev-only count of terrain raycasts made by the traffic layer (0 per frame while the sidecar covers every agent).
const raycastCounter = import.meta.env?.DEV ? (globalThis.__trafficHeightRaycasts = { count: 0 }) : null;

// CityModel draws the model shifted by -campusModelCenter(D4 anchor); the sidecar is in the unshifted model frame.
// Same rule as CityModel (bounding box of BLD_D4 before recentering), computed in the gltf scene's own frame.
function modelCenterOf(scene) {
  const d4 = scene.getObjectByName("BLD_D4");
  if (!d4) return null;
  scene.updateWorldMatrix(true, true);
  const center = new THREE.Box3().setFromObject(d4).getCenter(new THREE.Vector3());
  const sceneOrigin = scene.getWorldPosition(new THREE.Vector3());
  return campusModelCenter([center.x - sceneOrigin.x, 0, center.z - sceneOrigin.z]);
}

export function CampusTrafficSimulation() {
  const { scene } = useGLTF(CAMPUS_MODEL_URL);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const cache = useRef(new Map());
  const [heightfield, setHeightfield] = useState(null);
  const modelCenter = useMemo(() => modelCenterOf(scene), [scene]);

  useEffect(() => {
    if (!HEIGHTFIELD_URLS) return undefined;
    let disposed = false;
    loadHeightfield(HEIGHTFIELD_URLS).then((field) => { if (!disposed) setHeightfield(field); });
    return () => { disposed = true; };
  }, []);
  const editorEnabled = useRouteEditorStore((state) => state.enabled);
  const showNetwork = useRouteEditorStore((state) => state.showNetwork);

  const resolveHeight = useCallback((position) => {
    if (heightfield && modelCenter) {
      const y = sampleHeight(heightfield, position.x + modelCenter.x, position.z + modelCenter.z);
      if (y !== null) return y + GROUND_CLEARANCE;
    }

    const terrain = scene.getObjectByName("Topography");
    if (!terrain) return CAMPUS_TRAFFIC_COORDINATE_CONFIG.origin.y;

    const key = `${Math.round(position.x * 2)}:${Math.round(position.z * 2)}`;
    const cached = cache.current.get(key);
    if (cached !== undefined) return cached;

    scene.updateWorldMatrix(true, true);
    raycaster.set(RAY_ORIGIN.set(position.x, 160, position.z), DOWN);
    raycaster.far = 240;
    if (raycastCounter) raycastCounter.count += 1;
    const hit = raycaster.intersectObject(terrain, true)[0];
    const height = hit ? hit.point.y + GROUND_CLEARANCE : CAMPUS_TRAFFIC_COORDINATE_CONFIG.origin.y;
    if (cache.current.size > 5000) cache.current.clear();
    cache.current.set(key, height);
    return height;
  }, [heightfield, modelCenter, raycaster, scene]);

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

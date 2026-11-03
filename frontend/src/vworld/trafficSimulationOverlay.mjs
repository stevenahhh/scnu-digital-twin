import { simulationToWgs84 } from "../geo/epsg5186.mjs";

// Simulation metres (true east/north of the D4 anchor) to WGS84 through the shared EPSG:5186 module, the same frame
// the Legacy scene and the network generator use; the D4 anchor maps to (127.4764043, 34.9700548).
export function simulationPointToVWorld(position) {
  const [longitude, latitude] = simulationToWgs84({ x: Number(position.x), z: Number(position.z) });
  return { longitude, latitude };
}

export function trafficModelUri(entity) {
  const variant = entity.type === "car" && ["caution", "warning", "danger"].includes(entity.risk_level)
    ? `-${entity.risk_level}`
    : "";
  return `/traffic/${entity.type}${variant}.glb`;
}

function entityModel(entity, Cesium) {
  return {
    uri: trafficModelUri(entity),
    scale: 1,
    minimumPixelSize: 0,
    maximumScale: 1,
    runAnimations: false,
    shadows: 1,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
  };
}

export function createVWorldTrafficSimulation({
  map,
  Cesium = globalThis.window?.Cesium,
  onStatus,
  websocketUrl = import.meta.env.VITE_SIMULATION_WS_URL || "ws://127.0.0.1:8002/ws/simulation",
}) {
  const viewer = map?._wsViewer;
  if (!viewer || !Cesium || typeof WebSocket === "undefined") return null;

  const objectIds = new Set();
  let disposed = false;
  let reconnectTimer = null;
  let socket = null;
  let retryInMs = 1500;
  let disconnectWarned = false;

  const reportStatus = (state, delay = retryInMs) => {
    try {
      onStatus?.({ state, retryInMs: delay });
    } catch {
      // Status observers must not interrupt the simulation overlay.
    }
  };

  const clear = () => {
    for (const id of objectIds) viewer.entities.removeById(id);
    objectIds.clear();
  };

  const applyEntities = (entities) => {
    const nextIds = new Set();
    for (const entity of entities) {
      if (!entity?.id || !["car", "person", "scooter"].includes(entity.type)) continue;
      const point = simulationPointToVWorld(entity);
      const heading = Cesium.Math.toRadians(Number(entity.heading || 0) + 90);
      const id = `SCNU_SIM_${entity.id}`;
      const position = Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, 0.08);
      const values = {
        position,
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
          position,
          new Cesium.HeadingPitchRoll(heading, 0, 0),
        ),
        model: entityModel(entity, Cesium),
      };
      const existing = viewer.entities.getById(id);
      if (existing) Object.assign(existing, values);
      else viewer.entities.add({ id, ...values });
      objectIds.add(id);
      nextIds.add(id);
    }
    for (const id of objectIds) {
      if (!nextIds.has(id)) {
        viewer.entities.removeById(id);
        objectIds.delete(id);
      }
    }
  };

  const connect = () => {
    if (disposed) return;
    reportStatus("connecting", retryInMs);
    socket = new WebSocket(websocketUrl);
    socket.onopen = () => {
      if (disposed) return;
      retryInMs = 1500;
      disconnectWarned = false;
      reportStatus("live", 0);
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === "simulation_update" && Array.isArray(payload.entities)) {
          applyEntities(payload.entities);
        }
      } catch {
        // Ignore malformed simulation frames and keep the last valid positions.
      }
    };
    const disconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      if (!disconnectWarned) {
        console.warn("Traffic simulation WebSocket disconnected");
        disconnectWarned = true;
      }
      const delay = retryInMs;
      retryInMs = Math.min(retryInMs * 2, 30000);
      reportStatus("disconnected", delay);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
    socket.onerror = () => {
      disconnect();
      try {
        socket.close();
      } catch {
        // A failed socket may already be closed.
      }
    };
    socket.onclose = disconnect;
  };

  connect();
  return {
    clear,
    dispose() {
      disposed = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      socket?.close();
      reportStatus("disconnected", 0);
      clear();
    },
  };
}

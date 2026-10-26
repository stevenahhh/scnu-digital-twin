import assert from "node:assert/strict";
import test from "node:test";
import { D4_ANCHOR_TM, SCENE_UNITS_PER_METRE, simulationToTm, tmToScene, tmToWgs84, wgs84ToTm } from "../geo/epsg5186.mjs";
import { createVWorldTrafficSimulation, simulationPointToVWorld, trafficModelUri } from "./trafficSimulationOverlay.mjs";

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function fakeMap() {
  return {
    _wsViewer: {
      entities: {
        removeById() {},
        getById() { return null; },
        add() {},
      },
      scene: { globe: { getHeight() { return 0; } } },
    },
  };
}

function fakeCesium() {
  return {
    Cartographic: { fromDegrees() { return {}; } },
    Math: { toRadians(value) { return value; } },
    Cartesian3: { fromDegrees() { return {}; } },
    Transforms: { headingPitchRollQuaternion() { return {}; } },
    HeadingPitchRoll: class {},
  };
}

// The overlay before EPSG:5186 (spherical, R = 6378137 m), kept as a fixture to measure what the change moved.
const OLD_ANCHOR = { longitude: 127.4764043, latitude: 34.9700548 };
function oldSpherical({ x, z }, anchor = OLD_ANCHOR) {
  const r = 6_378_137;
  const lat = (anchor.latitude * Math.PI) / 180;
  return [anchor.longitude + ((x / (r * Math.cos(lat))) * 180) / Math.PI, anchor.latitude + ((z / r) * 180) / Math.PI];
}
// metres in EPSG:5186 between where the old formula and the shared module put the same simulation point
function residualM(point, anchor) {
  const a = wgs84ToTm(...oldSpherical(point, anchor));
  const b = simulationToTm(point);
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
// GRS80 metres per degree at the anchor vs the sphere: the old formula's scale error, the only expected residual
function sphereScaleError({ x, z }) {
  const f = 1 / 298.257222101;
  const e2 = f * (2 - f);
  const lat = (OLD_ANCHOR.latitude * Math.PI) / 180;
  const w = Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const ellLat = (6_378_137 * (1 - e2)) / w ** 3;
  const ellLon = 6_378_137 / w;
  return Math.hypot(x * (1 - ellLon / 6_378_137), z * (1 - ellLat / 6_378_137));
}

test("maps the backup simulation origin into the aligned D4 VWorld footprint", () => {
  const point = simulationPointToVWorld({ x: 0, z: 0 });
  assert.ok(Math.abs(point.longitude - 127.4764043) < 1e-12);
  assert.ok(Math.abs(point.latitude - 34.9700548) < 1e-12);
});

test("goes through the shared EPSG:5186 module: 500 m east and north matches the TM transform", () => {
  const point = simulationPointToVWorld({ x: 500, z: 500 });
  const [lon, lat] = tmToWgs84(...simulationToTm({ x: 500, z: 500 }));
  assert.ok(Math.abs(point.longitude - lon) < 1e-10 && Math.abs(point.latitude - lat) < 1e-10);
  // the sim frame is true east/north, so plain grid offsets from the anchor are NOT the same point (convergence)
  const [glon, glat] = tmToWgs84(D4_ANCHOR_TM[0] + 500, D4_ANCHOR_TM[1] + 500);
  assert.ok(Math.hypot((point.longitude - glon) * 91000, (point.latitude - glat) * 111000) > 1);
});

test("the change against the old spherical overlay is exactly the sphere-vs-GRS80 scale error within 800 m", () => {
  for (const point of [{ x: 800, z: 0 }, { x: 0, z: 800 }, { x: -566, z: 566 }, { x: 566, z: -566 }, { x: 120, z: -40 }]) {
    const residual = residualM(point);
    // a frame bug (rotation, offset, wrong anchor) would leave a residual the scale error does not explain
    assert.ok(Math.abs(residual - sphereScaleError(point)) < 0.10, `${JSON.stringify(point)}: ${residual} vs ${sphereScaleError(point)}`);
  }
});

test("a wrong anchor (latitude + 0.0001) is caught by the same check (residual near 11 m)", () => {
  const point = { x: 100, z: 100 };
  const wrong = { ...OLD_ANCHOR, latitude: OLD_ANCHOR.latitude + 0.0001 };
  const unexplained = Math.abs(residualM(point, wrong) - sphereScaleError(point));
  assert.ok(unexplained > 10 && unexplained < 12, `${unexplained}`);
  assert.throws(() => assert.ok(unexplained < 0.10));
});

test("a Legacy-scene <-> VWorld round trip of one simulation point agrees within 1e-6 m", () => {
  const sim = { x: 312.5, z: -207.25 };
  const scene = tmToScene(...simulationToTm(sim));
  const { longitude, latitude } = simulationPointToVWorld(sim);
  const back = tmToScene(...wgs84ToTm(longitude, latitude));
  assert.ok(Math.hypot(back[0] - scene[0], back[1] - scene[1]) / SCENE_UNITS_PER_METRE < 1e-6);
});

test("switches the car model when proximity risk changes", () => {
  assert.equal(trafficModelUri({ type: "car", risk_level: "normal" }), "/traffic/car.glb");
  assert.equal(trafficModelUri({ type: "car", risk_level: "danger" }), "/traffic/car-danger.glb");
  assert.equal(trafficModelUri({ type: "person", risk_level: "danger" }), "/traffic/person.glb");
});

test("reconnects with bounded exponential backoff and reports status", (context) => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  const statuses = [];
  let nextTimer = 0;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  globalThis.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  context.after(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  const overlay = createVWorldTrafficSimulation({
    map: fakeMap(),
    Cesium: fakeCesium(),
    websocketUrl: "ws://test",
    onStatus: (status) => statuses.push(status),
  });
  const delays = [];
  for (const expected of [1500, 3000, 6000, 12000, 24000, 30000, 30000]) {
    const ws = FakeWebSocket.instances.at(-1);
    ws.readyState = 3;
    ws.onclose();
    const timer = [...timers.entries()][0];
    delays.push(timer[1].delay);
    assert.equal(timer[1].delay, expected);
    timers.delete(timer[0]);
    timer[1].callback();
  }
  assert.deepEqual(delays, [1500, 3000, 6000, 12000, 24000, 30000, 30000]);
  const current = FakeWebSocket.instances.at(-1);
  current.onopen();
  assert.deepEqual(statuses.at(-1), { state: "live", retryInMs: 0 });
  current.onclose();
  assert.deepEqual(statuses.at(-1), { state: "disconnected", retryInMs: 1500 });
  overlay.dispose();
});

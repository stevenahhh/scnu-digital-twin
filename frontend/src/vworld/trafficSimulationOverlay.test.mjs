import assert from "node:assert/strict";
import test from "node:test";
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

test("maps the backup simulation origin into the aligned D4 VWorld footprint", () => {
  const point = simulationPointToVWorld({ x: 0, z: 0 });
  assert.equal(point.longitude, 127.4764043);
  assert.equal(point.latitude, 34.9700548);
});

test("preserves metric movement around the shared GLB/VWorld alignment", () => {
  const origin = simulationPointToVWorld({ x: 0, z: 0 });
  const moved = simulationPointToVWorld({ x: 10, z: 0 });
  assert.ok(moved.longitude > origin.longitude);
  assert.equal(moved.latitude, origin.latitude);
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

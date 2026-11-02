import assert from "node:assert/strict";
import test from "node:test";
import {
  createVWorldTrafficSimulation,
  simulationPointToVWorld,
  trafficModelUri,
} from "./trafficSimulationOverlay.mjs";

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

test("clamps traffic models to the terrain instead of freezing a fallback altitude", () => {
  class FakeWebSocket {
    static latest = null;

    constructor() {
      FakeWebSocket.latest = this;
    }

    close() {}
  }

  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  try {
    const added = [];
    const viewer = {
      entities: {
        add(value) {
          added.push(value);
        },
        getById() {
          return null;
        },
        removeById() {},
      },
      scene: {
        globe: {
          getHeight() {
            return undefined;
          },
        },
      },
    };
    const Cesium = {
      Cartographic: {
        fromDegrees(longitude, latitude) {
          return { longitude, latitude };
        },
      },
      Cartesian3: {
        fromDegrees(longitude, latitude, height) {
          return { longitude, latitude, height };
        },
      },
      HeadingPitchRoll: class HeadingPitchRoll {},
      HeightReference: { CLAMP_TO_GROUND: "clamp-to-ground" },
      Math: { toRadians: (value) => value },
      Transforms: {
        headingPitchRollQuaternion() {
          return "orientation";
        },
      },
    };

    const simulation = createVWorldTrafficSimulation({
      map: { _wsViewer: viewer },
      Cesium,
      websocketUrl: "ws://test.invalid/ws/simulation",
    });
    FakeWebSocket.latest.onmessage({
      data: JSON.stringify({
        type: "simulation_update",
        entities: [{ id: "car_001", type: "car", x: 0, z: 0, heading: 0 }],
      }),
    });

    assert.equal(added[0].position.height, 0.08);
    assert.equal(added[0].model.heightReference, "clamp-to-ground");
    simulation.dispose();
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});

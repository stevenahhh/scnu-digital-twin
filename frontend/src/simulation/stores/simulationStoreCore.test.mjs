import assert from "node:assert/strict";
import test from "node:test";

import { createSimulationStore, normalizeNetworkProvenance, parseSimulationMessage } from "./simulationStoreCore.mjs";

function update({ time, status = "running", events = [] }) {
  return {
    type: "simulation_update",
    simulation_time: time,
    status,
    entities: [],
    risk_events: events,
    statistics: {},
    traffic_lights: [],
  };
}

test("clears accumulated risk events when the backend timeline restarts", () => {
  const store = createSimulationStore();
  store.applyMessage(update({
    time: 12,
    events: [{ event_id: "risk_1", object_ids: ["car_1", "person_1"] }],
  }));
  assert.equal(store.getState().riskEvents.length, 1);

  store.applyMessage(update({ time: 0, status: "stopped" }));
  assert.equal(store.getState().riskEvents.length, 0);
});

test("keeps selected agent details separate from the websocket entity snapshot", () => {
  const store = createSimulationStore();
  store.selectAgent("scooter_014");
  store.setSelectedAgentDetails({ id: "scooter_014", trajectory: [[1, 2, 0]] });
  store.applyMessage(update({ time: 1 }));
  assert.equal(store.getState().selectedAgentId, "scooter_014");
  assert.deepEqual(store.getState().selectedAgentDetails.trajectory, [[1, 2, 0]]);
  store.selectAgent(null);
  assert.equal(store.getState().selectedAgentId, null);
});

test("network debug errors are kept in the store and cleared with null", () => {
  const store = createSimulationStore();
  let emits = 0;
  store.subscribe(() => { emits += 1; });
  store.setNetworkError("시뮬레이션 서버에 연결할 수 없습니다");
  assert.equal(store.getState().networkError, "시뮬레이션 서버에 연결할 수 없습니다");
  store.setNetworkError("시뮬레이션 서버에 연결할 수 없습니다");
  assert.equal(emits, 1);
  store.setNetworkError(null);
  assert.equal(store.getState().networkError, null);
});

test("normalises statistics.network_provenance: finite numbers or null, optional separation", () => {
  const parsed = parseSimulationMessage({
    ...update({ time: 1 }),
    statistics: { network_provenance: { sidewalk_measured_m: "3515.2", crossing_count: 31, crossing_connected: 27, shared_estimated_m: "oops", person_measured_share: 29.5, separation: { person_on_walkable: 99.678, car_on_road: "99.837", seed: 42, seconds: 60, generatedAt: "2026-10-26T12:00:00+00:00" } } },
  });
  const provenance = parsed.statistics.network_provenance;
  assert.equal(provenance.sidewalk_measured_m, 3515.2);
  assert.equal(provenance.shared_estimated_m, null);
  assert.equal(provenance.road_measured_m, null);
  assert.equal(provenance.separation.car_on_road, 99.837);
  assert.equal(normalizeNetworkProvenance(null), null);
  assert.equal(normalizeNetworkProvenance({ crossing_count: 3 }).separation, null);
  assert.equal(parseSimulationMessage(update({ time: 1 })).statistics.network_provenance, null);
});

test("keeps the same entities Map when a paused or stopped server repeats its snapshot", () => {
  const store = createSimulationStore();
  const car = { id: "car_1", type: "car", x: 1, y: 0, z: 2, speed: 0, heading: 90, risk_level: "normal", state: "stopped" };
  store.applyMessage({ ...update({ time: 5, status: "paused" }), entities: [car] });
  const first = store.getState().entities;
  store.applyMessage({ ...update({ time: 5, status: "paused" }), entities: [{ ...car }] });
  assert.equal(store.getState().entities, first, "an identical snapshot must not create a new Map");
  store.applyMessage({ ...update({ time: 5.1, status: "running" }), entities: [{ ...car, x: 1.5 }] });
  assert.notEqual(store.getState().entities, first);
  assert.equal(store.getState().entities.get("car_1").x, 1.5);
});

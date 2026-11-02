import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_DEMO_DURATION_MS,
  dashboardDemoCameraPose,
  dashboardDemoStateAt,
} from "./dashboardDemo.mjs";

test("walks the dashboard through simulation and safety before selecting a building for energy", () => {
  assert.equal(dashboardDemoStateAt(0).tab, "dashboard");
  assert.equal(dashboardDemoStateAt(3_000).tab, "environment");
  assert.equal(dashboardDemoStateAt(8_000).tab, "safety");
  assert.equal(dashboardDemoStateAt(10_000).tab, "energy");
  assert.deepEqual(dashboardDemoStateAt(DASHBOARD_DEMO_DURATION_MS), {
    at: 9_300,
    tab: "energy",
    temperature: 33,
    hour: 14,
    minute: 30,
    selectBuilding: true,
  });
});

test("keeps a wide, smooth stadium-to-education camera move", () => {
  const start = dashboardDemoCameraPose(0);
  const middle = dashboardDemoCameraPose(0.5);
  const end = dashboardDemoCameraPose(1);
  assert.ok(start.height <= 450 && start.height >= 400);
  assert.ok(end.height <= 420 && end.height >= 380);
  assert.ok(end.latitude > start.latitude);
  assert.ok(end.longitude < start.longitude);
  assert.ok(middle.longitude < start.longitude && middle.longitude > end.longitude);
  assert.equal(start.pitchDegrees, -68);
  assert.equal(end.pitchDegrees, -68);
});

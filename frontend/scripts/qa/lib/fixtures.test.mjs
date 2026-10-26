import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { createFixtureState, handleFixtureRequest, handleFixtureUpgrade, resolveFixture } from "./fixtures.mjs";

function serve(state) {
  const server = http.createServer((req, res) => {
    if (!handleFixtureRequest(state, req, res)) {
      res.statusCode = 418;
      res.end();
    }
  });
  server.on("upgrade", (req, socket) => handleFixtureUpgrade(state, req, socket));
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("fixture routes cover the weather, popup, traffic and energy reads", () => {
  assert.equal(resolveFixture("api", "/environment/full")[1].base_weather.temperature, 16.8);
  assert.equal(resolveFixture("api", "/microclimate/elements/BLD_C1/popup")[1].element_id, "BLD_C1");
  assert.equal(resolveFixture("api", "/microclimate/elements/BLD_C1/popup")[1].data_note.assumption_level, "estimated");
  assert.equal(resolveFixture("vision", "/api/traffic")[1].is_running, true);
  assert.equal(resolveFixture("api", "/energy/rankings?date=2026-05-18")[1].rankings.length, 2);
  assert.equal(resolveFixture("api", "/energy/buildings/D4/installation-plans")[1][0].is_representative, true);
  assert.equal(resolveFixture("api", "/energy/buildings/D4/representative-plan")[1].installation_plan_id, "D4-plan-1");
  assert.equal(resolveFixture("api", "/energy/installation-plans/D4-plan-1")[1].arrays[0].installation_plan_id, "D4-plan-1");
  assert.equal(resolveFixture("api", "/nope"), null);
});

test("down mode drops requests, up mode serves JSON, --fail answers 503 and --delay-ms delays", async () => {
  const state = createFixtureState();
  const server = await serve(state);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(fetch(`${base}/__qa/api/environment/full`));
    await fetch(`${base}/__qa/control`, { method: "POST", body: JSON.stringify({ mode: "up", fail: ["/environment/full"], delayMs: 150 }) });
    const started = Date.now();
    const failed = await fetch(`${base}/__qa/api/environment/full`);
    assert.equal(failed.status, 503);
    assert.ok(Date.now() - started >= 140);
    assert.equal((await failed.json()).detail.code, "weather_upstream_unavailable");
    const traffic = await fetch(`${base}/__qa/vision/api/traffic`);
    assert.equal(traffic.status, 200);
    const control = await (await fetch(`${base}/__qa/control`)).json();
    assert.deepEqual(control.requests.map((item) => item.path), ["/environment/full", "/api/traffic"]);
  } finally {
    server.close();
  }
});

test("the simulation WebSocket stub accepts and sends one idle frame when up", async () => {
  const state = createFixtureState();
  state.mode = "up";
  const server = await serve(state);
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/__qa/ws/simulation`);
    const message = await new Promise((resolve, reject) => {
      socket.addEventListener("message", (event) => resolve(event.data));
      socket.addEventListener("error", () => reject(new Error("ws error")));
    });
    assert.deepEqual(JSON.parse(message), { status: "idle" });
    socket.close();
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { appliesTo } from "./registry.mjs";

const scenario = (state, fixtures) => ({ entry: "legacy", state, viewport: "D", theme: "dark", fixtures });

test("a per-state fixtures map applies each state only under its own fixture mode", () => {
  const check = { states: ["S01", "S12"], fixtures: { S01: "down", S12: "delay" } };
  assert.equal(appliesTo(check, scenario("S01", "down")), true);
  assert.equal(appliesTo(check, scenario("S12", "down")), false);
  assert.equal(appliesTo(check, scenario("S12", "delay")), true);
  assert.equal(appliesTo(check, scenario("S01", "delay")), false);
});

test("a single fixture mode and the default keep their meaning", () => {
  assert.equal(appliesTo({ states: ["S06"], fixtures: "up" }, scenario("S06", "up")), true);
  assert.equal(appliesTo({ states: ["S06"], fixtures: "up" }, scenario("S06", "down")), false);
  assert.equal(appliesTo({ states: ["S06"] }, scenario("S06", "down")), true);
});

import { defaultRequestedIds, plannedScenarios } from "./registry.mjs";

test("without --only a run requests only the checks that can apply to the scenarios it captures", () => {
  const ids = { chainIds: ["S01", "S12", "S13"], vworldStateIds: ["S01", "S12"], s17SubStates: ["S01", "S13"] };
  const checks = new Map([
    ["A", { id: "A", states: ["S01"] }],
    ["DELAY", { id: "DELAY", states: ["S12"], fixtures: "delay" }],
    ["VW", { id: "VW", states: ["S01"], entries: ["vworld"] }],
    ["LIGHT", { id: "LIGHT", states: ["S01"], themes: ["light"] }],
    ["UP", { id: "UP", states: ["S13"], fixtures: "up" }],
    ["AGG", { id: "AGG", aggregate: true, states: [] }],
    ["SMOKE-x", { id: "SMOKE-x", states: ["S01"] }],
  ]);
  const legacyDark = plannedScenarios({ entries: ["legacy"], viewports: ["D"], themes: ["dark"], stateIds: ["S01", "S12", "S13", "S17"], fixtureLabel: "down" }, ids);
  assert.deepEqual(defaultRequestedIds(checks, legacyDark), ["A", "UP", "AGG"]);
  const delayed = plannedScenarios({ entries: ["legacy"], viewports: ["D"], themes: ["dark"], stateIds: ["S12"], fixtureLabel: "delay" }, ids);
  assert.deepEqual(defaultRequestedIds(checks, delayed), ["DELAY", "AGG"]);
  const vworldBoth = plannedScenarios({ entries: ["vworld"], viewports: ["D"], themes: ["dark", "light"], stateIds: ["S01"], fixtureLabel: "down" }, ids);
  assert.deepEqual(defaultRequestedIds(checks, vworldBoth), ["A", "VW", "LIGHT", "AGG"]);
});

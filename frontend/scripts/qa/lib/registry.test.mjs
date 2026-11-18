import assert from "node:assert/strict";
import test from "node:test";
import { appliesTo } from "./registry.mjs";

const scenario = (state, fixtures) => ({ entry: "main", state, viewport: "D", theme: "dark", fixtures });

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
  const mainDark = plannedScenarios({ entries: ["main"], viewports: ["D"], themes: ["dark"], stateIds: ["S01", "S12", "S13", "S17"], fixtureLabel: "down" }, ids);
  assert.deepEqual(defaultRequestedIds(checks, mainDark), ["A", "UP", "AGG"]);
  const delayed = plannedScenarios({ entries: ["main"], viewports: ["D"], themes: ["dark"], stateIds: ["S12"], fixtureLabel: "delay" }, ids);
  assert.deepEqual(defaultRequestedIds(checks, delayed), ["DELAY", "AGG"]);
  const vworldBoth = plannedScenarios({ entries: ["vworld"], viewports: ["D"], themes: ["dark", "light"], stateIds: ["S01"], fixtureLabel: "down" }, ids);
  assert.deepEqual(defaultRequestedIds(checks, vworldBoth), ["A", "VW", "LIGHT", "AGG"]);
});

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expandParts, listCheckLines, loadChecks, unknownCheckIds } from "./registry.mjs";

const VISUAL_QA = fileURLToPath(new URL("../visual-qa.mjs", import.meta.url));
const IS_IDS = Array.from({ length: 40 }, (_, index) => `IS-${String(index + 1).padStart(2, "0")}`);

test("the loaded registry holds all 40 ideal-state IS ids next to the audit checks", async () => {
  const checks = await loadChecks();
  for (const id of IS_IDS) assert.ok(checks.has(id), `${id} missing from the registry`);
  assert.ok(checks.has("GAP-01") && checks.has("SMOKE-canvas"));
  const listed = listCheckLines(checks).map((line) => line.split("\t")[0]);
  for (const id of IS_IDS) assert.ok(listed.includes(id), `${id} missing from --list-checks`);
});

test("an --only id the registry does not hold is reported as unknown", async () => {
  const checks = await loadChecks();
  assert.deepEqual(unknownCheckIds(["IS-01", "IS-99", "GAP-01"], checks), ["IS-99"]);
});

test("scenario lists match state, viewport, entry and fixture mode", () => {
  const check = { scenarios: [{ states: ["S01"], viewports: ["D"], fixtures: "up" }, { states: ["S04"], viewports: ["D", "P"], entries: ["vworld"] }] };
  assert.equal(appliesTo(check, scenario("S01", "up")), true);
  assert.equal(appliesTo(check, scenario("S01", "down")), false);
  assert.equal(appliesTo(check, scenario("S04", "down")), false, "S04 is VWorld-only");
  assert.equal(appliesTo(check, { ...scenario("S04", "down"), entry: "vworld", viewport: "P" }), true);
  assert.equal(appliesTo({ scenarios: [{ states: ["*"], viewports: ["P", "T"], fixtures: "any" }] }, { ...scenario("S09E", "delay"), viewport: "T" }), true);
});

test("a check's parts are requested with it: a part that applies makes the id requested", () => {
  const part = { id: "X", part: true, mutates: true, scenarios: [{ states: ["S13"], viewports: ["D"] }] };
  const check = { id: "X", scenarios: [], parts: [part] };
  assert.deepEqual(expandParts(check), [check, part]);
  const planned = [{ entry: "main", viewport: "D", theme: "dark", state: "S13", fixtures: "down" }];
  assert.deepEqual(defaultRequestedIds(new Map([["X", check]]), planned), ["X"]);
  assert.deepEqual(defaultRequestedIds(new Map([["X", check]]), [{ ...planned[0], state: "S01" }]), []);
});

test("plannedScenarios plans the S17 sub-states for VWorld too, and S16 for Main only", () => {
  const ids = { chainIds: ["S01"], vworldStateIds: ["S01"], s17SubStates: ["S01", "S13"] };
  const plan = plannedScenarios({ entries: ["main", "vworld"], viewports: ["D"], themes: ["dark"], stateIds: ["S01", "S16", "S17"], fixtureLabel: "down" }, ids);
  assert.deepEqual(plan.filter((s) => s.fixtures === "up").map((s) => `${s.entry}:${s.state}`), ["main:S01", "main:S13", "vworld:S01", "vworld:S13"]);
  assert.deepEqual(plan.filter((s) => s.state === "S16").map((s) => s.entry), ["main"]);
});

test("CLI: --list-checks prints IS-01..IS-40 and --only IS-99 is a usage error (exit 2)", () => {
  const list = spawnSync("bun", [VISUAL_QA, "--list-checks"], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  for (const id of IS_IDS) assert.match(list.stdout, new RegExp(`^${id}\\t`, "m"));
  const unknown = spawnSync("bun", [VISUAL_QA, "--only", "IS-99", "--entry", "main", "--states", "S01"], { encoding: "utf8" });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown check id IS-99/);
});

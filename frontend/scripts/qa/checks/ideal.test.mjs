import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IDEAL_CHECKS, IDEAL_PAGE_SOURCE } from "./ideal.mjs";
import { IDEAL_ROWS } from "./ideal-rows.mjs";
import { IS_IDS } from "./ideal-eval.mjs";
import { STATE_IDS } from "../lib/states.mjs";
import { appliesTo, expandParts } from "../lib/registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLET_ROWS = ["IS-07", "IS-17", "IS-18", "IS-25", "IS-27", "IS-33"];

test("IDEAL_CHECKS holds IS-01..IS-40, each with its literal ideal-state row", () => {
  assert.deepEqual([...IDEAL_CHECKS.keys()], IS_IDS);
  assert.deepEqual(Object.keys(IDEAL_ROWS), IS_IDS);
  for (const check of IDEAL_CHECKS.values()) {
    assert.ok(check.doc.startsWith(IDEAL_ROWS[check.id].check), check.id);
    assert.equal(typeof check.run, "function", check.id);
  }
});

test("every IS check (or one of its parts) names known states, viewports and fixture modes", () => {
  for (const check of IDEAL_CHECKS.values()) {
    if (check.aggregate) {
      assert.ok(check.collect?.scenarios?.length > 0, `${check.id} aggregate without collect scenarios`);
      continue;
    }
    const specs = expandParts(check).flatMap((part) => part.scenarios ?? []);
    assert.ok(specs.length > 0, `${check.id} has no scenarios`);
    for (const spec of specs) {
      for (const state of spec.states) assert.ok(state === "*" || STATE_IDS.includes(state), `${check.id} unknown state ${state}`);
      for (const viewport of spec.viewports) assert.ok(["D", "P", "T"].includes(viewport), `${check.id} viewport ${viewport}`);
      assert.ok(["down", "up", "delay", "any"].includes(spec.fixtures), `${check.id} fixtures ${spec.fixtures}`);
    }
    for (const part of check.parts) {
      assert.equal(part.id, check.id);
      assert.equal(part.part, true);
      assert.equal(typeof part.run, "function");
    }
  }
});

test("tablet policy: only the viewport-agnostic rows evaluate on T; the rest report n/a", () => {
  for (const check of IDEAL_CHECKS.values()) {
    assert.equal(check.naOnTablet, !TABLET_ROWS.includes(check.id), check.id);
  }
});

test("rows that act on the page do it in parts marked mutates; IS-38 includes both D and P under reduced motion", () => {
  const actingIds = ["IS-22", "IS-26", "IS-28", "IS-32", "IS-34", "IS-35", "IS-36", "IS-37", "IS-38", "IS-39", "IS-40"];
  for (const id of actingIds) {
    const check = IDEAL_CHECKS.get(id);
    assert.ok(check.parts.length > 0 && check.parts.every((part) => part.mutates === true), id);
  }
  const s04 = (viewport) => ({ entry: "main", state: "S04", viewport, theme: "dark", fixtures: "down" });
  assert.equal(appliesTo(IDEAL_CHECKS.get("IS-38").parts[0], s04("D")), true);
  assert.equal(appliesTo(IDEAL_CHECKS.get("IS-38").parts[0], s04("P")), true);
});

test("S01 rows tell the feeds-down frame from the S17 fixtures-up frame", () => {
  const is08 = IDEAL_CHECKS.get("IS-08");
  const is09 = IDEAL_CHECKS.get("IS-09");
  const frame = (fixtures) => ({ entry: "main", state: "S01", viewport: "D", theme: "dark", fixtures });
  assert.equal(appliesTo(is08, frame("up")), true);
  assert.equal(appliesTo(is08, frame("down")), false);
  assert.equal(appliesTo(is09, frame("down")), true);
  assert.equal(appliesTo(is09, frame("up")), false);
  const is01 = IDEAL_CHECKS.get("IS-01");
  assert.equal(appliesTo(is01, frame("up")), true);
  assert.equal(appliesTo(is01, frame("down")), true);
  assert.equal(appliesTo(is01, { ...frame("down"), entry: "vworld" }), true);
});

test("IS-39 measures its own delayed request in a plain run and in a --delay-ms run", () => {
  const part = IDEAL_CHECKS.get("IS-39").parts[0];
  for (const fixtures of ["down", "delay"]) assert.equal(appliesTo(part, { entry: "main", state: "S09E", viewport: "D", theme: "dark", fixtures }), true);
});

test("the page helpers are the ideal-state section 6.1 definitions", () => {
  for (const name of ["CONTROL", "isVisible", "visibleControls", "overlaps", "sceneTime", "textNodesWith"]) assert.match(IDEAL_PAGE_SOURCE, new RegExp(`\\b${name}\\b`));
  assert.match(IDEAL_PAGE_SOURCE, /\[role=switch\]/);
  assert.match(IDEAL_PAGE_SOURCE, /campus-label-layer/);
});

test("owners.json maps every IS id to an owning todo", () => {
  const owners = JSON.parse(readFileSync(path.join(HERE, "owners.json"), "utf8"));
  for (const id of IS_IDS) assert.match(String(owners[id] ?? ""), /^[2-7]$/, `${id} owner`);
});

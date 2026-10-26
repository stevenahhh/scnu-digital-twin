import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKS, REQUIRED_HOOKS } from "./index.mjs";
import { STATE_IDS } from "../lib/states.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// DESIGN-AUDIT.md lives in the research folder of the main checkout (never committed). Point
// QA_AUDIT_PATH at it, or keep the repository-relative default.
function auditPath() {
  const candidates = [
    process.env.QA_AUDIT_PATH,
    path.resolve(HERE, "../../../../.omo/ulw-research/20261025-091647/DESIGN-AUDIT.md"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  assert.ok(found, `DESIGN-AUDIT.md not found; set QA_AUDIT_PATH (tried ${candidates.join(", ")})`);
  return found;
}

function browserIdsFromAudit() {
  const audit = readFileSync(auditPath(), "utf8");
  const section = audit.slice(audit.indexOf("## 7. Visual QA scenario list"), audit.indexOf("## 8."));
  return [...section.matchAll(/^\| ((?:GAP|V-[SFQ])-\d+) \| (.*?) \|/gm)].filter((m) => !m[2].startsWith("static")).map((m) => m[1]);
}

test("CHECKS holds exactly the 151 browser rows of AUDIT section 7", () => {
  const ids = browserIdsFromAudit();
  assert.equal(CHECKS.size, 151);
  assert.equal(ids.length, 151);
  assert.deepEqual([...CHECKS.keys()].sort(), [...ids].sort());
});

test("every check has a literal audit doc, runnable states and a run function", () => {
  for (const check of CHECKS.values()) {
    assert.equal(typeof check.run, "function", check.id);
    assert.match(check.doc, / PASS: /, check.id);
    if (check.aggregate) continue;
    const states = Array.isArray(check.states) ? check.states : Object.values(check.states).flat();
    assert.ok(states.length > 0, `${check.id} has no states`);
    for (const state of states) assert.ok(STATE_IDS.includes(state), `${check.id} uses unknown state ${state}`);
    if (!Array.isArray(check.states)) for (const vp of Object.keys(check.states)) assert.ok(["D", "P"].includes(vp), check.id);
    if (check.fixtures) assert.ok(["down", "up", "delay", "any"].includes(check.fixtures), check.id);
  }
});

test("owners.json maps every check id to an owning todo", () => {
  const owners = JSON.parse(readFileSync(path.join(HERE, "owners.json"), "utf8"));
  for (const id of CHECKS.keys()) assert.match(String(owners[id] ?? ""), /^\d+$/, `${id} has no owner`);
});

test("required product hooks are the twelve named in the plan", () => {
  assert.deepEqual([...REQUIRED_HOOKS].sort(), [
    "[data-qa=breadcrumb]", "[data-qa=camera-controls]", "[data-qa=campus-label-layer]", "[data-qa=d4-room-grid]",
    "[data-qa=estimate-value]", "[data-qa=freshness-stamp]", "[data-qa=legend]", "[data-qa=presentation-toggle]",
    "[data-qa=sample-badge]", "[data-qa=search-field]", "[data-qa=selection-inspector]", "[data-qa=sheet-handle]",
  ]);
});

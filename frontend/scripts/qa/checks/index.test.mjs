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
    const modes = ["down", "up", "delay", "any"];
    if (check.fixtures && typeof check.fixtures === "object") {
      // Per-state fixtures: every key is one of the check's states, every value a mode.
      const states = Array.isArray(check.states) ? check.states : Object.values(check.states).flat();
      for (const [state, mode] of Object.entries(check.fixtures)) {
        assert.ok(states.includes(state), `${check.id} fixtures for unknown state ${state}`);
        assert.ok(modes.includes(mode), `${check.id} fixtures mode ${mode}`);
      }
    } else if (check.fixtures) assert.ok(modes.includes(check.fixtures), check.id);
  }
});

// The capture pass shares one screenshot (ctx.png / ctx.image) between every check of a state, and withPanelOpen re-captures
// it after opening the panel. A check that acts on the page outside the probe replay leaves later checks measuring a frame
// the captured state never showed (GAP-03 left the panel-open frame behind for V-F-17).
test("every check that acts on the page is marked mutates and runs in the probe replay", () => {
  const acting = /\b(withPanelOpen|openPanelSection|openPanel|openTab|refreshImage|setTimeMinutes)\(|\.b\.(tap|key|mouse)\(/;
  const unmarked = [...CHECKS.values()].filter((check) => !check.mutates && acting.test(check.run.toString())).map((check) => check.id);
  assert.deepEqual(unmarked, []);
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

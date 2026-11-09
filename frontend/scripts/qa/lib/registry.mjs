// Check registry loader: three smoke checks shipped with the harness core, plus the audit checks
// from ../checks/index.mjs (CHECKS: Map<id, check>) when that module exists.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decode } from "./probe.mjs";

function canvasStats(image, rect, scale) {
  if (!rect) return null;
  const x0 = Math.max(0, Math.floor(rect.x * scale));
  const y0 = Math.max(0, Math.floor(rect.y * scale));
  const x1 = Math.min(image.width, Math.ceil((rect.x + rect.w) * scale));
  const y1 = Math.min(image.height, Math.ceil((rect.y + rect.h) * scale));
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const i = (y * image.width + x) * image.channels;
      const g = (image.pixels[i] + image.pixels[i + 1] + image.pixels[i + 2]) / 3;
      sum += g;
      sq += g * g;
      n += 1;
    }
  }
  if (!n) return null;
  const mean = sum / n;
  return { mean: Math.round(mean * 10) / 10, stddev: Math.round(Math.sqrt(Math.max(0, sq / n - mean * mean)) * 10) / 10 };
}

export const SMOKE_CHECKS = Object.freeze([
  {
    id: "SMOKE-canvas",
    states: ["*"],
    doc: "A WebGL canvas is mounted with a non-empty rect and the rendered pixels inside it are not a flat fill.",
    async run(ctx) {
      const rect = await ctx.inPage((qa) => {
        const canvases = qa.all("canvas").filter(qa.shown);
        const biggest = canvases.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
        return biggest ? qa.r(biggest) : null;
      });
      const stats = rect ? canvasStats(ctx.image(), rect, ctx.scale) : null;
      return {
        pass: Boolean(rect && rect.w > 0 && rect.h > 0 && stats && stats.stddev > 2),
        measured: { rect, pixels: stats },
        expected: "canvas rect > 0 and pixel stddev > 2",
      };
    },
  },
  {
    id: "SMOKE-labels",
    states: ["*"],
    doc: "Legacy: more than five campus label buttons are mounted (the SCREENS readiness rule). VWorld: the map overlay layer is mounted.",
    async run(ctx) {
      if (ctx.entry === "vworld") {
        const present = await ctx.inPage((qa) => Boolean(qa.one("[data-qa=vworld-map-overlays]")));
        return { pass: present, measured: { vworldMapOverlays: present }, expected: "[data-qa=vworld-map-overlays] mounted" };
      }
      const labels = await ctx.inPage((qa) => qa.all("button[data-qa=campus-label]").length);
      return { pass: labels > 5, measured: { labelButtons: labels }, expected: "> 5 button[data-qa=campus-label]s" };
    },
  },
  {
    id: "SMOKE-panel",
    states: ["*"],
    doc: "The dashboard panel is mounted.",
    async run(ctx) {
      const rect = await ctx.inPage((qa) => {
        const el = qa.one("[data-qa=dashboard-panel]");
        return el ? qa.r(el) : null;
      });
      return { pass: Boolean(rect), measured: { panel: rect }, expected: "[data-qa=dashboard-panel] mounted" };
    },
  },
]);

// Smoke checks, the audit checks (CHECKS) and the ideal-state IS checks (IDEAL_CHECKS) of ../checks/index.mjs.
export async function loadChecks() {
  const checks = new Map(SMOKE_CHECKS.map((check) => [check.id, check]));
  const indexUrl = new URL("../checks/index.mjs", import.meta.url);
  if (existsSync(fileURLToPath(indexUrl))) {
    const { CHECKS, IDEAL_CHECKS = new Map() } = await import(indexUrl.href);
    for (const [id, check] of [...CHECKS, ...IDEAL_CHECKS]) checks.set(id, check);
  }
  return checks;
}

// An --only list naming an id the registry does not hold is a usage error (exit 2), never a FAIL.
export function unknownCheckIds(ids, checks) {
  return ids.filter((id) => !checks.has(id));
}

// A check plus its parts: a part shares the check's id (its evaluations roll up under it) but has its own scenarios and
// `mutates` flag, so one IS row can measure some states in the capture pass and act on the page in others.
export function expandParts(check) {
  return [check, ...(check.parts ?? [])];
}

// --list-checks: one line per registered id.
export function listCheckLines(checks) {
  return [...checks.values()].map((check) => `${check.id}\t${String(check.doc ?? "").replace(/\s+/g, " ").slice(0, 120)}`);
}

function matchesScenario(spec, scenario) {
  const states = Array.isArray(spec.states) ? spec.states : [spec.states ?? "*"];
  if (!states.includes("*") && !states.includes(scenario.state)) return false;
  if (spec.viewports && !spec.viewports.includes(scenario.viewport)) return false;
  if (spec.entries && !spec.entries.includes(scenario.entry)) return false;
  const fixtures = spec.fixtures ?? "down";
  return fixtures === "any" || fixtures === scenario.fixtures;
}

export async function loadOwners() {
  const ownersUrl = new URL("../checks/owners.json", import.meta.url);
  if (!existsSync(fileURLToPath(ownersUrl))) return {};
  const { readFileSync } = await import("node:fs");
  return JSON.parse(readFileSync(fileURLToPath(ownersUrl), "utf8"));
}

// scenario: { entry, state, viewport, theme, fixtures: "down"|"up"|"delay", aggregate? }
export function appliesTo(check, scenario) {
  if (check.aggregate) return false;
  if (check.entries && !check.entries.includes(scenario.entry)) return false;
  if (check.viewports && !check.viewports.includes(scenario.viewport)) return false;
  if (check.themes && !check.themes.includes(scenario.theme)) return false;
  // scenarios: an explicit list of { states, viewports?, entries?, fixtures? } (fixtures default "down"); used by rows whose
  // states mix fixture modes for the same state id (S01 down and the S17 sub-state S01 up).
  if (check.scenarios) return check.scenarios.some((spec) => matchesScenario(spec, scenario));
  // fixtures: one mode for every state, or a per-state map ({ S01: "down", S12: "delay" }) for rows whose states need
  // different fixtures (a state missing from the map uses "down").
  const declared = check.fixtures && typeof check.fixtures === "object" ? check.fixtures[scenario.state] ?? "down" : check.fixtures;
  const fixtures = declared ?? (Array.isArray(check.states) && check.states.includes("*") ? "any" : "down");
  if (fixtures !== "any" && fixtures !== scenario.fixtures) return false;
  const states = Array.isArray(check.states) ? check.states : check.states[scenario.viewport] ?? [];
  return states.includes("*") || states.includes(scenario.state);
}

export function makeImageCache(pngBytes) {
  let image = null;
  return () => {
    image ??= decode(pngBytes);
    return image;
  };
}

// The scenarios a run captures (visual-qa.mjs main loop): the chained states of each entry, S16 (Legacy, light theme) and
// S17's fixtures-up sub-states. stateIds/entries/viewports/themes come from parseArgs; fixtureLabel is "down" or "delay".
export function plannedScenarios({ entries, viewports, themes, stateIds, fixtureLabel }, { chainIds, vworldStateIds, s17SubStates }) {
  const out = [];
  for (const entry of entries) {
    const available = entry === "vworld" ? vworldStateIds : chainIds;
    for (const viewport of viewports) {
      for (const theme of themes) {
        for (const state of stateIds.filter((id) => available.includes(id))) out.push({ entry, viewport, theme, state, fixtures: fixtureLabel });
      }
      if (entry === "legacy" && stateIds.includes("S16")) out.push({ entry, viewport, theme: "light", state: "S16", fixtures: fixtureLabel });
      if (stateIds.includes("S17")) for (const theme of themes) for (const state of s17SubStates) out.push({ entry, viewport, theme, state, fixtures: "up" });
    }
  }
  return out;
}

// Without --only, a run requests the checks that apply to at least one scenario it captures (plus the aggregate rows,
// evaluated once at the end). A check that cannot apply to this run - a VWorld-only row in a Legacy run, a delayed-fixture
// row in a normal run, a light-theme row in a dark run - is not requested, so it is neither run nor counted as a FAIL.
// An explicit --only list stays as given: a listed id that never applies is still a FAIL.
export function defaultRequestedIds(checks, scenarios) {
  return [...checks.values()]
    .filter((check) => !check.id.startsWith("SMOKE-"))
    .filter((check) => check.aggregate || scenarios.some((scenario) => expandParts(check).some((part) => appliesTo(part, scenario))))
    .map((check) => check.id);
}

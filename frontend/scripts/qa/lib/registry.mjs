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

export async function loadChecks() {
  const checks = new Map(SMOKE_CHECKS.map((check) => [check.id, check]));
  const indexUrl = new URL("../checks/index.mjs", import.meta.url);
  if (existsSync(fileURLToPath(indexUrl))) {
    const { CHECKS } = await import(indexUrl.href);
    for (const [id, check] of CHECKS) checks.set(id, check);
  }
  return checks;
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
  const fixtures = check.fixtures ?? (Array.isArray(check.states) && check.states.includes("*") ? "any" : "down");
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

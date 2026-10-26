#!/usr/bin/env bun
// Visual QA harness: replays S01..S17 in Legacy/VWorld at D (1440x900 @1x) and P (390x844 @2x),
// runs the requested checks, compares each scenario with baselines.json and exits non-zero on any
// regression. See scripts/qa/README.md for the CLI and the exit-code contract.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, VIEWPORTS, DEFAULT_CLOCK, closeAllBrowsers, sleep } from "./lib/browser.mjs";
import { startVite, killAll } from "./lib/processes.mjs";
import { setFixtures, readFixtureRequests } from "./lib/fixtures.mjs";
import { inPage, decode } from "./lib/probe.mjs";
import { KEY_RECTS, compareScenario, dHashPng, loadBaselines, roundRect, saveBaselines, scenarioKey } from "./lib/baseline.mjs";
import { EXIT, exitCodeFor, rollupChecks, writeReport } from "./lib/report.mjs";
import { STATES, CHAIN_IDS, S17_SUBSTATES, VWORLD_STATE_IDS, parseStateList, stateById, loadAndSettle, applyTheme } from "./lib/states.mjs";
import { appliesTo, loadChecks, loadOwners, makeImageCache } from "./lib/registry.mjs";

const QA_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = path.join(QA_DIR, "baselines.json");

const FLAGS = {
  "--entry": "value", "--viewport": "value", "--theme": "value", "--states": "value", "--only": "value",
  "--out": "value", "--update-baseline": "bool", "--script": "value", "--url-suffix": "value", "--fail": "list",
  "--delay-ms": "value", "--hold-ms": "value", "--quality": "value", "--after-dir": "value", "--port": "value",
  "--clock": "value", "--sample-ms": "value", "--help": "bool",
};

class UsageError extends Error {}

export function parseArgs(argv) {
  const args = { fail: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [flag, inline] = raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, null];
    const kind = FLAGS[flag];
    if (!kind) throw new UsageError(`unknown flag ${raw}`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (kind === "bool") {
      args[key] = true;
      continue;
    }
    const value = inline ?? argv[++index];
    if (value == null || value.startsWith("--")) throw new UsageError(`missing value for ${flag}`);
    if (kind === "list") args[key].push(value);
    else args[key] = value;
  }
  const pick = (value, allowed, fallback, name) => {
    const chosen = value ?? fallback;
    if (chosen === "both") return allowed;
    if (!allowed.includes(chosen)) throw new UsageError(`invalid ${name} ${chosen}`);
    return [chosen];
  };
  args.entries = pick(args.entry, ["legacy", "vworld"], "legacy", "--entry");
  args.viewports = pick(args.viewport, ["D", "P"], "both", "--viewport");
  args.themes = pick(args.theme, ["dark", "light"], "dark", "--theme");
  try {
    args.stateIds = parseStateList(args.states);
  } catch (error) {
    throw new UsageError(error.message);
  }
  args.port = Number(args.port ?? 5181);
  args.delayMs = Number(args.delayMs ?? 0);
  args.holdMs = args.holdMs == null ? 150 : Number(args.holdMs);
  args.sampleShots = args.sampleMs ? args.sampleMs.split(",").map(Number) : [];
  if (args.quality && !["low", "medium", "high"].includes(args.quality)) throw new UsageError(`invalid --quality ${args.quality}`);
  if ([args.port, args.delayMs, args.holdMs, ...args.sampleShots].some((n) => !Number.isFinite(n))) throw new UsageError("numeric flag is not a number");
  args.out = path.resolve(args.out ?? path.join(process.cwd(), "visual-qa-out"));
  if (args.afterDir) args.afterDir = path.resolve(args.afterDir);
  args.script = args.script ? JSON.parse(readFileSync(args.script, "utf8")) : [];
  args.clock ??= DEFAULT_CLOCK;
  args.command = ["bun", "visual-qa.mjs", ...argv].join(" ");
  return args;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function runScript(ctx, stateId, baseUrl) {
  for (const block of ctx.args.script.filter((item) => item.state === stateId)) {
    for (const step of block.do ?? []) {
      if (step.tap) {
        const result = await ctx.b.tap(step.tap, step.text);
        ctx.actions.push(`script ${result.action}`);
      } else if (step.key) {
        await ctx.b.key(step.key);
        ctx.actions.push(`script key ${step.key}`);
      } else if (step.drag) {
        const [x, y, dx, dy] = step.drag;
        await ctx.b.mouse("mouseMoved", x, y, 0);
        await ctx.b.mouse("mousePressed", x, y, 1);
        for (let i = 1; i <= 10; i += 1) {
          await ctx.b.mouse("mouseMoved", x + (dx * i) / 10, y + (dy * i) / 10, 1);
          await sleep(40);
        }
        await ctx.b.mouse("mouseReleased", x + dx, y + dy, 0);
        ctx.actions.push(`script drag ${step.drag.join(",")}`);
      } else if (step.wait) {
        await sleep(step.wait);
        ctx.actions.push(`script wait ${step.wait} ms`);
      } else if (step.fixtures) {
        await setFixtures(baseUrl, step.fixtures);
        ctx.actions.push(`script fixtures ${JSON.stringify(step.fixtures)}`);
      }
    }
  }
}

async function applyQuality(ctx) {
  const mobileOpen = ctx.mobile && (await ctx.b.center('[aria-label="패널 열기"]'));
  if (mobileOpen) await ctx.b.tap('[aria-label="패널 열기"]');
  const opened = await ctx.b.tap('[aria-label="설정"]');
  await sleep(800);
  const picked = await ctx.b.tap(`[data-qa=render-quality-${ctx.args.quality}]`);
  await ctx.b.key("Escape");
  await sleep(600);
  ctx.actions.push(`quality ${ctx.args.quality}: ${opened.action}; ${picked.action}; Escape`);
}

async function main() {
  let args;
  let checks;
  try {
    args = parseArgs(process.argv.slice(2));
    checks = await loadChecks();
    args.onlyIds = args.only ? args.only.split(",").map((id) => id.trim()).filter(Boolean) : [...checks.keys()].filter((id) => !id.startsWith("SMOKE-"));
    const unknown = args.onlyIds.filter((id) => !checks.has(id));
    if (unknown.length) throw new UsageError(`unknown check id ${unknown.join(", ")}`);
  } catch (error) {
    if (error instanceof UsageError || error instanceof SyntaxError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(EXIT.USAGE);
    }
    throw error;
  }
  if (args.help) {
    log(readFileSync(path.join(QA_DIR, "README.md"), "utf8"));
    process.exit(EXIT.OK);
  }

  mkdirSync(args.out, { recursive: true });
  const owners = await loadOwners();
  const selected = args.onlyIds.map((id) => checks.get(id));
  const baselines = loadBaselines(BASELINE_FILE);
  const entries = [];
  const scenarios = [];
  const unavailableEntries = [];
  const runMemo = new Map();
  const fixtureMode = args.fail.length || args.delayMs ? "up" : "down";
  const fixtureLabel = args.delayMs ? "delay" : fixtureMode;

  const runnable = args.entries.filter((entry) => {
    if (entry === "vworld" && !process.env.VITE_VWORLD_API_KEY) {
      const reason = "VITE_VWORLD_API_KEY not set";
      unavailableEntries.push({ entry, reason });
      log(`SKIPPED: ${reason}`);
      return false;
    }
    return true;
  });

  let vite = null;
  try {
    if (runnable.length) {
      log(`vite: starting on 127.0.0.1:${args.port}`);
      const viteLog = path.join(args.out, "vite.log");
      writeFileSync(viteLog, "");
      vite = await startVite({ port: args.port, log: (chunk) => appendFileSync(viteLog, chunk) });
      await setFixtures(vite.baseUrl, { mode: fixtureMode, fail: args.fail, delayMs: args.delayMs });
    }
    for (const entry of runnable) {
      for (const viewportId of args.viewports) {
        for (const theme of args.themes) {
          const pass = { args, entry, viewport: VIEWPORTS[viewportId], theme, baseUrl: vite.baseUrl, selected, baselines, entries, scenarios, fixtureMode, fixtureLabel, runMemo };
          await runPass({ ...pass, mode: "capture" });
          // Checks that act on the page (taps, hover, time changes, media emulation) run in a second
          // replay so they can never leak into the captured frames or the baseline fingerprints.
          if (selected.some((check) => check.mutates)) await runPass({ ...pass, mode: "probe" });
        }
      }
    }
  } finally {
    closeAllBrowsers();
    if (vite) await vite.stop();
    killAll();
  }

  for (const check of selected.filter((item) => item.aggregate)) {
    entries.push(await evaluate(check, { entry: "all", state: "aggregate", viewport: "all", theme: "all", scenarioKey: null }, {
      args, entries, scenarios, outDir: args.out, unavailableEntries, runMemo,
    }));
  }

  if (args.updateBaseline) {
    for (const scenario of scenarios) baselines.scenarios[scenario.key] = { dhash: scenario.dhash, rects: scenario.rects };
    saveBaselines(BASELINE_FILE, baselines);
    log(`baselines: wrote ${scenarios.length} scenario(s) to ${path.relative(process.cwd(), BASELINE_FILE)}`);
  }

  const exitCode = exitCodeFor({ entries, scenarios, unavailableEntries, checks: rollupChecks(args.onlyIds, entries) });
  writeReport({ outDir: args.out, afterDir: args.afterDir, args, entries, scenarios, unavailableEntries, requestedIds: args.onlyIds, owners, exitCode });
  const failed = entries.filter((entry) => entry.pass !== true).length;
  const regressed = scenarios.filter((scenario) => scenario.baseline && !scenario.baseline.pass).length;
  log(`RESULT exit=${exitCode} scenarios=${scenarios.length} evaluations=${entries.length} fail=${failed} baseline-regressions=${regressed} out=${args.out}`);
  process.exit(exitCode);
}

async function evaluate(check, scenario, ctx) {
  const base = { id: check.id, entry: scenario.entry, state: scenario.state, viewport: scenario.viewport, theme: scenario.theme, scenarioKey: scenario.scenarioKey };
  try {
    const result = await check.run(ctx);
    if (!result || result.measured === undefined) return { ...base, pass: false, measured: "undefined measurement", expected: result?.expected ?? null };
    return { ...base, pass: result.pass === true, measured: result.measured, expected: result.expected ?? null };
  } catch (error) {
    return { ...base, pass: false, measured: `error: ${String(error?.message ?? error).slice(0, 200)}`, expected: check.doc ?? null };
  }
}

async function runPass({ args, entry, viewport, theme, baseUrl, selected, baselines, entries, scenarios, fixtureMode, fixtureLabel, runMemo, mode }) {
  log(`pass: ${entry} ${viewport.id} ${theme}${mode === "probe" ? " (probe replay for page-mutating checks)" : ""}`);
  const b = await Browser.open({ viewport, clock: args.clock, colorScheme: theme });
  const memo = new Map();
  const page = entry === "vworld" ? "/index-vworld.html" : "/";
  const ctx = {
    args, b, entry, theme, memo, viewport,
    mobile: viewport.mobile,
    map: viewport.mobile ? { x: Math.round(viewport.width / 2), y: Math.round(viewport.height * 0.47) } : { x: 500, y: Math.round(viewport.height * 0.47) },
    url: `${baseUrl}${page}${args.urlSuffix ?? ""}`,
    sampleShots: args.sampleShots,
    actions: [],
    stateLabel: null,
    quality: args.quality,
  };
  const prefix = entry === "vworld" ? "vworld-" : "";
  ctx.saveSample = async (label, offset) => {
    const file = `${prefix}${label.replace(".", "-")}-${viewport.id}-${ctx.currentTheme}-t${offset}.png`;
    writeFileSync(path.join(args.out, file), await b.screenshot());
    return file;
  };
  ctx.snapshot = async (name) => {
    memo.set(name, { png: await b.screenshot(), chips: await inPage(b, (qa) => qa.chips().map((el) => ({ text: qa.txt(el), rect: qa.r(el), pressed: el.getAttribute("aria-pressed") }))) });
  };

  const capture = async (state, label, fixtures) => {
    const themeLabel = state.forcedTheme ?? theme;
    ctx.currentTheme = themeLabel;
    const fileState = label.replace(".", "-");
    const file = `${prefix}${fileState}-${viewport.id}-${themeLabel}.png`;
    const origin = await b.evaluate("performance.timeOrigin");
    if (ctx.timeOrigin && origin !== ctx.timeOrigin && !ctx.actions.some((a) => a.startsWith("navigate"))) {
      ctx.actions.push("WARNING: the page reloaded since the previous state (see vite.log)");
    }
    ctx.timeOrigin = origin;
    const png = await b.screenshot();
    const key = scenarioKey({ entry, state: fileState, viewport: viewport.id, theme: themeLabel });
    if (mode === "capture") {
      writeFileSync(path.join(args.out, file), png);
      const rects = {};
      for (const [name, selector] of Object.entries(KEY_RECTS)) rects[name] = roundRect(await inPage(b, (qa, a) => qa.r(qa.one(a.sel)), { sel: selector }));
      const facts = await inPage(b, (qa) => {
        const owners = qa.all("*").filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY)).map((el) => ({
          qa: el.getAttribute("data-qa") ?? el.closest("[data-qa]")?.getAttribute("data-qa") ?? null,
          cls: (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(" "),
          visible: qa.visible(el),
          scrolls: el.scrollHeight > el.clientHeight,
        }));
        const panel = qa.one("[data-qa=dashboard-panel]");
        const pr = panel?.getBoundingClientRect();
        const dialog = qa.all("[role=dialog]").find(qa.visible);
        return {
          scrollOwners: owners,
          visible: {
            panel: pr ? (pr.right > 0 && pr.left < innerWidth && pr.width > 0 ? `open ${Math.round(Math.min(pr.right, innerWidth) - Math.max(pr.left, 0))}px` : "closed") : "absent",
            tab: qa.all("[data-qa^=dashboard-tab-]").find((el) => el.getAttribute("aria-selected") === "true")?.textContent?.trim() ?? null,
            chips: qa.chips().length,
            selectedChip: qa.txt(qa.all("[data-qa=campus-label] button").find((el) => el.getAttribute("aria-pressed") === "true")) || null,
            dialog: dialog ? (dialog.getAttribute("aria-label") || qa.txt(dialog.querySelector("h1,h2,h3")) || "dialog").slice(0, 40) : null,
            banner: qa.txt(qa.one("[data-qa=weather-error-banner]")).slice(0, 40) || null,
            time: qa.txt(qa.one("[data-qa=time-slider-value]")) || null,
            theme: document.documentElement.dataset.theme ?? null,
          },
        };
      });
      const scenario = { key, file, dhash: dHashPng(png), rects, actions: ctx.actions, console: b.consoleSince(), scrollOwners: facts.scrollOwners, visible: facts.visible };
      if (!args.updateBaseline) scenario.baseline = compareScenario(scenario, baselines.scenarios[key]);
      scenarios.push(scenario);
      log(`  ${key}: ${file}${scenario.baseline ? (scenario.baseline.pass ? " baseline ok" : ` REGRESSION ${scenario.baseline.problems.map((p) => p.detail).join("; ")}`) : ""}`);
    }
    const scenarioInfo = { entry, state: state.id === "S17" ? label.split(".")[1] : label, viewport: viewport.id, theme: themeLabel, fixtures, scenarioKey: key };
    const checkCtx = {
      args, b, entry, viewport: viewport.id, theme: themeLabel, state: scenarioInfo.state, stateLabel: label, fixtures, memo, runMemo,
      scale: viewport.scale, width: viewport.width, height: viewport.height, mobile: viewport.mobile, map: ctx.map,
      png, image: makeImageCache(png), decode, baseUrl, outDir: args.out, file,
      inPage: (fn, a) => inPage(b, fn, a),
      screenshot: async () => decode(await b.screenshot()),
      setFixtures: (opts) => setFixtures(baseUrl, opts),
      restoreFixtures: () => setFixtures(baseUrl, { mode: fixtureMode, fail: args.fail, delayMs: args.delayMs }),
      readRequests: () => readFixtureRequests(baseUrl),
      sleep,
    };
    const applicable = selected.filter((check) => Boolean(check.mutates) === (mode === "probe") && appliesTo(check, { ...scenarioInfo, fixtures }));
    for (const check of applicable) {
      const result = await evaluate(check, scenarioInfo, checkCtx);
      entries.push(result);
      if (result.pass !== true) log(`    FAIL ${check.id}: ${JSON.stringify(result.measured).slice(0, 160)}`);
    }
    ctx.actions = [];
  };

  const runState = async (state, label, fixtures, requested) => {
    ctx.stateLabel = label;
    ctx.currentTheme = state.forcedTheme ?? theme;
    ctx.theme = state.forcedTheme ?? theme;
    await state.steps(ctx);
    if (label === "S01" && args.quality) await applyQuality(ctx);
    await runScript(ctx, label, baseUrl);
    if (requested) await capture(state, label, fixtures);
    else ctx.actions = [];
    if (state.after) await state.after(ctx);
    ctx.theme = theme;
  };

  try {
    const available = entry === "vworld" ? VWORLD_STATE_IDS : CHAIN_IDS;
    const chainWanted = args.stateIds.filter((id) => available.includes(id));
    if (chainWanted.length) {
      const last = Math.max(...chainWanted.map((id) => available.indexOf(id)));
      for (const id of available.slice(0, last + 1)) await runState(stateById(id), id, fixtureLabel, chainWanted.includes(id));
    }
    const s16Pass = args.themes.includes("light") ? theme === "light" : theme === args.themes[0];
    if (entry === "legacy" && args.stateIds.includes("S16") && s16Pass) await runState(stateById("S16"), "S16", fixtureLabel, true);
    if (entry === "legacy" && args.stateIds.includes("S17")) {
      await setFixtures(baseUrl, { mode: "up" });
      const lastSub = CHAIN_IDS.indexOf("S13");
      for (const id of CHAIN_IDS.slice(0, lastSub + 1)) {
        if (["S09", "S10", "S11", "S12"].includes(id)) continue;
        await runState(stateById(id), `S17.${id}`, "up", S17_SUBSTATES.includes(id));
      }
      await setFixtures(baseUrl, { mode: fixtureMode, fail: args.fail, delayMs: args.delayMs });
    }
    if (args.stateIds.includes("GALLERY")) {
      ctx.url = `${baseUrl}${page}?ui=gallery`;
      await runState({ id: "GALLERY", steps: async (c) => loadAndSettle(c, c.url) }, "GALLERY", fixtureLabel, true);
    }
  } finally {
    await b.close();
  }
}

export { applyTheme, STATES };

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`visual-qa failed: ${error?.stack ?? error}\n`);
    closeAllBrowsers();
    killAll();
    process.exit(EXIT.REGRESSION);
  });
}

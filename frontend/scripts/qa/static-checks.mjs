#!/usr/bin/env node
// Static half of the visual QA: the 101 "static (no viewport)" rows of DESIGN-AUDIT section 7 plus
// the token lint. No browser. Prints `PASS|FAIL <id> <count> <first path:line>` per rule and exits
// 1 on any FAIL. Pattern matching is done in-process (the rg/awk/ast-grep commands of the audit
// rows, transcribed); nested ternaries use ast-grep when the binary exists, else a regex fallback.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export function createContext(frontendDir = FRONTEND, options = {}) {
  const root = path.resolve(frontendDir, "..");
  const src = path.join(frontendDir, "src");
  const cache = new Map();
  const read = (rel) => {
    const abs = path.join(frontendDir, rel);
    if (!cache.has(abs)) cache.set(abs, existsSync(abs) ? readFileSync(abs, "utf8") : null);
    return cache.get(abs);
  };
  const walk = (dir) => {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) out.push(...walk(abs));
      else out.push(abs);
    }
    return out;
  };
  const files = walk(src).map((abs) => path.relative(frontendDir, abs).split(path.sep).join("/"));
  const evidenceDir = options.evidenceDir ?? process.env.QA_EVIDENCE_DIR ?? path.join(root, ".omo/ulw-research/20261025-091647/evidence");
  const astGrep = options.astGrep ?? ["ast-grep", "sg"].find((bin) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0) ?? null;
  return { frontendDir, root, src, read, files, evidenceDir, astGrep, readRoot: (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), "utf8") : null) };
}

// ---------------------------------------------------------------- helpers
const isTest = (file) => /\.test\.[a-z]+$/.test(file);
const isCode = (file) => /\.(jsx|mjs|js)$/.test(file);

function grepFile(ctx, rel, pattern) {
  const content = ctx.read(rel);
  if (content == null) return [];
  const hits = [];
  content.split("\n").forEach((line, index) => {
    const regex = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    const matches = line.match(regex);
    if (matches) for (let k = 0; k < matches.length; k += 1) hits.push(`${rel}:${index + 1}`);
  });
  return hits;
}

function grepFiles(ctx, files, pattern) {
  return files.flatMap((rel) => grepFile(ctx, rel, pattern));
}

function result(hits, { max = 0, note } = {}) {
  return { pass: hits.length <= max, count: hits.length, first: hits[0] ?? "-", note, hits };
}

function pureLoc(content) {
  let inBlock = false;
  let n = 0;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    if (!line) continue;
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*") || line.startsWith("{/*")) {
      if (!line.includes("*/")) inBlock = true;
      continue;
    }
    n += 1;
  }
  return n;
}

function locRule(rel, max) {
  return (ctx) => {
    const content = ctx.read(rel);
    if (content == null) return { pass: true, count: 0, first: `${rel} absent` };
    const loc = pureLoc(content);
    return { pass: loc <= max, count: loc, first: `${rel}:1` };
  };
}

function longLines(rel, max = 120) {
  return (ctx) => {
    const content = ctx.read(rel);
    if (content == null) return { pass: true, count: 0, first: `${rel} absent` };
    const hits = [];
    content.split("\n").forEach((line, index) => { if (line.length > max) hits.push(`${rel}:${index + 1}`); });
    return result(hits);
  };
}

function zeroMatches(rels, pattern) {
  return (ctx) => result(grepFiles(ctx, [].concat(rels), pattern));
}

// Block body after `catch (x) {` or `.catch((x) => {`, by brace matching.
function catchBlocks(content) {
  const blocks = [];
  const regex = /catch\s*\(\s*(\w*)\s*\)\s*\{|\.catch\(\s*\(?\s*(\w*)\s*\)?\s*=>\s*\{/g;
  let match;
  while ((match = regex.exec(content))) {
    let depth = 1;
    let index = regex.lastIndex;
    while (index < content.length && depth > 0) {
      if (content[index] === "{") depth += 1;
      else if (content[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ line: content.slice(0, match.index).split("\n").length, param: match[1] || match[2] || "", body: content.slice(regex.lastIndex, index - 1) });
  }
  return blocks;
}

// AUDIT rule: the handler tests the error (instanceof / .name === / status) and rethrows unknown
// errors, with no console.error.
function narrowedCatch(rel, { extra } = {}) {
  return (ctx) => {
    const content = ctx.read(rel);
    if (content == null) return { pass: true, count: 0, first: `${rel} absent` };
    const bad = catchBlocks(content).filter((block) => {
      const tests = /instanceof|\.name\s*===|\.status\b|\.code\s*===/.test(block.body);
      const rethrows = /\bthrow\b/.test(block.body);
      return !tests || !rethrows || /console\.error/.test(block.body);
    }).map((block) => `${rel}:${block.line}`);
    const base = result(bad);
    if (extra) {
      const more = extra(ctx, content);
      return { ...base, pass: base.pass && more.pass, count: base.count + (more.pass ? 0 : 1), first: base.first !== "-" ? base.first : more.first, note: more.note };
    }
    return base;
  };
}

const NESTED_TERNARY_RE = /\?[^?:;\n{}]*:[^?;\n{}]*\?[^?:;\n{}]*:/;

function nestedTernary(rel) {
  return (ctx) => {
    const content = ctx.read(rel);
    if (content == null) return { pass: true, count: 0, first: `${rel} absent` };
    if (ctx.astGrep) {
      const run = spawnSync(ctx.astGrep, ["run", "--pattern", "$A ? $B : $C ? $D : $E", "--json=compact", path.join(ctx.frontendDir, rel)], { encoding: "utf8" });
      if (run.status === 0 || run.stdout) {
        const hits = JSON.parse(run.stdout || "[]").map((hit) => `${rel}:${hit.range.start.line + 1}`);
        return result(hits, { note: "ast-grep" });
      }
    }
    const hits = [];
    content.split("\n").forEach((line, index) => {
      const code = line.replace(/\?\?|\?\./g, "  ");
      if (NESTED_TERNARY_RE.test(code)) hits.push(`${rel}:${index + 1}`);
    });
    return result(hits, { note: "regex fallback (ast-grep not installed)" });
  };
}

function all(...rules) {
  return (ctx) => {
    const results = rules.map((rule) => rule(ctx));
    const failing = results.filter((item) => !item.pass);
    return {
      pass: failing.length === 0,
      count: results.reduce((sum, item) => sum + (item.pass ? 0 : Math.max(1, item.count)), 0),
      first: (failing[0] ?? results[0]).first,
      note: results.map((item) => item.note).filter(Boolean).join("; ") || undefined,
    };
  };
}

function check(fn) {
  return (ctx) => fn(ctx);
}

function importsOf(content) {
  return [...content.matchAll(/import\s+[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

const ENTITY_FILES = ["VehicleEntity", "ScooterEntity", "PedestrianEntity", "TrafficEntity"].map((name) => `src/simulation/components/${name}.jsx`);
const ENERGY_CLIENTS = [
  "src/features/energy/analysis/analysisApi.mjs",
  "src/features/energy/campus/CampusComparisonPanel.jsx",
  "src/features/energy/dashboard/energyDashboardApi.mjs",
  "src/features/energy/editor/energyScenarioApi.mjs",
  "src/features/energy/installations/installationPlanApi.mjs",
];

const uiCode = (ctx) => ctx.files.filter((file) => isCode(file) && !isTest(file));
const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z-])/;
const HEX_ALLOW = (file) => file === "src/CityModel.jsx" || /\/lighting\/|\/postfx\/|\/scripts\//.test(file) || isTest(file);
const PALETTE_RE = /\b(text|bg|border|from|to)-(emerald|amber|red|slate|sky|blue|gray|zinc|neutral|stone)-\d{2,3}\b/;

function importantOutsideReducedMotion(ctx, files) {
  const hits = [];
  for (const rel of files) {
    const content = ctx.read(rel);
    if (content == null) continue;
    let depth = 0;
    let reducedDepth = -1;
    content.split("\n").forEach((line, index) => {
      if (/prefers-reduced-motion/.test(line) && line.includes("{")) reducedDepth = depth;
      if (line.includes("!important") && reducedDepth < 0) hits.push(`${rel}:${index + 1}`);
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (reducedDepth >= 0 && depth <= reducedDepth) reducedDepth = -1;
    });
  }
  return hits;
}

// ---------------------------------------------------------------- rules
export const RULES = [
  ["V-S-01", locRule("src/AppLegacy.jsx", 250)],
  ["V-S-02", locRule("src/features/energy/analysis/analysisContracts.mjs", 250)],
  ["V-S-03", check((ctx) => {
    const hits = ctx.files.filter((file) => file.endsWith(".css")).filter((file) => pureLoc(ctx.read(file)) > 250).map((file) => `${file}:1 (${pureLoc(ctx.read(file))} LOC)`);
    return result(hits);
  })],
  ["V-S-04", check((ctx) => {
    const content = ctx.read("src/AppLegacy.jsx") ?? "";
    const start = content.search(/(export default )?function App\s*\(/);
    if (start < 0) return { pass: true, count: 0, first: "App function absent" };
    let index = content.indexOf("{", content.indexOf(")", start));
    let depth = 0;
    const from = index;
    do {
      if (content[index] === "{") depth += 1;
      else if (content[index] === "}") depth -= 1;
      index += 1;
    } while (depth > 0 && index < content.length);
    const span = content.slice(from, index).split("\n").length;
    const line = content.slice(0, start).split("\n").length;
    return { pass: span <= 250, count: span, first: `src/AppLegacy.jsx:${line}` };
  })],
  ["V-S-05", zeroMatches("src/AppLegacy.jsx", /\/\/ const period/)],
  ["V-S-06", narrowedCatch("src/AppLegacy.jsx")],
  ["V-S-07", zeroMatches("src/simulation/components/NetworkDebugLayer.jsx", /\.catch\(\(\) => \{\}\)/)],
  ["V-S-08", all(zeroMatches("src/simulation/components/RouteEditorPanel.jsx", /\.catch\(\(\) => setQuality\(null\)\)/), check((ctx) => {
    const content = ctx.read("src/simulation/components/RouteEditorPanel.jsx") ?? "";
    const okBeforeJson = !/\.json\(\)/.test(content) || /\.ok\b/.test(content);
    return { pass: okBeforeJson, count: okBeforeJson ? 0 : 1, first: "src/simulation/components/RouteEditorPanel.jsx:1" };
  }))],
  ["V-S-09", narrowedCatch("src/simulation/components/RouteEditorPanel.jsx")],
  ["V-S-10", narrowedCatch("src/simulation/components/RouteEditorPanel.jsx")],
  ["V-S-11", narrowedCatch("src/simulation/components/TrafficSafetyPanel.jsx", {
    extra: (ctx) => {
      const hits = grepFile(ctx, "src/simulation/components/TrafficSafetyPanel.jsx", /set\w*\(\s*\w+\.message\s*\)|\{\s*\w*(err|error)\w*\.message\s*\}/);
      return { pass: hits.length === 0, first: hits[0] ?? "-" };
    },
  })],
  ["V-S-12", narrowedCatch("src/simulation/components/TrafficSimulationLayer.jsx")],
  ["V-S-13", narrowedCatch("src/features/energy/campus/CampusComparisonPanel.jsx")],
  ["V-S-14", narrowedCatch("src/AppLegacy.jsx")],
  ["V-S-15", narrowedCatch("src/features/energy/analysis/BuildingAnalysis.jsx")],
  ["V-S-16", narrowedCatch("src/features/energy/installations/InstallationPlanManager.jsx")],
  ["V-S-17", narrowedCatch("src/features/energy/installations/InstallationPlanManager.jsx")],
  ["V-S-18", narrowedCatch("src/features/energy/editor/RoofEditor.jsx")],
  ["V-S-19", narrowedCatch("src/features/energy/editor/RoofEditor.jsx", {
    extra: (ctx, content) => {
      const bodies = new Set(catchBlocks(content).map((block) => block.body.replace(/\s+/g, " ").trim()));
      return { pass: bodies.size <= 1, first: "src/features/energy/editor/RoofEditor.jsx:1", note: `${bodies.size} distinct catch bodies` };
    },
  })],
  ["V-S-20", narrowedCatch("src/features/energy/dashboard/useEnergyDashboard.js")],
  ["V-S-21", zeroMatches("src/features/energy/analysis/analysisApi.mjs", /response\.json\(\)\.catch\(\(\) => null\)/)],
  ["V-S-22", zeroMatches("src/features/energy/campus/CampusComparisonPanel.jsx", /response\.json\(\)\.catch\(\(\) => null\)/)],
  ["V-S-23", zeroMatches("src/features/energy/installations/installationPlanApi.mjs", /response\.json\(\)\.catch\(\(\) => null\)/)],
  ["V-S-24", zeroMatches("src/features/energy/installations/installationPlanEditorApi.mjs", /response\.json\(\)\.catch\(\(\) => null\)/)],
  ["V-S-25", zeroMatches("src/features/energy/dashboard/energyDashboardApi.mjs", /response\.json\(\)\.catch\(\(\) => null\)/)],
  ["V-S-26", zeroMatches("src/features/energy/editor/energyScenarioApi.mjs", /response\.json\(\)\.catch\(\(\) => null\)/)],
  ["V-S-27", check((ctx) => {
    if (!ENERGY_CLIENTS.some((file) => ctx.read(file) != null)) return { pass: true, count: 0, first: "energy clients absent" };
    const energy = ctx.files.filter((file) => file.startsWith("src/features/energy/") && isCode(file) && !isTest(file));
    const definers = energy.filter((file) => /response\.json\(\)\.catch/.test(ctx.read(file)));
    const importSets = ENERGY_CLIENTS.filter((file) => ctx.read(file) != null).map((file) => new Set(importsOf(ctx.read(file)).map((spec) => path.basename(spec))));
    const shared = definers.length === 1 && importSets.every((set) => set.has(path.basename(definers[0])) || set.has(path.basename(definers[0], path.extname(definers[0]))));
    return { pass: shared, count: definers.length, first: definers[0] ? `${definers[0]}:1` : "-", note: `${definers.length} modules define the json-catch helper` };
  })],
  ["V-S-28", zeroMatches("src/features/energy/campus/CampusComparisonPanel.jsx", /\bfetch\(/)],
  ["V-S-29", zeroMatches("src/simulation/components/NetworkDebugLayer.jsx", /\bfetch\(/)],
  ["V-S-30", zeroMatches("src/simulation/components/RouteEditorPanel.jsx", /\bfetch\(/)],
  ["V-S-31", zeroMatches("src/simulation/components/TrafficSimulationLayer.jsx", /\bfetch\(/)],
  ["V-S-32", zeroMatches("src/AppLegacy.jsx", /\bfetch\(/)],
  ["V-S-33", zeroMatches("src/simulation/components/NetworkDebugLayer.jsx", /ok\s*\?[^:]*:\s*Promise\.reject/)],
  ["V-S-34", check((ctx) => {
    const hits = grepFile(ctx, "src/AppLegacy.jsx", /<MetricCard\b.*\w+=\{[^}]*(\?\?|\?\s)/);
    return result(hits);
  })],
  ["V-S-35", nestedTernary("src/components/D4RoomGridSelect.jsx")],
  ["V-S-36", all(nestedTernary("src/components/D4RoomPopup.jsx"), check((ctx) => {
    const popup = ctx.read("src/components/D4RoomPopup.jsx");
    const grid = ctx.read("src/components/D4RoomGridSelect.jsx");
    if (popup == null || grid == null) return { pass: true, count: 0, first: "D4RoomPopup.jsx absent" };
    const a = new Set(importsOf(popup));
    const shared = importsOf(grid).some((spec) => a.has(spec) && /equip|format/i.test(spec));
    return { pass: shared, count: shared ? 0 : 1, first: "src/components/D4RoomPopup.jsx:1" };
  }))],
  ["V-S-37", nestedTernary("src/components/D4RoomGridScene.jsx")],
  ["V-S-38", nestedTernary("src/components/D4RoomGridScene.jsx")],
  ["V-S-39", nestedTernary("src/features/energy/analysis/analysisState.mjs")],
  ["V-S-40", nestedTernary("src/features/energy/domain/demand.mjs")],
  ["V-S-41", nestedTernary("src/features/energy/domain/d4Campus.mjs")],
  ["V-S-42", nestedTernary("src/features/energy/domain/d4Campus.mjs")],
  ["V-S-43", nestedTernary("src/features/energy/editor/RoofEditorScene.jsx")],
  ["V-S-44", all(nestedTernary("src/simulation/components/VehicleEntity.jsx"), check((ctx) => {
    const sim = ctx.files.filter((file) => file.startsWith("src/simulation/") && isCode(file) && !isTest(file));
    const defs = grepFiles(ctx, sim, /(const|let|var)\s+RISK_COLORS\b/);
    const present = ENTITY_FILES.filter((file) => ctx.read(file) != null);
    if (!present.length) return { pass: true, count: 0, first: "entity files absent" };
    const importers = present.filter((file) => /import[^;]*RISK_COLORS/.test(ctx.read(file)));
    const ok = defs.length === 1 && importers.length === present.length;
    return { pass: ok, count: ok ? 0 : Math.max(1, defs.length), first: defs[0] ?? `${present[0]}:1`, note: `${importers.length}/${present.length} entity files import RISK_COLORS; ${defs.length} definitions` };
  }))],
  ["V-S-45", all(nestedTernary("src/simulation/components/ScooterEntity.jsx"), check((ctx) => {
    const content = ctx.read("src/simulation/components/ScooterEntity.jsx");
    const ok = content == null || /import[^;]*RISK_COLORS/.test(content);
    return { pass: ok, count: ok ? 0 : 1, first: "src/simulation/components/ScooterEntity.jsx:1" };
  }))],
  ["V-S-46", all(nestedTernary("src/simulation/components/PedestrianEntity.jsx"), check((ctx) => {
    const content = ctx.read("src/simulation/components/PedestrianEntity.jsx");
    const ok = content == null || /import[^;]*RISK_COLORS/.test(content);
    return { pass: ok, count: ok ? 0 : 1, first: "src/simulation/components/PedestrianEntity.jsx:1" };
  }))],
  ["V-S-47", all(nestedTernary("src/simulation/components/TrafficEntity.jsx"), check((ctx) => {
    const sim = ctx.files.filter((file) => file.startsWith("src/simulation/") && !isTest(file));
    const hits = grepFiles(ctx, sim, /#ef233c|#dc2626/i);
    const inEntities = hits.filter((hit) => ENTITY_FILES.some((file) => hit.startsWith(file)));
    return { pass: hits.length <= 1 && inEntities.length === 0, count: hits.length, first: hits[0] ?? "-" };
  }))],
  ["V-S-48", nestedTernary("src/simulation/components/NetworkDebugLayer.jsx")],
  ["V-S-49", nestedTernary("src/simulation/components/TrafficSafetyPanel.jsx")],
  ["V-S-50", longLines("src/features/energy/campus/campusComparison.mjs")],
  ["V-S-51", longLines("src/features/energy/analysis/BuildingAnalysisPanels.jsx")],
  ["V-S-52", longLines("src/features/energy/analysis/BuildingAnalysisPanels.jsx")],
  ["V-S-53", longLines("src/features/energy/analysis/BuildingAnalysis.jsx")],
  ["V-S-54", check((ctx) => {
    const content = ctx.read("src/features/energy/installations/InstallationPlanManager.jsx");
    const ok = content == null || /RepresentativeToggle/.test(content);
    return { pass: ok, count: ok ? 0 : 1, first: "src/features/energy/installations/InstallationPlanManager.jsx:1" };
  })],
  ["V-S-55", check((ctx) => result(grepFile(ctx, "src/features/energy/editor/energyScenarioApi.mjs", /options\.buildingId \?\?/), { max: 1 }))],
  ["V-S-56", all(zeroMatches("src/features/energy/editor/energyScenarioApi.mjs", /\?\? "D4"/), check((ctx) => {
    const test = ctx.read("src/features/energy/editor/energyScenarioApi.test.mjs") ?? "";
    const ok = /buildingId/.test(test) && /rejects|throws/.test(test) && /without[^\n]*buildingId|buildingId[^\n]*required/i.test(test);
    return { pass: ok, count: ok ? 0 : 1, first: "src/features/energy/editor/energyScenarioApi.test.mjs:1" };
  }))],
  ["V-S-57", longLines("src/AppLegacy.jsx")],
  ["V-S-58", longLines("src/AppLegacy.jsx")],
  ["V-S-59", longLines("src/components/TimeSlider.jsx")],
  ["V-S-60", longLines("src/components/CameraPresetBar.jsx")],
  ["V-S-61", check((ctx) => {
    const seen = new Map();
    for (const file of ctx.files.filter((f) => f.startsWith("src/components/") && f.endsWith(".jsx"))) {
      for (const m of (ctx.read(file) ?? "").matchAll(/className="([^"]{200,})"/g)) {
        if (!seen.has(m[1])) seen.set(m[1], new Set());
        seen.get(m[1]).add(file);
      }
    }
    const dupes = [...seen.values()].filter((set) => set.size > 1).map((set) => `${[...set][0]}:1`);
    return result(dupes);
  })],
  ["V-S-62", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => f.startsWith("src/components/")), /lg 미만에서는 장면과 목록을 세로로 쌓고/), { max: 1 }))],
  ["V-S-63", check((ctx) => {
    const code = uiCode(ctx);
    const a = grepFiles(ctx, code, /(function|const) formatNumber\b/);
    const b = grepFiles(ctx, code, /(function|const) formatShortTime\b/);
    return { pass: a.length <= 1 && b.length <= 1, count: a.length + b.length, first: (a.length > 1 ? a : b)[0] ?? "-" };
  })],
  ["V-S-64", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => f.startsWith("src/components/")), /#3b82f6/i)))],
  ["V-S-65", zeroMatches("src/components/MicroclimatePanel.jsx", /#D32F2F|#1976D2/i)],
  ["V-S-66", zeroMatches("src/AppLegacy.jsx", /#[0-9a-fA-F]{6}\b/)],
  ["V-S-67", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => f.endsWith(".css")), /\.bg-white\b.*!important/)))],
  ["V-S-68", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => f.endsWith(".css")), /\.text-gray-800\b.*!important/)))],
  ["V-S-69", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => f.endsWith(".css")), /\.text-gray-500\b.*!important/)))],
  ["V-S-70", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => f.endsWith(".css")), /\.border-gray-100\b.*!important/)))],
  ["V-S-71", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => f.endsWith(".css")), /\.shadow-sm\b.*!important/)))],
  ["V-S-72", check((ctx) => result(grepFile(ctx, "src/settings/qualityPreset.mjs", /\btry\b/), { max: 1 }))],
  ["V-S-73", zeroMatches("src/AppLegacy.jsx", /탭 버튼 공통 스타일/)],
  ["V-S-74", zeroMatches("src/components/CameraPresetBar.jsx", /presets는 CAMERA_PRESETS/)],
  ["V-S-75", check((ctx) => {
    const lines = (ctx.read("src/AppLegacy.jsx") ?? "").split("\n");
    const start = lines.findIndex((line) => line.includes("클릭 없이 카메라가 건물 가까이"));
    if (start < 0) return { pass: true, count: 0, first: "comment block absent" };
    let end = start;
    while (end + 1 < lines.length && lines[end + 1].trim().startsWith("//")) end += 1;
    const size = end - start + 1;
    return { pass: size <= 2, count: size, first: `src/AppLegacy.jsx:${start + 1}` };
  })],
  ...["energyBalance", "generation", "roofContracts"].map((name, index) => [`V-S-${76 + index}`, check((ctx) => {
    const rel = `src/features/energy/domain/${name}.manual.mjs`;
    const present = ctx.read(rel) != null ? [`${rel}:1`] : [];
    const logs = grepFiles(ctx, ctx.files.filter((f) => f.endsWith(".mjs")), /console\.log/);
    return result([...present, ...logs]);
  })]),
  ["V-S-79", zeroMatches("src/AppLegacy.jsx", /setInterval/)],
  ["V-S-80", check((ctx) => {
    const content = ctx.read("src/simulation/components/TrafficSimulationLayer.jsx") ?? "";
    const hits = grepFile(ctx, "src/simulation/components/TrafficSimulationLayer.jsx", /setInterval\([^)]*\b(1000|[1-4]\d{3})\)|,\s*1000\s*\)/);
    return result(/\bfetch\(/.test(content) || /setInterval/.test(content) ? hits : []);
  })],
  ["V-S-81", check((ctx) => {
    const tests = ctx.files.filter((f) => /\.test\.(jsx|mjs)$/.test(f));
    const hits = tests.filter((file) => [...(ctx.read(file) ?? "").matchAll(/\b(?:it|test)\(\s*["'`]([^"'`]+)["'`]/g)]
      .some((m) => /D4/.test(m[1]) && /(exit|leav|return|back|돌아|나가|복귀)/i.test(m[1]) && /(tab|탭)/i.test(m[1])));
    return { pass: hits.length > 0, count: hits.length, first: hits[0] ? `${hits[0]}:1` : "src:0 (no test names the D4 exit tab)" };
  })],
  ["V-F-01", check((ctx) => {
    const hits = grepFiles(ctx, uiCode(ctx), /#5e6ad2|#828fff|rgba\(94,\s*106,\s*210/i);
    const design = ctx.readRoot("DESIGN.md") ?? "";
    const css = ctx.files.filter((f) => f.endsWith(".css")).map((f) => ctx.read(f)).join("\n");
    const docPrimary = (design.match(/primary[^\n]*?(#[0-9a-fA-F]{6})/) ?? [])[1]?.toLowerCase();
    const cssPrimary = (css.match(/--colors-primary:\s*(#[0-9a-fA-F]{6})/) ?? [])[1]?.toLowerCase();
    const same = Boolean(docPrimary && cssPrimary && docPrimary === cssPrimary);
    return { pass: hits.length === 0 && same, count: hits.length + (same ? 0 : 1), first: hits[0] ?? `DESIGN.md primary ${docPrimary} vs css ${cssPrimary}` };
  })],
  ["V-F-02", check((ctx) => {
    const design = ctx.readRoot("DESIGN.md") ?? "";
    const section7 = design.split(/\n## /).find((part) => /^(7\.|7 )/.test(part)) ?? "";
    const config = ctx.read("tailwind.config.js") ?? "";
    const radius = (config.match(/borderRadius\s*:\s*\{([^}]*)\}/) ?? [])[1] ?? "";
    const lgOk = !/\blg\s*:/.test(radius) || /lg\s*:\s*["']var\(--rounded-lg\)["']/.test(radius);
    const listed = /rounded|radius/i.test(section7) && /\d+px/.test(section7);
    return { pass: listed && lgOk, count: (listed ? 0 : 1) + (lgOk ? 0 : 1), first: listed ? "tailwind.config.js:1" : `../DESIGN.md:${Math.max(1, design.split("\n").findIndex((l) => /^## 7/.test(l)) + 1)} (§7 lists no radius scale)` };
  })],
  ["V-F-03", check((ctx) => {
    const design = ctx.readRoot("DESIGN.md") ?? "";
    const css = ctx.files.filter((f) => f.endsWith(".css")).map((f) => ctx.read(f)).join("\n");
    const names = [...new Set([...css.matchAll(/(--(?:colors|spacing)-[\w-]+)\s*:/g)].map((m) => m[1]))];
    const undocumented = names.filter((name) => !design.includes(name) && !design.includes(name.replace(/^--(colors|spacing)-/, "")));
    const legacy = names.filter((name) => /inverse-|brand-secure|overlay|spacing-section/.test(name) && !design.includes(name));
    const bad = [...new Set([...undocumented, ...legacy])];
    const where = bad[0] ? grepFiles(ctx, ctx.files.filter((f) => f.endsWith(".css")), new RegExp(`${bad[0]}\\s*:`))[0] : null;
    return { pass: bad.length === 0, count: bad.length, first: bad[0] ? `${where ?? "src"} (${bad[0]} undocumented)` : "-" };
  })],
  ["V-F-04", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => /\.(jsx|mjs)$/.test(f) && !HEX_ALLOW(f)), HEX_RE)))],
  ["V-F-05", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /\b(text|bg|border)-(emerald|amber|red|slate|sky|blue|gray)-[0-9]{2,3}\b/)))],
  ["V-F-07", check((ctx) => {
    const important = grepFile(ctx, "src/index.css", /!important/);
    const sites = grepFiles(ctx, uiCode(ctx), /\b(shadow-sm|bg-white|text-gray-800)\b/);
    return result([...important, ...sites]);
  })],
  ["V-F-08", check((ctx) => result(ctx.read("src/App.css") != null ? ["src/App.css:1"] : []))],
  ["V-F-09", check((ctx) => {
    const code = uiCode(ctx);
    const unused = ["MiniStatusWidget", "AlertBadge", "BuildingSectionView"].filter((name) => {
      const file = `src/components/${name}.jsx`;
      if (ctx.read(file) == null) return false;
      return !code.some((other) => other !== file && new RegExp(`import[^;]*\\b${name}\\b`).test(ctx.read(other)));
    }).map((name) => `src/components/${name}.jsx:1`);
    const agents = ctx.read("AGENTS.md") ?? "";
    const named = /D4SectionExperience/.test(agents);
    return { pass: unused.length === 0 && named, count: unused.length + (named ? 0 : 1), first: unused[0] ?? "frontend/AGENTS.md:1" };
  })],
  ["V-F-10", check((ctx) => {
    const design = ctx.readRoot("DESIGN.md") ?? "";
    const code = uiCode(ctx);
    const missing = ["KpiTile", "Segmented", "StatusBadge", "SectionHeader", "Alert"].filter((name) => {
      const defs = grepFiles(ctx, code, new RegExp(`export (function|const) ${name}\\b`));
      return defs.length !== 1 || !design.includes(name);
    });
    return { pass: missing.length === 0, count: missing.length, first: missing[0] ? `src/ui:0 (${missing[0]} not defined once or not in DESIGN.md §5)` : "-" };
  })],
  ["V-F-21", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => !isTest(f)), /#000000|bg-black\//)))],
  ["V-F-24", check((ctx) => {
    const files = ctx.files.filter((f) => !isTest(f) && /\.(jsx|mjs|js|css)$/.test(f));
    const hits = [];
    for (const rel of files) {
      (ctx.read(rel) ?? "").split("\n").forEach((line, index) => {
        for (const m of line.matchAll(/letter-spacing\s*:\s*([^;"']+)|tracking-(\[[^\]]+\]|[a-z]+)/g)) {
          const value = (m[1] ?? m[2]).trim();
          if (/^(-0\.01em|0\.08em|var\(--tracking-[\w-]+\)|normal|0)$/.test(value) || /^\[(-0\.01em|0\.08em)\]$/.test(value)) continue;
          hits.push(`${rel}:${index + 1}`);
        }
      });
    }
    return result(hits);
  })],
  ["V-F-25", check((ctx) => {
    const display = grepFiles(ctx, ctx.files, /Linear_Display/);
    const html = ["index.html", "index-vworld.html"].map((f) => ctx.read(f) ?? "").join("\n");
    const thirdParty = /<link[^>]+(fonts\.googleapis|cdn\.jsdelivr|fonts\.gstatic)[^>]*>/.test(html);
    const css = ctx.files.filter((f) => f.endsWith(".css")).map((f) => ctx.read(f)).join("\n");
    const fontFace = /@font-face[^}]*font-display\s*:\s*swap/.test(css);
    const preload = /<link[^>]+rel=["']preload["'][^>]+Wanted/i.test(html);
    const problems = [...display, ...(thirdParty ? ["index.html: third-party font link"] : []), ...(fontFace ? [] : ["no @font-face with font-display: swap"]), ...(preload ? [] : ["no Wanted Sans preload"])];
    return result(problems);
  })],
  ["V-F-39", check((ctx) => {
    const jsx = ctx.files.filter((f) => f.endsWith(".jsx") && !isTest(f));
    const hits = grepFiles(ctx, jsx, /[●△↔—┄]|\p{Extended_Pictographic}/u);
    return result(hits, { note: "scripts/perfection/check-draft-guard.ts is not in this repository; emoji + glyph grep used" });
  })],
  ["V-F-40", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => f.endsWith(".jsx") && !isTest(f)), /—/), { note: "grep half; the per-line middle-dot count is a browser check" }))],
  ["V-F-66", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /\bz-\[?[0-9]+\]?|zIndexRange|zIndex\s*:\s*\d/)))],
  ["V-F-70", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /duration-(200|500)\b|PANEL_TRANSITION_MS\s*=\s*\d/)))],
  ["V-F-76", check((ctx) => {
    const hits = grepFiles(ctx, uiCode(ctx), /w-\[[0-9]+px\]|min-w-\[|max-w-\[|\b[0-9]+vw\b/);
    return result([...hits, ...grepFile(ctx, "src/index.css", /440px/)]);
  })],
  ["V-F-77", check((ctx) => {
    const hits = [];
    for (const rel of ["src/vworld/VWorldCampusStatus.jsx", "src/features/energy/representative/RepresentativePlanOverlayController.jsx"]) {
      const located = ctx.files.find((f) => f.endsWith(path.basename(rel))) ?? rel;
      (ctx.read(located) ?? "").split("\n").forEach((line, index) => {
        const m = line.match(/className\s*=\s*["'`]([^"'`]*)["'`]/);
        if (m && /\b(absolute|bottom-|left-|max-w)/.test(m[1]) && /\(\s*\{|,\s*className\s*=/.test(line)) hits.push(`${located}:${index + 1}`);
      });
    }
    return result(hits);
  })],
  ["V-F-78", check((ctx) => {
    const dir = path.join(ctx.evidenceDir, "before");
    if (!existsSync(dir)) return { pass: false, count: 1, first: `${dir}:0 (missing)` };
    const pngs = new Set(readdirSync(dir).filter((f) => f.endsWith(".png")));
    const need = [];
    for (let n = 1; n <= 12; n += 1) for (const vp of ["D", "P"]) need.push(`S${String(n).padStart(2, "0")}-${vp}-light.png`);
    need.push("S13-D-dark.png", "S14-D-dark.png", "S15-D-dark.png", "S17-S01-D-dark.png");
    const missing = need.filter((file) => !pngs.has(file));
    return { pass: missing.length === 0, count: missing.length, first: missing[0] ? `${dir}/${missing[0]}:0 (missing)` : "-" };
  })],
  ["V-Q-06", check((ctx) => {
    const design = ctx.readRoot("DESIGN.md") ?? "";
    const layouts = design.split("\n").filter((line) => line.startsWith("Layout:")).length;
    const probe = path.join(ctx.evidenceDir, "before", "scroll-owners.json");
    let owners = false;
    if (existsSync(probe)) {
      const data = JSON.parse(readFileSync(probe, "utf8"));
      owners = Object.values(data.states ?? data).every((value) => Array.isArray(value.owners ?? value) && (value.owners ?? value).length >= 1);
    }
    return { pass: layouts >= 5 && owners, count: (layouts >= 5 ? 0 : 1) + (owners ? 0 : 1), first: layouts >= 5 ? `${probe}:0` : `../DESIGN.md:0 (${layouts} Layout: lines)` };
  })],
  ["LINT-hex", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => isCode(f) && !HEX_ALLOW(f)), HEX_RE)))],
  ["LINT-palette", check((ctx) => result(grepFiles(ctx, uiCode(ctx), PALETTE_RE)))],
  ["LINT-text-px", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /text-\[\d+px\]/)))],
  ["LINT-rounded-px", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /rounded-\[\d+px\]/)))],
  ["LINT-z-arbitrary", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /z-\[\d+\]/)))],
  ["LINT-tracking", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /tracking-\[/)))],
  ["LINT-shadow", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /shadow-\[/)))],
  ["LINT-font-weight", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /font-\[\d+\]/)))],
  ["LINT-font-black", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /\bfont-black\b/)))],
  ["LINT-important", check((ctx) => result(importantOutsideReducedMotion(ctx, ctx.files.filter((f) => !isTest(f) && /\.(css|jsx|mjs|js)$/.test(f)))))],
  ["LINT-em-dash", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /—/)))],
  ["LINT-glyph", check((ctx) => result(grepFiles(ctx, ctx.files.filter((f) => f.endsWith(".jsx") && !isTest(f)), /[●△↔┄]/)))],
  ["LINT-console-log", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /console\.log/)))],
  ["LINT-reload", check((ctx) => result(grepFiles(ctx, uiCode(ctx), /window\.location\.reload/)))],
];

export const STATIC_AUDIT_IDS = RULES.map(([id]) => id).filter((id) => !id.startsWith("LINT-"));
export const LINT_IDS = RULES.map(([id]) => id).filter((id) => id.startsWith("LINT-"));

export function runStaticChecks(ctx, only) {
  const wanted = only ? new Set(only) : null;
  return RULES.filter(([id]) => !wanted || wanted.has(id)).map(([id, rule]) => {
    try {
      return { id, ...rule(ctx) };
    } catch (error) {
      return { id, pass: false, count: 1, first: `error: ${error.message}` };
    }
  });
}

export function formatLine(row) {
  return `${row.pass ? "PASS" : "FAIL"} ${row.id} ${row.count} ${row.first}${row.note ? ` (${row.note})` : ""}`;
}

function main(argv) {
  let only = null;
  let json = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--only") only = argv[++i]?.split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--json") json = argv[++i];
    else {
      process.stderr.write(`unknown flag ${argv[i]}\n`);
      return 2;
    }
  }
  const known = new Set(RULES.map(([id]) => id));
  const unknown = (only ?? []).filter((id) => !known.has(id));
  if (unknown.length) {
    process.stderr.write(`unknown check id ${unknown.join(", ")}\n`);
    return 2;
  }
  const ctx = createContext();
  const rows = runStaticChecks(ctx, only);
  for (const row of rows) {
    process.stdout.write(`${formatLine(row)}\n`);
    // A narrowed run lists every location so a single planted violation is easy to find.
    if (only && !row.pass) for (const hit of (row.hits ?? []).slice(1)) process.stdout.write(`  at ${hit}\n`);
  }
  const failed = rows.filter((row) => !row.pass).length;
  process.stdout.write(`STATIC SUMMARY rules=${rows.length} pass=${rows.length - failed} fail=${failed} audit-ids=${rows.filter((r) => !r.id.startsWith("LINT-")).length} ast-grep=${ctx.astGrep ?? "absent (regex fallback)"}\n`);
  if (json) writeFileSync(json, `${JSON.stringify({ generatedAt: new Date().toISOString(), rows: rows.map(({ hits, ...row }) => row) }, null, 2)}\n`);
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

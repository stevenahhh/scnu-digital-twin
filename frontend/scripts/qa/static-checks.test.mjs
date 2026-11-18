import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LINT_IDS, RULES, STATIC_AUDIT_IDS, createContext, formatLine, runStaticChecks } from "./static-checks.mjs";

function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "qa-static-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const lines = (n, text = "const value = 1;") => Array.from({ length: n }, () => text).join("\n");
const long = `const longLine = "${"x".repeat(130)}";`;
const nested = "const tone = a ? 'x' : b ? 'y' : 'z';";
const badCatch = "try { run(); } catch (err) { console.error(err); setError(err.message); }";
const jsonNull = "const body = await response.json().catch(() => null);";
const bigClass = "a".repeat(10) + " " + "b".repeat(200);

const DIRTY = {
  "frontend/src/AppMain.jsx": [
    "export default function App() {", lines(260), "// const period = 1;", badCatch, "fetch('/x');",
    "<MetricCard value={live ? `${a}대` : \"-\"} />", long, "const bg = '#ffffff';", "// 탭 버튼 공통 스타일",
    "// 클릭 없이 카메라가 건물 가까이", "// line two", "// line three", "setInterval(tick, 1000);", "}",
  ].join("\n"),
  "frontend/src/features/energy/analysis/analysisContracts.mjs": lines(260),
  "frontend/src/index.css": [lines(260, ".a { color: red; }"), ".bg-white { background: red !important; }",
    ".text-gray-800 { color: red !important; }", ".text-gray-500 { color: red !important; }",
    ".border-gray-100 { border-color: red !important; }", ".shadow-sm { box-shadow: none !important; }",
    ":root { --colors-ghost: #000; --colors-primary: #3b82f6; width: 440px; }"].join("\n"),
  "frontend/src/simulation/components/NetworkDebugLayer.jsx": ["fetch('/a').then((r) => r.ok ? r.json() : Promise.reject(r)).catch(() => {});", nested].join("\n"),
  "frontend/src/simulation/components/RouteEditorPanel.jsx": ["fetch('/q').then((r) => r.json()).catch(() => setQuality(null));", "try { x(); } catch (e) { setErr(1); }"].join("\n"),
  "frontend/src/simulation/components/TrafficSafetyPanel.jsx": [badCatch, nested].join("\n"),
  "frontend/src/simulation/components/TrafficSimulationLayer.jsx": [badCatch, "fetch('/agents');", "setInterval(poll, 1000);"].join("\n"),
  "frontend/src/features/energy/campus/CampusComparisonPanel.jsx": [badCatch, jsonNull, "fetch('/rank');"].join("\n"),
  "frontend/src/features/energy/campus/campusComparison.mjs": long,
  "frontend/src/features/energy/analysis/BuildingAnalysis.jsx": [badCatch, long].join("\n"),
  "frontend/src/features/energy/analysis/BuildingAnalysisPanels.jsx": long,
  "frontend/src/features/energy/analysis/analysisApi.mjs": jsonNull,
  "frontend/src/features/energy/analysis/analysisState.mjs": nested,
  "frontend/src/features/energy/installations/InstallationPlanManager.jsx": badCatch,
  "frontend/src/features/energy/installations/installationPlanApi.mjs": jsonNull,
  "frontend/src/features/energy/installations/installationPlanEditorApi.mjs": jsonNull,
  "frontend/src/features/energy/dashboard/energyDashboardApi.mjs": jsonNull,
  "frontend/src/features/energy/dashboard/useEnergyDashboard.js": badCatch,
  "frontend/src/features/energy/editor/RoofEditor.jsx": ["try { a(); } catch (e) { setA(e); }", "try { b(); } catch (e) { setB(e); }"].join("\n"),
  "frontend/src/features/energy/editor/RoofEditorScene.jsx": nested,
  "frontend/src/features/energy/editor/energyScenarioApi.mjs": [jsonNull, "const a = options.buildingId ?? \"D4\";", "const b = options.buildingId ?? null;"].join("\n"),
  "frontend/src/features/energy/domain/demand.mjs": nested,
  "frontend/src/features/energy/domain/d4Campus.mjs": nested,
  "frontend/src/features/energy/domain/energyBalance.manual.mjs": "console.log(1);",
  "frontend/src/features/energy/domain/generation.manual.mjs": "console.log(2);",
  "frontend/src/features/energy/domain/roofContracts.manual.mjs": "console.log(3);",
  "frontend/src/components/D4RoomGridSelect.jsx": [nested, `<div className="${bigClass}" />`].join("\n"),
  "frontend/src/components/D4RoomPopup.jsx": nested,
  "frontend/src/components/D4RoomGridScene.jsx": nested,
  "frontend/src/components/D4WingFloorSelect.jsx": [`<div className="${bigClass}" />`, "// lg 미만에서는 장면과 목록을 세로로 쌓고", "// lg 미만에서는 장면과 목록을 세로로 쌓고"].join("\n"),
  "frontend/src/components/TimeSlider.jsx": long,
  "frontend/src/components/CameraPresetBar.jsx": [long, "// presets는 CAMERA_PRESETS"].join("\n"),
  "frontend/src/components/MicroclimatePanel.jsx": "const c = '#D32F2F'; function formatNumber() {}",
  "frontend/src/components/MiniStatusWidget.jsx": "export function MiniStatusWidget() { return null; }",
  "frontend/src/components/Dirty.jsx": [
    "function formatNumber() {}", "const c = '#3b82f6'; const p = '#5e6ad2'; const k = '#000000';",
    "<div className=\"text-red-600 text-[13px] rounded-[16px] z-[100] tracking-[0.2em] shadow-[0_0_0] font-[800] font-black duration-500 w-[340px] bg-white\">● — x</div>",
    "<p style={{ fontFamily: 'Linear_Display' }} />", "console.log('x'); window.location.reload();",
  ].join("\n"),
  "frontend/src/simulation/components/VehicleEntity.jsx": nested,
  "frontend/src/simulation/components/ScooterEntity.jsx": "const c = risk === 'high' ? '#ef233c' : null;",
  "frontend/src/simulation/components/PedestrianEntity.jsx": "const c = null;",
  "frontend/src/simulation/components/TrafficEntity.jsx": `${nested} const d = '#dc2626';`,
  "frontend/src/settings/qualityPreset.mjs": "try { a(); } catch { } try { b(); } catch { }",
  "frontend/src/App.css": ".x{}",
  "frontend/src/vworld/VWorldCampusStatus.jsx": "export function VWorldCampusStatus({ className = \"absolute bottom-4 left-4\" }) { return null; }",
  "frontend/index.html": "<link href=\"https://cdn.jsdelivr.net/font.css\" rel=\"stylesheet\">",
  "frontend/tailwind.config.js": "module.exports = { theme: { extend: { borderRadius: { lg: '12px' } } } };",
  "frontend/AGENTS.md": "parked files",
  "DESIGN.md": "## 2. Colour\nprimary #3b82f6\n",
};

const CLEAN = {
  "frontend/src/ui/tokens.css": [
    ":root { --colors-primary: #5e6ad2; --spacing-md: 12px; }",
    "@font-face { font-family: \"Wanted Sans Variable\"; src: url(/fonts/WantedSansVariable.woff2) format(\"woff2\"); font-display: swap; }",
    "@media (prefers-reduced-motion: reduce) {", "  * { transition-duration: 0.01ms !important; }", "}",
  ].join("\n"),
  "frontend/src/ui/primitives.jsx": ["KpiTile", "Segmented", "StatusBadge", "SectionHeader", "Alert"].map((name) => `export function ${name}() { return null; }`).join("\n"),
  "frontend/src/AppMain.jsx": "export default function App() {\n  return null;\n}\n",
  "frontend/src/shell/AppShell.test.jsx": "it(\"keeps the 기본 현황 tab after leaving D4\", () => {});",
  "frontend/src/features/energy/editor/energyScenarioApi.test.mjs": "test(\"rejects a call without buildingId\", async () => { await assert.rejects(load({})); });",
  "frontend/index.html": "<link rel=\"preload\" as=\"font\" type=\"font/woff2\" crossorigin href=\"/fonts/WantedSansVariable.woff2\"><!-- Wanted -->",
  "frontend/tailwind.config.js": "module.exports = { theme: { borderRadius: { control: 'var(--rounded-control)' } } };",
  "frontend/AGENTS.md": "The live D4 path is D4SectionExperience.",
  "DESIGN.md": [
    "## 2. Colour", "- primary `#5e6ad2` (--colors-primary)", "- --spacing-md 12px",
    "## 4. Layout",
    ...["dashboard", "inspector", "D4 pane", "settings sheet", "presentation mode"].map((screen) => `Layout: ${screen} - fixed: hud; scroll owner: body; overlay stack: canvas < labels < hud < rail < modal`),
    "## 5. Components", "KpiTile, Segmented, StatusBadge, SectionHeader, Alert",
    "## 7. Radius", "control 6px, card 12px, pill 9999px", "",
  ].join("\n"),
};

function cleanEvidence() {
  const files = { "before/scroll-owners.json": JSON.stringify({ states: { S01: { owners: ["dashboard-panel"] } } }) };
  for (let n = 1; n <= 12; n += 1) for (const vp of ["D", "P"]) files[`before/S${String(n).padStart(2, "0")}-${vp}-light.png`] = "x";
  for (const name of ["S13-D-dark", "S14-D-dark", "S15-D-dark", "S17-S01-D-dark"]) files[`before/${name}.png`] = "x";
  return tree(files);
}

test("rule table covers exactly the 101 static audit rows plus the token lint", () => {
  assert.equal(STATIC_AUDIT_IDS.length, 101);
  assert.equal(new Set(RULES.map(([id]) => id)).size, RULES.length);
  assert.deepEqual(LINT_IDS, ["LINT-hex", "LINT-palette", "LINT-text-px", "LINT-rounded-px", "LINT-z-arbitrary", "LINT-tracking", "LINT-shadow", "LINT-font-weight", "LINT-font-black", "LINT-important", "LINT-em-dash", "LINT-glyph", "LINT-console-log", "LINT-reload"]);
});

test("a fixture tree with one planted violation per rule fails every rule with a path:line", () => {
  const root = tree(DIRTY);
  try {
    const rows = runStaticChecks(createContext(path.join(root, "frontend"), { evidenceDir: path.join(root, "missing-evidence"), astGrep: null }));
    const passing = rows.filter((row) => row.pass).map((row) => row.id);
    assert.deepEqual(passing, [], `rules that missed their planted violation: ${passing.join(", ")}`);
    for (const row of rows) assert.match(formatLine(row), /^FAIL \S+ \d+ \S+:\d+/, row.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a clean fixture tree passes every rule", () => {
  const root = tree(CLEAN);
  const evidence = cleanEvidence();
  try {
    const rows = runStaticChecks(createContext(path.join(root, "frontend"), { evidenceDir: evidence, astGrep: null }));
    const failing = rows.filter((row) => !row.pass).map(formatLine);
    assert.deepEqual(failing, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(evidence, { recursive: true, force: true });
  }
});

test("--only narrows the run to the planted lint rules", () => {
  const root = tree({ "frontend/src/__lint_probe.jsx": "<div className=\"text-red-600\" style={{color:'#ff0000'}} />" });
  try {
    const rows = runStaticChecks(createContext(path.join(root, "frontend"), { astGrep: null }), ["LINT-hex", "LINT-palette"]);
    assert.deepEqual(rows.map((row) => [row.id, row.pass, row.first]), [
      ["LINT-hex", false, "src/__lint_probe.jsx:1"],
      ["LINT-palette", false, "src/__lint_probe.jsx:1"],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

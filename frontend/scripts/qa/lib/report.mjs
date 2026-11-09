// report.json, summary.md, optional per-id after images, and the regression exit contract.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const EXIT = Object.freeze({ OK: 0, REGRESSION: 1, USAGE: 2, ENTRY_UNAVAILABLE: 3 });

// 0 only when every requested check passed and every scenario matched its baseline.
// `checks` is the per-id rollup: a requested id that was never evaluated is a FAIL too, so the
// exit code can never be 0 while report.json holds a FAIL.
export function exitCodeFor({ usageError = false, entries = [], scenarios = [], unavailableEntries = [], checks = [] }) {
  if (usageError) return EXIT.USAGE;
  if (entries.some((entry) => entry.pass !== true)) return EXIT.REGRESSION;
  if (scenarios.length > 0 && checks.some((check) => check.pass !== true)) return EXIT.REGRESSION;
  if (scenarios.some((scenario) => scenario.baseline && scenario.baseline.pass !== true)) return EXIT.REGRESSION;
  if (unavailableEntries.length > 0) return EXIT.ENTRY_UNAVAILABLE;
  return EXIT.OK;
}

// One row per check id: FAIL when any evaluation failed or it was never evaluated. An `na` evaluation (a row that does not
// apply to the tablet viewport T) is neither a pass nor a fail: it is counted apart, and an id with only n/a rows reports
// pass with measured "n/a".
export function rollupChecks(requestedIds, entries) {
  return requestedIds.map((id) => {
    const all = entries.filter((entry) => entry.id === id);
    const rows = all.filter((entry) => !entry.na);
    const failures = rows.filter((entry) => entry.pass !== true);
    const onlyNa = rows.length === 0 && all.length > 0;
    return {
      id,
      pass: onlyNa || (rows.length > 0 && failures.length === 0),
      evaluations: rows.length,
      failures: failures.length,
      na: all.length - rows.length,
      measured: onlyNa ? all[0].measured : (failures[0] ?? rows[0])?.measured ?? "not evaluated",
      expected: (failures[0] ?? rows[0])?.expected ?? null,
    };
  });
}

function fmt(value) {
  const textValue = typeof value === "string" ? value : JSON.stringify(value);
  return String(textValue ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 1200);
}

export function renderSummary({ args, entries, checks, scenarios, unavailableEntries, owners = {}, exitCode }) {
  const lines = [];
  const failedEntries = entries.filter((entry) => entry.pass !== true);
  const regressions = scenarios.filter((scenario) => scenario.baseline && scenario.baseline.pass !== true);
  lines.push("# Visual QA summary", "");
  lines.push(`- command: \`${args.command}\``);
  lines.push(`- exit code: ${exitCode}`);
  lines.push(`- scenarios captured: ${scenarios.length}`);
  lines.push(`- check evaluations: ${entries.length} (${entries.length - failedEntries.length} pass, ${failedEntries.length} fail)`);
  lines.push(`- check ids: ${checks.length} (${checks.filter((c) => c.pass).length} pass, ${checks.filter((c) => !c.pass).length} fail)`);
  lines.push(`- baseline regressions: ${regressions.length}${args.updateBaseline ? " (baseline updated in this run)" : ""}`);
  for (const entry of unavailableEntries) lines.push(`- SKIPPED: ${entry.reason}`);
  lines.push("");
  if (regressions.length) {
    lines.push("## Baseline regressions", "", "| scenario | problem |", "|---|---|");
    for (const scenario of regressions) {
      for (const problem of scenario.baseline.problems) lines.push(`| ${scenario.key} | ${fmt(problem.detail)} |`);
      lines.push(`| ${scenario.key} | key rect shifts (px, limit 4): ${fmt(Object.entries(scenario.baseline.rectShifts ?? {}).map(([name, shift]) => `${name} ${shift}`).join(", "))} |`);
    }
    lines.push("");
  }
  const failedChecks = checks.filter((check) => !check.pass);
  if (failedChecks.length) {
    lines.push("## Failing checks by owning todo", "");
    const groups = new Map();
    for (const check of failedChecks) {
      const owner = owners[check.id] ?? "unassigned";
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner).push(check);
    }
    const order = [...groups.keys()].sort((a, b) => (Number(a) || 999) - (Number(b) || 999));
    for (const owner of order) {
      lines.push(`### todo ${owner}`, "", "| id | failing evaluations | measured | expected |", "|---|---|---|---|");
      for (const check of groups.get(owner)) {
        lines.push(`| ${check.id} | ${check.failures}/${check.evaluations} | ${fmt(check.measured)} | ${fmt(check.expected)} |`);
      }
      lines.push("");
    }
  }
  lines.push("## Scenarios", "", "| scenario | png | dHash | baseline | actions | console (new) |", "|---|---|---|---|---|---|");
  for (const scenario of scenarios) {
    const verdict = scenario.baseline ? (scenario.baseline.pass ? `match (${scenario.baseline.distance ?? 0} bits)` : "REGRESSION") : "updated";
    lines.push(`| ${scenario.key} | ${scenario.file} | ${scenario.dhash} | ${verdict} | ${fmt(scenario.actions.join("; "))} | ${fmt(scenario.console.join("; "))} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function describe(visible) {
  if (!visible) return "-";
  const parts = [`panel ${visible.panel}${visible.tab ? ` on ${visible.tab}` : ""}`, `${visible.chips} chips in view`];
  if (visible.selectedChip) parts.push(`selected chip ${visible.selectedChip}`);
  if (visible.dialog) parts.push(`dialog: ${visible.dialog}`);
  if (visible.banner) parts.push(`banner: ${visible.banner}`);
  if (visible.time) parts.push(`time ${visible.time}`);
  parts.push(`data-theme ${visible.theme}`);
  return parts.join("; ");
}

// One row per PNG in the screens.md format (state, viewport, theme, entry, what is visible, console).
export function renderIndex(scenarios) {
  const lines = ["# Captured frames", "", "| file | state | viewport | theme | entry | what is visible (from the DOM at capture) | console errors/warnings (new since previous capture) |", "|---|---|---|---|---|---|---|"];
  for (const s of scenarios) {
    const [entry, keyRest] = s.key.split("/");
    const rest = keyRest.split("@")[0];
    const m = rest.match(/^(.*)-(D|P|T)-(dark|light)$/);
    lines.push(`| \`${s.file}\` | ${m?.[1] ?? rest} | ${{ P: "390x844 @2x", T: "834x1194 @2x" }[m?.[2]] ?? "1440x900"} | ${m?.[3] ?? "-"} | ${entry} | ${fmt(describe(s.visible))} | ${fmt((s.console ?? []).join("<br>") || "none new")} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function writeReport({ outDir, afterDir, args, entries, scenarios, unavailableEntries, requestedIds, owners, exitCode }) {
  mkdirSync(outDir, { recursive: true });
  const checks = rollupChecks(requestedIds, entries);
  const report = {
    generatedAt: new Date().toISOString(),
    command: args.command,
    exitCode,
    entries: entries.map(({ id, entry, state, viewport, theme, pass, na, measured, expected }) => ({ id, entry, state, viewport, theme, pass, ...(na ? { na: true } : {}), measured, expected })),
    checks,
    scenarios: scenarios.map(({ key, file, dhash, rects, baseline, actions, console }) => ({ key, file, dhash, rects, baseline, actions, console })),
    unavailableEntries,
  };
  writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(outDir, "summary.md"), renderSummary({ args, entries, checks, scenarios, unavailableEntries, owners, exitCode }));
  writeFileSync(path.join(outDir, "scroll-owners.json"), `${JSON.stringify({ generatedAt: report.generatedAt, states: Object.fromEntries(scenarios.map((s) => [s.key, { owners: s.scrollOwners ?? [] }])) }, null, 2)}\n`);
  writeFileSync(path.join(outDir, "INDEX.md"), renderIndex(scenarios));
  if (afterDir) {
    mkdirSync(afterDir, { recursive: true });
    for (const entry of entries) {
      const scenario = scenarios.find((item) => item.key === entry.scenarioKey);
      if (!scenario) continue;
      const source = path.join(outDir, scenario.file);
      if (existsSync(source)) copyFileSync(source, path.join(afterDir, `${entry.id}-${path.basename(scenario.file)}`));
    }
  }
  return report;
}

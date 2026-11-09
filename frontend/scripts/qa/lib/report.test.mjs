import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EXIT, exitCodeFor, rollupChecks, writeReport } from "./report.mjs";

const pass = { id: "SMOKE-canvas", pass: true, measured: 1 };
const fail = { id: "GAP-01", pass: false, measured: { width: 440 } };
const matched = { key: "legacy/S01-D-dark", baseline: { pass: true, problems: [] } };
const drifted = { key: "legacy/S01-D-dark", baseline: { pass: false, problems: [{ detail: "dHash distance 12 bits > 8" }] } };

test("exit code mapping: 0 clean, 1 regression, 2 usage, 3 entry unavailable", () => {
  assert.equal(exitCodeFor({ entries: [pass], scenarios: [matched] }), EXIT.OK);
  assert.equal(exitCodeFor({ entries: [pass, fail], scenarios: [matched] }), EXIT.REGRESSION);
  assert.equal(exitCodeFor({ entries: [pass], scenarios: [drifted] }), EXIT.REGRESSION);
  assert.equal(exitCodeFor({ entries: [{ ...pass, pass: undefined }], scenarios: [] }), EXIT.REGRESSION);
  assert.equal(exitCodeFor({ usageError: true, entries: [pass] }), EXIT.USAGE);
  assert.equal(exitCodeFor({ entries: [pass], scenarios: [matched], unavailableEntries: [{ entry: "vworld" }] }), EXIT.ENTRY_UNAVAILABLE);
  assert.equal(exitCodeFor({ entries: [fail], unavailableEntries: [{ entry: "vworld" }] }), EXIT.REGRESSION);
  assert.equal(exitCodeFor({ entries: [pass], scenarios: [{ key: "x", baseline: undefined }] }), EXIT.OK, "baseline update runs carry no comparison");
  const neverEvaluated = rollupChecks(["SMOKE-canvas", "GAP-34"], [pass]);
  assert.equal(exitCodeFor({ entries: [pass], scenarios: [matched], checks: neverEvaluated }), EXIT.REGRESSION, "an unevaluated requested id is a FAIL");
  assert.equal(exitCodeFor({ entries: [], scenarios: [], checks: rollupChecks(["SMOKE-canvas"], []), unavailableEntries: [{ entry: "vworld" }] }), EXIT.ENTRY_UNAVAILABLE);
});

test("a requested id that was never evaluated rolls up as FAIL, never as skipped", () => {
  const rows = rollupChecks(["SMOKE-canvas", "GAP-05"], [pass]);
  assert.equal(rows[0].pass, true);
  assert.equal(rows[1].pass, false);
  assert.equal(rows[1].measured, "not evaluated");
});

test("tablet n/a rows are counted apart: they never fail an id and an id with only n/a rows reports n/a", () => {
  const na = { id: "IS-01", pass: true, na: true, measured: "n/a on T" };
  const [mixed] = rollupChecks(["IS-01"], [na, { id: "IS-01", pass: false, measured: { count: 24 } }]);
  assert.equal(mixed.pass, false);
  assert.equal(mixed.evaluations, 1);
  assert.equal(mixed.na, 1);
  assert.deepEqual(mixed.measured, { count: 24 });
  const [onlyNa] = rollupChecks(["IS-01"], [na]);
  assert.equal(onlyNa.pass, true);
  assert.equal(onlyNa.measured, "n/a on T");
  assert.equal(exitCodeFor({ entries: [na], scenarios: [matched], checks: [onlyNa] }), EXIT.OK);
});

test("writeReport emits report.json and summary.md with the failing rect and dHash distance", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-report-"));
  try {
    writeReport({
      outDir: dir, args: { command: "bun visual-qa.mjs", updateBaseline: false },
      entries: [pass], scenarios: [{ ...drifted, file: "S01-D-dark.png", dhash: "0", rects: {}, actions: [], console: [] }],
      unavailableEntries: [], requestedIds: ["SMOKE-canvas"], owners: {}, exitCode: 1,
    });
    const report = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8"));
    assert.equal(report.exitCode, 1);
    assert.equal(report.checks.length, 1);
    assert.match(readFileSync(path.join(dir, "summary.md"), "utf8"), /dHash distance 12 bits/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

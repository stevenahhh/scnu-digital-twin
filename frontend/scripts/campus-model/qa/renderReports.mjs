// Reducers preserve harness measurements; none of these modules renders on import.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const VR_KINDS = Object.freeze(["entrances", "site-detail", "free-standing"]);
const TOLERANCE_DEG = 1.5;

// Both render CLIs check the bytes served by their isolated QA server, rather
// than merely attaching the hash of a possibly unrelated file on disk.
export async function readRenderIdentity({ modelPath, modelUrl, runId }) {
  if (!runId?.trim()) throw new TypeError("render QA requires a runId");
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const packedGlbSha256 = hash(readFileSync(modelPath));
  const response = await fetch(modelUrl, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new RangeError(`candidate model unavailable: HTTP ${response.status}`);
  if (hash(Buffer.from(await response.arrayBuffer())) !== packedGlbSha256) {
    throw new RangeError("served model hash mismatch: QA server is not serving the candidate");
  }
  return { runId, packedGlbSha256 };
}

function sameIdentity(actual, expected, fields = ["runId", "packedGlbSha256"]) {
  for (const field of fields) {
    if (!expected?.[field] || actual?.[field] !== expected[field]) {
      throw new RangeError(`QA identity mismatch: ${field}`);
    }
  }
}

export function aggregateVrBearings({ identity, reports, knownExceptions = [] }) {
  sameIdentity(identity, identity);
  const rows = [], notRun = [], kinds = {};
  for (const kind of VR_KINDS) {
    const report = reports[kind];
    const path = `vr/${kind}/bearings.json`;
    if (!report) {
      const reason = "harness report not produced for this run";
      notRun.push({ kind, reason, path });
      kinds[kind] = { status: "notRun", pass: false, rawPass: null, path, reason };
      continue;
    }
    sameIdentity(report.identity, identity);
    if (report.toleranceDeg !== TOLERANCE_DEG || !Array.isArray(report.rows)) {
      throw new TypeError(`${kind}: malformed bearings report or changed tolerance`);
    }
    const kindRows = report.rows.map(row => {
      let status, reason = row.reason ?? null;
      if (row.mappingErrors?.length || row.reason === "object_not_visible" ||
          row.col != null && (row.maskPixels === 0 || row.renderCol === null)) {
        status = "error";
        reason = row.mappingErrors?.length ? row.mappingErrors.join("; ") : "missing rendered object mask";
      } else if (row.tier === "T4" || !Number.isFinite(row.residualDeg)) {
        status = "unavailable";
        reason ??= "no independent measurable correspondence";
      } else if (Math.abs(row.residualDeg) > TOLERANCE_DEG) {
        status = "over";
      } else if (row.pass === true) {
        status = "pass";
      } else {
        status = "error";
        reason ??= "harness rejected correspondence";
      }
      const knownException = status === "over" ? knownExceptions.find(e =>
        e.kind === kind && e.id === row.id && e.scene === row.scene && e.face === row.face &&
        e.reason?.trim() && e.evidence?.trim() &&
        Number.isFinite(e.maxAbsResidualDeg) && Math.abs(row.residualDeg) <= e.maxAbsResidualDeg) ?? null : null;
      return { ...row, rawPass: row.pass ?? null, pass: status === "pass",
        kind, status, reason, knownException, reportPath: path };
    });
    rows.push(...kindRows);
    if (!kindRows.length) notRun.push({ kind, reason: "harness produced no observations", path });
    kinds[kind] = { path, rawPass: report.pass, checked: kindRows.length,
      pass: report.pass === true && kindRows.length > 0 && kindRows.every(r => r.status === "pass") };
  }
  return {
    schemaVersion: 1, identity, toleranceDeg: TOLERANCE_DEG, estimated: true,
    pass: VR_KINDS.every(kind => kinds[kind].pass), kinds, rows, notRun,
    counts: {
      checked: rows.filter(r => r.status === "pass" || r.status === "over").length,
      unknown: rows.filter(r => r.status === "unavailable").length,
      over: rows.filter(r => r.status === "over").length,
      errors: rows.filter(r => r.status === "error").length, notRun: notRun.length,
    },
    overTolerance: rows.filter(r => r.status === "over"),
    errors: rows.filter(r => r.status === "error"),
    unavailable: rows.filter(r => r.status === "unavailable"),
  };
}

// The integrator runs compare-vr --out <qaDir>/vr/<kind> for each kind.
// Read-only consumption of those originals prevents one kind overwriting another.
export function collectVrBearings({ qaDir, identity, knownExceptions = [] }) {
  const reports = {};
  for (const kind of VR_KINDS) {
    const path = join(qaDir, "vr", kind, "bearings.json");
    if (existsSync(path)) reports[kind] = JSON.parse(readFileSync(path, "utf8"));
  }
  const report = aggregateVrBearings({ identity, reports, knownExceptions });
  mkdirSync(qaDir, { recursive: true });
  writeFileSync(join(qaDir, "vr-bearings.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

// Full-image and visible-ground are independent measurements of one candidate.
// A visible-ground pass never masks a full-image failure or a missing mode.
export function writeOverheadReports({ qaDir, identity, report, mapReport }) {
  sameIdentity(mapReport.identity, identity, ["runId", "rawGlbSha256"]);
  if (mapReport.identity.packedGlbSha256) sameIdentity(mapReport.identity, identity);
  if (report) sameIdentity(report.identity, identity);
  const { visibleGround, ...fullReport } = report ?? {};
  const overhead = {};
  const outputs = [];
  for (const [mode, value] of [["full", report ? fullReport : null], ["visible", visibleGround]]) {
    const path = `overhead/${mode}.json`;
    const valueReport = value ? { ...value, identity } : {
      identity, pass: false, status: "notRun", reason: `${mode} overhead report not produced for this run`,
    };
    const tiles = value?.tiles ?? [];
    const measured = tiles.filter(t => mode === "full" ? t.signal === true : ["PASS", "FAIL"].includes(t.verdict));
    const unknown = tiles.length - measured.length;
    const failed = measured.some(t => mode === "full" ? t.pass !== true : t.verdict === "FAIL");
    overhead[mode] = { path, rawPass: value?.pass ?? null,
      pass: value?.pass === true && measured.length > 0 && !failed,
      status: value ? "reported" : "notRun", checked: measured.length, unknown,
      ...(value ? {} : { reason: valueReport.reason }) };
    outputs.push([path, valueReport]);
  }
  mkdirSync(join(qaDir, "overhead"), { recursive: true });
  for (const [path, value] of outputs) writeFileSync(join(qaDir, path), `${JSON.stringify(value, null, 2)}\n`);
  const linked = { ...mapReport, identity, overhead };
  writeFileSync(join(qaDir, "map-compare.json"), `${JSON.stringify(linked, null, 2)}\n`);
  return linked;
}

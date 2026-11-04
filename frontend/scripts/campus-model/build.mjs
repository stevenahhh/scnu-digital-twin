#!/usr/bin/env bun
// Owns the complete build transaction. Raw bootstrap and pack never write public assets.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCandidate, publishCandidate } from "./qa/candidate.mjs";
import { assertRawDeterminism } from "./qa/determinism.mjs";
import { assertBuildInvariants, BuildInvariantError } from "./qa/invariants.mjs";
import { reduceQaReport } from "./qa/reportPolicy.mjs";
import { runMapComparison } from "./qa/mapReport.mjs";
import { collectVrBearings, writeOverheadReports } from "./qa/renderReports.mjs";
import { loadFacadeCoverage, unappliedFacadeWalls } from "./qa/facadeCoverage.mjs";
import { inspectDoor } from "./qa/facadeMesh.mjs";
import { DEFAULT_SHEET, openSheet } from "./lib/ngiiSheet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "../..");
const BUILD = join(HERE, ".build");
const QA = join(BUILD, "qa");
const args = process.argv.slice(2);
const parcelsArg = args.indexOf("--parcels");
const parcelsPath = parcelsArg < 0 ? join(HERE, "data/ground/parcels.json") : resolve(args[parcelsArg + 1]);
const json = file => JSON.parse(readFileSync(file, "utf8"));
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const save = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
const candidate = createCandidate();
const knownGaps = json(join(HERE, "qa/known-gaps.json"));
const reportNames = ["map-compare.json", "vr-bearings.json", "invariants.json"];
const inputHashes = {};
// Every local data input, including the AO state, belongs to this run.
function hashTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) hashTree(file);
    else if (entry.isFile()) inputHashes[file.slice(HERE.length + 1)] = hash(file);
  }
}
hashTree(join(HERE, "data"));
inputHashes["data/ground/parcels.json"] = hash(parcelsPath);
inputHashes["public/uni.glb"] = hash(join(FRONTEND, "public/uni.glb"));
inputHashes["perf/vr-stations.json"] = hash(join(HERE, "../perf/vr-stations.json"));
const source = Bun.spawn(["git", "rev-parse", "HEAD"], {
  cwd: FRONTEND, env: { ...process.env, GIT_MASTER: "1" }, stdin: "ignore", stdout: "pipe", stderr: "inherit",
});
const sourceRevision = (await new Response(source.stdout).text()).trim();
if (await source.exited !== 0) throw new Error("Cannot identify build source revision");
rmSync(QA, { recursive: true, force: true });
for (const name of reportNames) save(join(QA, name), {
  schemaVersion: 1, sourceRevision, inputHashes, candidate: candidate.dir,
  accepted: false, status: "notRun", reason: "build has not reached this check", overToleranceList: [],
});

async function command(script, options = [], allowQaFailure = false) {
  const child = Bun.spawn([process.execPath, join(HERE, script), ...options], {
    cwd: FRONTEND, env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit",
  });
  const exit = await child.exited;
  if (exit !== 0 && !(allowQaFailure && exit === 1)) throw new Error(`${script}: exit ${exit}`);
  return exit;
}

async function render(candidate, identity) {
  const { createServer } = await import("vite");
  const assets = new Map([
    ["/campus-v2.glb", candidate.packed], ["/campus-v2-height.bin", candidate.heightBin],
    ["/campus-v2-height.json", candidate.heightJson],
  ]);
  const server = await createServer({
    root: FRONTEND, server: { host: "127.0.0.1", port: 5242, strictPort: true, hmr: false },
    plugins: [{
      name: "qa-candidate",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const file = assets.get(req.url?.split("?")[0]);
          if (!file) return next();
          res.setHeader("Cache-Control", "no-store");
          res.end(readFileSync(file));
        });
      },
    }],
  });
  try {
    await server.listen();
    const common = ["--url", "http://127.0.0.1:5242/", "--model", candidate.packed, "--run-id", identity.runId];
    for (const [kind, file, flag] of [
      ["entrances", "data/buildings/entrances.json", "--bearings"],
      ["site-detail", "data/photo/site-detail-anchors.json", "--bearings"],
      ["free-standing", "data/free-standing-vr.json", "--free-standing"],
    ]) {
      const doc = json(join(HERE, file));
      const observations = kind === "free-standing" ? doc.records : doc.records.filter(r =>
        r.evidence.refs.some(ref => /^VR \w+ [frbl] col /.test(ref)));
      const scenes = [...new Set(kind === "free-standing" ? observations.map(r => r.scene)
        : observations.flatMap(r => r.evidence.refs.flatMap(ref => /^VR (\w+) [frbl] col /.exec(ref)?.slice(1) ?? [])))];
      const recordsPath = join(candidate.qaDir, "vr", kind, "input.json");
      save(recordsPath, { ...doc, records: observations });
      save(join(candidate.qaDir, "vr", kind, "unmeasured.json"), doc.records.filter(r => !observations.includes(r)).map(r => ({
        id: r.id, kind, status: "unavailable", residualDeg: null, pass: false,
        reason: r.reason ?? "source has no numerical VR column observation", evidence: r.evidence,
      })));
      if (!scenes.length) continue;
      await command("../perf/compare-vr.mjs", [...common, flag, ...scenes.flatMap(s => ["--scene", s]), "--port", "9382",
        "--bearing-records", recordsPath, "--out", join(candidate.qaDir, "vr", kind)], true);
    }
    await command("../perf/overhead-blend.mjs", [...common, "--visible-ground",
      "--out", join(candidate.qaDir, "overhead-render")], true);
  } finally {
    await server.close();
  }
}

try {
  const missing = [];
  for (const binary of ["node", "basisu", "uv"]) if (!Bun.which(binary)) missing.push(`tool:${binary}`);
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(chrome)) missing.push(chrome);
  if (!existsSync(DEFAULT_SHEET)) missing.push(DEFAULT_SHEET);
  for (const [kind, file] of [["entrances", "buildings/entrances.json"],
    ["site-detail", "photo/site-detail-anchors.json"], ["free-standing", "free-standing-vr.json"]]) {
    const doc = json(join(HERE, "data", file));
    const scenes = new Set(kind === "free-standing" ? doc.records.map(r => r.scene)
      : doc.records.flatMap(r => r.evidence.refs.flatMap(ref => /^VR (\w+) [frbl] col /.exec(ref)?.slice(1) ?? [])));
    for (const scene of scenes) for (const face of ["f", "r", "b", "l"]) {
      const image = join(HERE, ".cache/vr", scene, `pano_${face}.jpg`);
      if (!existsSync(image)) missing.push(image);
    }
  }
  if (missing.length) throw new Error(`build preflight missing: ${missing.join(", ")}`);
  const sheet = openSheet(DEFAULT_SHEET);
  sheet.close();
  console.log("BUILD_PREFLIGHT OK");
  await command("build-campus-model.mjs", ["--candidate-dir", candidate.dir, "--parcels", parcelsPath]);
  const firstHeight = [readFileSync(candidate.heightBin), readFileSync(candidate.heightJson)];
  await command("build-campus-model.mjs", ["--candidate-dir", candidate.dir, "--parcels", parcelsPath, "--repeat"]);
  const determinism = assertRawDeterminism(readFileSync(candidate.raw), readFileSync(candidate.repeatRaw));
  assertRawDeterminism(firstHeight[0], readFileSync(candidate.heightBin));
  assertRawDeterminism(firstHeight[1], readFileSync(candidate.heightJson));
  console.log(`RAW_DETERMINISM OK ${determinism.firstSha256}`);
  cpSync(join(candidate.dir, "markings.report.json"), join(BUILD, "markings.report.json"));
  await command("pack.mjs", ["--candidate-dir", candidate.dir]);
  await publishCandidate(candidate, {
    inputHashes, precompress: args.includes("--precompress"),
    async runChecks({ identity }) {
      const run = { runHash: identity.runId, sourceRevision, inputHashes,
        rawHash: identity.hashes.raw, packedHash: identity.hashes.packed };
      const renderIdentity = { runId: identity.runId, rawGlbSha256: identity.hashes.raw, packedGlbSha256: identity.hashes.packed };
      const results = [];
      const complete = (id, kind, entries, rest = {}) => ({ ...run, id, kind, status: "complete", entries, ...rest });
      const measured = (id, metric, value, threshold, operator, evidence, reason = null) =>
        ({ id, metric, value, threshold, operator, evidence, reason, status: "measured" });
      const unavailable = (id, reason, evidence) =>
        ({ id, metric: "available", value: null, threshold: null, status: "unknown", reason, evidence });
      const built = readFileSync(candidate.packed);
      const nodes = JSON.parse(built.subarray(20, 20 + built.readUInt32LE(12)).toString()).nodes;
      const facade = await loadFacadeCoverage();
      const door = await inspectDoor(candidate.packed);
      await command("qa/roofReport.mjs", [join(candidate.qaDir, "roofs.json")]);
      const roofs = json(join(candidate.qaDir, "roofs.json"));
      const invariantInput = json(join(candidate.dir, "invariant-inputs.json"));
      invariantInput.packApplications = facade.buildings.map(row => {
        const node = nodes.find(n => n.name === row.building);
        return { id: row.building, requested: [...row.requestedWalls, ...row.requestedSurfaceEdges],
          applied: [...(node?.extras?.facadeGridAppliedWalls ?? []), ...(node?.extras?.facadeGridAppliedSurfaceEdges ?? [])] };
      });
      invariantInput.determinism = { id: "raw", firstHash: identity.hashes.raw, secondHash: identity.hashes.repeatRaw };
      let invariant;
      try { invariant = assertBuildInvariants(invariantInput); }
      catch (error) {
        if (!(error instanceof BuildInvariantError)) throw error;
        invariant = error.report;
        console.error(error.message);
      }
      const invariantEntries = invariant.findings.map(f => ({ ...f, status: "error", operator: "eq" }));
      if (invariant.pass) invariantEntries.push(measured("invariants", "violations", 0, 0, "eq", "invariant-inputs.json"));
      invariantEntries.push(door.deltaSM === null
        ? { ...unavailable(door.id, "packed doorway patch missing", "packed facade door probe"), status: "error" }
        : measured(door.id, "doorCentreM", door.deltaSM, 0.3, "lte", "packed facade door probe"));
      invariantEntries.push(measured("facades", "unapplied", unappliedFacadeWalls(facade.buildings, nodes).length, 0, "eq", "packed node extras"));
      invariantEntries.push(measured("roofs", "outsideBuffer", roofs.totals.mainWingOutsideBuffer.length, 0, "eq", "roofs.json"));
      invariantEntries.push(measured("facades", "missingCoverage", facade.missingBuildings.length, 0, "eq", "facade source coverage"));
      invariantEntries.push(measured("facades", "misalignedDoors", facade.entrances.filter(e => e.status === "mismatch").length, 0, "eq", "facade source door cells"));
      results.push(complete("invariants", "invariants", invariantEntries));
      save(join(candidate.qaDir, "invariants.json"), { ...identity, sourceRevision, ...invariant, accepted: false,
        determinism, facade, door, roofs: "roofs.json", knownGaps, overToleranceList: invariant.findings });

      let map;
      try {
        map = await runMapComparison({ rawGlbPath: candidate.raw,
          meshReportPath: join(candidate.dir, "markings.report.json"), identity: renderIdentity });
        // Keep an unproven cause explicit, never turn it into an invented photographic explanation.
        for (const row of map.overToleranceList) row.reason ??=
          `${row.id}: current NGII/emitted-geometry comparison exceeds ${row.tier}; cause not established by the retained source evidence. See map objects and roadAcceptance; todo 24 remains incomplete.`;
        const entries = [];
        for (const row of [...map.objects, ...map.physicalCrossings]) {
          const evidence = `map-compare.json#${row.id}`;
          if (row.unmeasurable || row.occluded) {
            entries.push(unavailable(row.id, row.reason ?? row.unmeasurableReason ?? "occluded or unmeasurable map correspondence", evidence));
            continue;
          }
          const t = map.tolerances[row.tier];
          if (Number.isFinite(row.residual_m) && Number.isFinite(t?.residualM)) entries.push(measured(row.id, "residualM", row.residual_m, t.residualM, "lte", evidence, row.reason));
          if (Number.isFinite(row.iou) && Number.isFinite(t?.iou)) entries.push(measured(row.id, "iou", row.iou, t.iou, "gte", evidence, row.reason));
          if (Number.isFinite(row.support) && Number.isFinite(t?.support)) entries.push(measured(row.id, "support", row.support, t.support, "gte", evidence, row.reason));
        }
        results.push(complete("map", "map", entries, { acceptance: map.roadAcceptance }));
      } catch (error) {
        map = { identity: renderIdentity, status: "notRun", reason: error.message, overToleranceList: [] };
        results.push({ ...run, id: "map", kind: "map", status: "notRun", reason: error.message, entries: [] });
      }
      save(join(candidate.qaDir, "map-compare.json"), { ...map, ...identity, accepted: false });
      let renderError = null;
      try { await render(candidate, identity); }
      catch (error) { renderError = error.message; console.error(`RENDER_QA_ERROR ${renderError}`); }
      const vr = collectVrBearings({ qaDir: candidate.qaDir, identity: renderIdentity });
      const freeVr = json(join(HERE, "data/free-standing-vr.json")).records;
      for (const row of vr.overTolerance) row.reason ??= row.correspondenceReason ??
        (row.kind === "free-standing" ? freeVr.find(r => r.id === row.id)?.reason : null) ??
        `${row.id} ${row.scene}/${row.face}: ${knownGaps["19"].reason}`;
      const vrEntries = vr.rows.map(row => {
        const id = `${row.kind}/${row.id}/${row.scene}/${row.face}/${row.col}`;
        const evidence = `${row.reportPath}#${row.id}`;
        if (row.status === "unavailable") return unavailable(id, row.reason, evidence);
        if (row.status === "error") return { ...unavailable(id, row.reason, evidence), status: "error" };
        return measured(id, "bearingDeg", Math.abs(row.residualDeg), 1.5, "lte", evidence, row.reason);
      });
      vr.unmeasuredRecords = [];
      for (const kind of ["entrances", "site-detail", "free-standing"]) {
        const file = join(candidate.qaDir, "vr", kind, "unmeasured.json");
        if (existsSync(file)) vr.unmeasuredRecords.push(...json(file));
      }
      for (const row of vr.unmeasuredRecords) vrEntries.push(unavailable(`${row.kind}/${row.id}`, row.reason, `vr/${row.kind}/unmeasured.json`));
      for (const missing of vr.notRun) vrEntries.push(unavailable(missing.kind, renderError ?? missing.reason, missing.path));
      results.push(complete("vr", "vr", vrEntries));
      const overheadPath = join(candidate.qaDir, "overhead-render/overhead-blend.json");
      const overhead = existsSync(overheadPath) ? json(overheadPath) : null;
      map = writeOverheadReports({ qaDir: candidate.qaDir, identity: renderIdentity, report: overhead, mapReport: map });
      for (const [mode, value] of [["full", overhead], ["visible", overhead?.visibleGround]]) {
        const entries = (value?.tiles ?? []).map(tile => {
          const id = `${mode}/${tile.E0}/${tile.N0}`;
          const pass = mode === "full" ? tile.pass : tile.verdict === "PASS";
          const checked = mode === "full" ? tile.signal : ["PASS", "FAIL"].includes(tile.verdict);
          return checked ? measured(id, "pass", Number(pass), 1, "eq", `overhead/${mode}.json`,
            pass ? null : `${id}: current candidate's image comparison failed; no exact approved overage for this candidate.`)
            : unavailable(id, tile.reason ?? "tile has insufficient independent comparison signal", `overhead/${mode}.json`);
        });
        results.push(entries.length ? complete(`overhead-${mode}`, "overhead", entries)
          : { ...run, id: `overhead-${mode}`, kind: "overhead", status: "notRun", entries: [], reason: renderError ?? "harness did not produce tiles" });
      }
      const policy = reduceQaReport(run, results);
      save(join(candidate.qaDir, "policy.json"), policy);
      for (const [name, report, check] of [
        ["map-compare.json", map, "map"], ["vr-bearings.json", vr, "vr"],
        ["invariants.json", json(join(candidate.qaDir, "invariants.json")), "invariants"],
      ]) save(join(candidate.qaDir, name), { ...report, ...identity, sourceRevision,
        accepted: policy.accepted, checkAccepted: policy.checks.find(c => c.id === check).accepted,
        policy: "policy.json", knownGaps, overToleranceList: report.overToleranceList ?? report.overTolerance });
      console.log(`BUILD_QA accepted=${policy.accepted} status=${policy.status} checked=${policy.checked} unknown=${policy.unknown}`);
    },
  });
  console.log(`MODEL_BUILD OK ${candidate.dir}`);
} catch (error) {
  console.error(`${error.name}: ${error.message}`);
  for (const name of reportNames) {
    const file = join(candidate.qaDir, name);
    if (!existsSync(file)) save(file, { schemaVersion: 1, sourceRevision, inputHashes, accepted: false,
      status: "notRun", reason: error.message, overToleranceList: [] });
  }
  process.exitCode = 1;
} finally {
  if (existsSync(candidate.qaDir)) cpSync(candidate.qaDir, QA, { recursive: true });
  save(join(QA, "candidate.json"), { candidate: candidate.dir, sourceRevision, inputHashes });
}

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { aggregateVrBearings, collectVrBearings, readRenderIdentity, writeOverheadReports } from "./renderReports.mjs";

const identity = { runId: "run-28", rawGlbSha256: "raw", packedGlbSha256: "packed" };
const good = { id: "door", scene: "scene_e5", face: "r", col: 610, tier: "T2",
  residualDeg: .5, renderCol: 615, maskPixels: 100, mappingErrors: [], pass: true };
const report = rows => ({ identity, toleranceDeg: 1.5, rows, pass: rows.every(r => r.pass || r.tier === "T4") });
const reports = row => ({
  entrances: report([row]), "site-detail": report([{ ...good, id: "sign" }]),
  "free-standing": report([{ ...good, id: "bench" }]),
});

test("render identity hashes the served bytes and refuses a different local candidate", async t => {
  const dir = mkdtempSync(join(tmpdir(), "render-identity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const modelPath = join(dir, "candidate.glb");
  writeFileSync(modelPath, "abc");
  const result = await readRenderIdentity({ modelPath, modelUrl: "data:application/octet-stream,abc", runId: "one" });
  assert.deepEqual(result, { runId: "one", packedGlbSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
  await assert.rejects(readRenderIdentity({ modelPath, modelUrl: "data:application/octet-stream,old", runId: "one" }),
    /served model hash mismatch/);
});

for (const [name, changes, status] of [
  ["normal", {}, "pass"],
  ["new excess", { residualDeg: 1.501, pass: false }, "over"],
  ["wrong wall", { mappingErrors: ["expected E3 east, hit west"], pass: false }, "error"],
  ["missing mask", { maskPixels: 0, renderCol: null, residualDeg: null, pass: false, reason: "object_not_visible" }, "error"],
  ["T4", { tier: "T4", residualDeg: null, reason: "unrefined_station" }, "unavailable"],
  ["missing correspondence", { col: null, residualDeg: null, pass: false, reason: "ground base occluded" }, "unavailable"],
]) test(`VR aggregator distinguishes ${name} without laundering the harness result`, () => {
  const result = aggregateVrBearings({ identity, reports: reports({ ...good, ...changes }) });
  assert.equal(result.rows[0].status, status);
  assert.equal(result.rows[0].pass, status === "pass");
  assert.equal(result.pass, status === "pass");
  assert.equal(result.rows[0].residualDeg, changes.residualDeg === undefined ? .5 : changes.residualDeg);
  assert.equal(result.kinds.entrances.rawPass, report([{ ...good, ...changes }]).pass);
});

test("known excess retains raw false and the exact evidence rather than gaining a pass", () => {
  const result = aggregateVrBearings({ identity, reports: reports({ ...good, residualDeg: 2.12, pass: false }),
    knownExceptions: [{ kind: "entrances", id: "door", scene: "scene_e5", face: "r",
      maxAbsResidualDeg: 2.12, reason: "C2 correspondence unresolved", evidence: "task-26-gate" }] });
  assert.equal(result.pass, false);
  assert.equal(result.rows[0].pass, false);
  assert.equal(result.overTolerance[0].knownException.reason, "C2 correspondence unresolved");
  assert.equal(result.overTolerance[0].knownException.evidence, "task-26-gate");
});

test("an absent entire VR run produces three notRun findings and never a pass", () => {
  const result = aggregateVrBearings({ identity, reports: {} });
  assert.equal(result.pass, false);
  assert.deepEqual(result.notRun.map(r => r.kind), ["entrances", "site-detail", "free-standing"]);
  assert.deepEqual(result.counts, { checked: 0, unknown: 0, over: 0, errors: 0, notRun: 3 });
});

test("worsening a known excess remains a new over-tolerance result", () => {
  const result = aggregateVrBearings({ identity, reports: reports({ ...good, residualDeg: 2.121, pass: false }),
    knownExceptions: [{ kind: "entrances", id: "door", scene: "scene_e5", face: "r",
      maxAbsResidualDeg: 2.12, reason: "C2 correspondence unresolved", evidence: "task-26-gate" }] });
  assert.equal(result.overTolerance[0].knownException, null);
  assert.equal(result.overTolerance[0].residualDeg, 2.121);
  assert.equal(result.pass, false);
});

test("an empty harness pass remains notRun and cannot satisfy a missing kind", () => {
  const input = reports(good);
  input.entrances = report([]);
  const result = aggregateVrBearings({ identity, reports: input });
  assert.equal(result.pass, false);
  assert.deepEqual(result.notRun.map(r => r.kind), ["entrances"]);
});

for (const changed of [{ runId: "old" }, { packedGlbSha256: "old" }]) {
  test(`VR aggregator rejects stale ${Object.keys(changed)[0]}`, () => {
    const input = reports(good);
    input.entrances.identity = { ...identity, ...changed };
    assert.throws(() => aggregateVrBearings({ identity, reports: input }), /identity mismatch/);
  });
}

test("kind subdirectories are consumed separately and no raw harness result is overwritten", t => {
  const dir = mkdtempSync(join(tmpdir(), "vr-aggregate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [kind, value] of Object.entries(reports(good))) {
    mkdirSync(join(dir, "vr", kind), { recursive: true });
    writeFileSync(join(dir, "vr", kind, "bearings.json"), JSON.stringify(value));
  }
  const result = collectVrBearings({ qaDir: dir, identity });
  assert.deepEqual(result.rows.map(r => [r.kind, r.id]), [
    ["entrances", "door"], ["site-detail", "sign"], ["free-standing", "bench"],
  ]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "vr", "entrances", "bearings.json"))), report([good]));
  assert.equal(JSON.parse(readFileSync(join(dir, "vr-bearings.json"))).pass, true);
});

test("overhead full failure and visible success persist in separate files linked by map report", t => {
  const dir = mkdtempSync(join(tmpdir(), "overhead-reports-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = { identity, pass: false, thresholds: { passPx: 1 },
    tiles: [{ E0: 1, N0: 2, signal: true, pass: false, dx: -4, dy: -4 }],
    visibleGround: { pass: true, tiles: [{ E0: 1, N0: 2, verdict: "PASS", dx: 0, dy: 0 }] } };
  const map = writeOverheadReports({ qaDir: dir, identity, report: input,
    mapReport: { identity, objects: [], overTolerance: 0, roadAcceptance: { accepted: false } } });
  assert.equal(map.roadAcceptance.accepted, false);
  assert.equal(map.overhead.full.pass, false);
  assert.equal(map.overhead.visible.pass, true);
  assert.equal(JSON.parse(readFileSync(join(dir, map.overhead.full.path))).tiles[0].dx, -4);
  assert.equal(JSON.parse(readFileSync(join(dir, map.overhead.visible.path))).tiles[0].dx, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "map-compare.json"))).overhead, map.overhead);
});

test("overhead adapter refuses a different candidate instead of linking a stale pass", t => {
  const dir = mkdtempSync(join(tmpdir(), "overhead-stale-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => writeOverheadReports({ qaDir: dir, identity,
    mapReport: { identity }, report: { identity: { ...identity, packedGlbSha256: "old" }, pass: true, tiles: [] } }),
  /identity mismatch/);
});

test("overhead linking rejects a map report already bound to a different packed candidate", t => {
  const dir = mkdtempSync(join(tmpdir(), "map-overhead-stale-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => writeOverheadReports({ qaDir: dir, identity,
    mapReport: { identity: { ...identity, packedGlbSha256: "old" } },
    report: { identity, pass: true, tiles: [] } }), /identity mismatch/);
});

test("missing visible overhead is written as notRun rather than copying the full pass", t => {
  const dir = mkdtempSync(join(tmpdir(), "overhead-missing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = writeOverheadReports({ qaDir: dir, identity, mapReport: { identity },
    report: { identity, pass: true, tiles: [{ signal: true, pass: true, dx: 0, dy: 0 }] } });
  assert.equal(result.overhead.full.pass, true);
  assert.equal(result.overhead.visible.pass, false);
  assert.equal(JSON.parse(readFileSync(join(dir, result.overhead.visible.path))).status, "notRun");
});

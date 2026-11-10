import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { createMapComparison, readMapWindow, runMapComparison } from "./mapReport.mjs";

const owner = "JA_2222222222222222", crossing = `${owner}/crossing`;
const hashes = { "road-sections": "sections", junctions: "junctions", parcels: "parcels" };
function parkingFixture() {
  const input = fixture();
  const white = new Uint8Array(160 * 160);
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
    const E = (x + .5) / 8, N = 20 - (y + .5) / 8;
    if ([5, 7.5, 10].some(e => Math.abs(E - e) < .13) && N >= 5 && N <= 10) white[y * 160 + x] = 1;
  }
  input.sheet = { w: 160, h: 160, origin: [0, 20], gsdM: .125, paint: { white } };
  input.pieces = [];
  input.reference = null;
  input.meshReport.emission = { parts: [], summary: { pieces: 0 } };
  input.meshReport.paintEmission = [];
  input.parkingDoc = { lots: [{ id: "LOT_TEST", rows: [{
    id: "LOT_TEST/R1", backLine: { abs: [[5, 5], [10, 5]] }, side: 1,
    pitchM: 2.5, depthM: 5, count: 3, stalls: [], estimated: false,
    divider: { style: "single", widthM: .1, colour: "white" },
    evidence: { tier: "T1", refs: ["synthetic independent mask"] },
  }] }] };
  return input;
}

function emittedDivider(id, east, end = 10) {
  const ring = [[east - .05, 5], [east + .05, 5], [east + .05, end], [east - .05, end]].map(p => tmToScene(...p));
  return { id, triangles: [[ring[0], ring[1], ring[2]], [ring[0], ring[2], ring[3]]] };
}

test("F2 empty emission cannot pass parking records even with perfect photo support", () => {
  const report = createMapComparison(parkingFixture());
  const dividers = report.objects.filter(o => /\/D\d+$/.test(o.id));
  assert.equal(dividers.length, 3);
  for (const row of dividers) {
    assert.equal(row.notEmitted, true);
    assert.equal(row.error, true);
    assert.equal(row.over, true);
    assert.equal(row.residual_m, null);
    assert.equal(row.support, null);
  }
  assert.equal(report.objects.filter(o => o.id.includes("/missing@")).length, 3);
  assert.equal(report.parkingRows[0].visibleDividers, 0);
});

test("F2 suppressed parking is a reasoned not-emitted gap, never measured", () => {
  const input = parkingFixture();
  input.paintSuppressed = [{ id: "LOT_TEST/R1/D0", reason: "aerial and VR cannot establish this paint" }];
  const report = createMapComparison(input);
  const row = report.objects.find(o => o.id === "LOT_TEST/R1/D0");
  assert.equal(row.notEmitted, true);
  assert.equal(row.suppressed, true);
  assert.equal(row.error, false);
  assert.equal(row.reason, input.paintSuppressed[0].reason);
  assert.equal(row.residual_m, null);
  assert.equal(row.support, null);
});

test("F2 partial parking emission measures only present geometry and exposes clipped lines", () => {
  const input = parkingFixture();
  input.meshReport.paintEmission = [
    emittedDivider("LOT_TEST/R1/D0", 5.5),
    emittedDivider("LOT_TEST/R1/D1", 7.5, 6),
  ];
  const report = createMapComparison(input);
  const get = id => report.objects.find(o => o.id === `LOT_TEST/R1/${id}`);
  assert.ok(get("D0").residual_m > .3, "displaced emission must not inherit the planned line's zero residual");
  assert.equal(get("D0").over, true);
  assert.equal(get("D1").unmeasurable, true);
  assert.equal(get("D1").support, null);
  assert.equal(get("D2").notEmitted, true);
  assert.ok(report.objects.some(o => o.id.includes("/missing@")), "unemitted lines cannot explain photo ridges");
});

test("parking line clipping within the scoring trim remains a gap", () => {
  const input = parkingFixture();
  input.meshReport.paintEmission = [
    emittedDivider("LOT_TEST/R1/D0", 5),
    emittedDivider("LOT_TEST/R1/D1", 7.5, 9.8),
    emittedDivider("LOT_TEST/R1/D2", 10),
  ];
  const report = createMapComparison(input);
  const lines = report.objects.filter(o => /\/D\d+$/.test(o.id));
  assert.equal(lines[0].over, false);
  assert.ok(lines[0].residual_m <= .05);
  assert.equal(lines[1].unmeasurable, true);
  assert.equal(lines[1].support, null);
  assert.equal(lines[2].over, false);
});

function fixture() {
  const ring = [[1010, 2010], [1013, 2010], [1013, 2011], [1010, 2011]].map(p => tmToScene(...p));
  const piece = { objectId: crossing, ownerId: owner, partId: `${crossing}/0/part/0`,
    kind: "zebra_bar", colour: "white", rings: [ring] };
  const white = new Uint8Array(160 * 160);
  for (let y = 116; y < 120; y++) for (let x = 40; x < 52; x++) white[y * 160 + x] = 1;
  return {
    sheet: { w: 160, h: 160, origin: [1000, 2040], gsdM: .25, paint: { white } },
    pieces: [piece], bindings: [{ ownerId: owner, segmentId: "RD_001", verified: true, refs: ["independent"] }],
    meshReport: { rawGlbSha256: "raw", symbols: { roadSourceHashes: hashes },
      emission: { parts: [{ ...piece, triangles: [[ring[0], ring[1], ring[2]], [ring[0], ring[2], ring[3]]],
        sourceAreaScene: 3, emittedAreaScene: 3 }], summary: { pieces: 1 } } },
    rawGlbSha256: "raw", roadSourceHashes: hashes,
    reference: { complete: true, segments: [{ id: "unobserved", expected: null, refs: ["hidden"] }],
      crossings: [{ id: crossing, expected: true, barIds: [`${crossing}/0`], refs: ["independent"] }],
      physicalCrossings: [{ id: "CW_001", expected: true, objectIds: [crossing], boundsTm: [1010, 2010, 1013, 2011], refs: ["independent"] }] },
    parkingDoc: { lots: [] }, nodes: [],
  };
}

test("build map report scores emitted triangles and retains unknown despite an empty over list", () => {
  const report = createMapComparison(fixture());
  assert.deepEqual(report.objects.map(o => [o.id, o.iou, o.over]), [[crossing, 1, false], [`${crossing}/0`, 1, false]]);
  assert.equal(report.overTolerance, 0);
  assert.equal(report.roadExistence.segments.counts.unknown, 1);
  assert.equal(report.roadExistence.segments.denominator, 1);
  assert.equal(report.roadAcceptance.accepted, false);
  assert.equal(report.roadAcceptance.checks.segmentExistence, false);
  assert.equal(report.rawGlbSha256, "raw");
  assert.deepEqual(report.roadSourceHashes, hashes);
  assert.equal(report.optionalAerial.status, "unavailable");
  assert.match(report.optionalAerial.reason, /not supplied/);
});

test("missing physical crossing members survive the scoring and JSON boundary", () => {
  const input = fixture();
  input.reference.physicalCrossings[0].objectIds.push("missing-grid");
  const report = JSON.parse(JSON.stringify(createMapComparison(input)));
  assert.deepEqual(report.physicalCrossings[0].missingMemberIds, ["missing-grid"]);
  assert.equal(report.roadAcceptance.checks.physicalCrossings, false);
});

test("absent physical crossing references remain an explicit incomplete check", () => {
  const input = fixture();
  delete input.reference.physicalCrossings;
  const report = createMapComparison(input);
  assert.deepEqual(report.physicalCrossings, []);
  assert.equal(report.roadAcceptance.checks.physicalCrossings, false);
  assert.match(report.notRun.find(r => r.id === "physicalCrossings").reason, /reference/);
});

for (const [name, mutate, pattern] of [
  ["raw", x => { x.rawGlbSha256 = "other"; }, /raw GLB hash mismatch/],
  ["parcels", x => { x.roadSourceHashes = { ...hashes, parcels: "other" }; }, /stale mesh report: parcels/],
  ["sheet", x => { x.sheet = null; }, /mandatory sheet/],
]) test(`map comparison rejects stale or absent ${name} input`, () => {
  const input = fixture();
  mutate(input);
  assert.throws(() => createMapComparison(input), pattern);
});

test("synthetic sheet window preserves pixel corner coordinates without closing the caller's sheet", () => {
  const sheet = { width: 160, height: 160, tfw: { a: .25, d: -.25, c: 1000.125, f: 2039.875 },
    readWindow(col, row, w, h) {
      assert.deepEqual([col, row, w, h], [0, 0, 160, 160]);
      return new Uint8Array(w * h * 3).fill(90);
    } };
  const window = readMapWindow(sheet, [[1010, 2010], [1030, 2030]]);
  assert.deepEqual([window.w, window.h, window.origin, window.gsdM], [160, 160, [1000, 2040], .25]);
  assert.equal(window.paint.white.length, 25600);
});

test("file adapter fails on a missing mandatory sheet before consuming stale local reports", async () => {
  await assert.rejects(runMapComparison({ sheetPath: "/nonexistent/gt-28-sheet.tif" }), /mandatory sheet/);
});

test("importing the map API and overhead CLI does not start work or write output", t => {
  const dir = mkdtempSync(join(tmpdir(), "map-import-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = new URL("../../perf/overhead-blend.mjs", import.meta.url).href;
  const api = new URL("./mapReport.mjs", import.meta.url).href;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e",
    `await import(${JSON.stringify(api)}); await import(${JSON.stringify(cli)}); console.log("imported");`],
  { cwd: dir, env: { ...process.env, NGII_SHEET: join(dir, "absent.tif") }, encoding: "utf8", timeout: 10000 });
  assert.equal(output.trim(), "imported");
  assert.deepEqual(readdirSync(dir), []);
});

// A single-strip 16x16 RGB TIFF covers campus at deliberately coarse resolution.
// It exercises the real file/CLI boundary without any local aerial cache.
function fileFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "map-files-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dataDir = join(dir, "data");
  mkdirSync(join(dataDir, "ground"), { recursive: true });
  mkdirSync(join(dataDir, "photo", "evidence"), { recursive: true });
  const json = (name, value) => writeFileSync(join(dataDir, name), JSON.stringify(value));
  json("ground/road-sections.json", {});
  json("ground/junctions.json", {});
  json("ground/parcels.json", { parcels: [] });
  json("ground/parking.json", { lots: [] });
  json("photo/evidence/road-reference.json", { complete: false, segments: [], crossings: [] });
  json("building-forms.json", { buildings: [] });
  json("trees.json", { trees: [] });
  json("bld-node-map.json", { entries: [] });
  const rawGlbPath = join(dir, "candidate.raw.glb"), meshReportPath = join(dir, "emission.json");
  writeFileSync(rawGlbPath, "candidate-28");
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  writeFileSync(meshReportPath, JSON.stringify({ rawGlbSha256: hash(rawGlbPath),
    symbols: { roadSourceHashes: Object.fromEntries(["road-sections", "junctions", "parcels"].map(n =>
      [n, hash(join(dataDir, "ground", `${n}.json`))])) },
    emission: { parts: [], summary: { pieces: 0 } } }));
  const entries = [[256, 16], [257, 16], [258, 8], [259, 1], [273, 8], [277, 3], [278, 16], [279, 768], [284, 1]];
  const bytes = Buffer.alloc(8 + 768 + 2 + entries.length * 12 + 4, 0);
  bytes.write("II"); bytes.writeUInt16LE(42, 2); bytes.writeUInt32LE(776, 4);
  bytes.fill(90, 8, 776);
  bytes.writeUInt16LE(entries.length, 776);
  entries.forEach(([tag, value], i) => {
    const at = 778 + i * 12;
    bytes.writeUInt16LE(tag, at); bytes.writeUInt16LE(4, at + 2);
    bytes.writeUInt32LE(1, at + 4); bytes.writeUInt32LE(value, at + 8);
  });
  const sheetPath = join(dir, "sheet.tif");
  writeFileSync(sheetPath, bytes);
  writeFileSync(join(dir, "sheet.tfw"), "1000\n0\n0\n-1000\n240500\n269500\n");
  return { dir, sheetPath, dataDir, rawGlbPath, meshReportPath };
}

test("standalone objects CLI writes both reports without a server using the explicit candidate paths", t => {
  const f = fileFixture(t);
  const out = join(f.dir, "out");
  const cli = fileURLToPath(new URL("../../perf/overhead-blend.mjs", import.meta.url));
  execFileSync(process.execPath, [cli, "--objects", "--data", f.dataDir, "--mesh-report", f.meshReportPath,
    "--raw-glb", f.rawGlbPath, "--out", out, "--url", "http://127.0.0.1:5241/"],
  { env: { ...process.env, NGII_SHEET: f.sheetPath }, timeout: 10000 });
  const result = JSON.parse(readFileSync(join(out, "objects.json")));
  assert.equal(result.roadAcceptance.accepted, false);
  assert.equal(result.optionalAerial.status, "unavailable");
  assert.equal(result.overTolerance, 0);
  assert.match(readFileSync(join(out, "objects.md"), "utf8"), /Over tolerance \(0\)/);
});

for (const mutation of ["raw", "parcels"]) test(`file adapter detects changed ${mutation} bytes`, async t => {
  const f = fileFixture(t);
  if (mutation === "raw") writeFileSync(f.rawGlbPath, "other-candidate");
  else writeFileSync(join(f.dataDir, "ground/parcels.json"), '{"parcels": [], "changed": true}');
  await assert.rejects(runMapComparison(f), mutation === "raw" ? /raw GLB hash mismatch/ : /stale mesh report: parcels/);
});

test("standalone objects CLI preserves exit 2 for a missing mandatory sheet", t => {
  const dir = mkdtempSync(join(tmpdir(), "map-no-sheet-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../perf/overhead-blend.mjs", import.meta.url)), "--objects"],
    { cwd: dir, env: { ...process.env, NGII_SHEET: join(dir, "absent.tif") }, encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 2);
  assert.match(child.stderr, /sheet missing/);
  assert.deepEqual(readdirSync(dir), []);
});

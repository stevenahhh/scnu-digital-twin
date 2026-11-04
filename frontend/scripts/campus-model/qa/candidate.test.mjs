import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import test from "node:test";
import { createCandidate, candidatePaths, publishCandidate } from "./candidate.mjs";

const names = ["campus-v2.glb", "campus-v2-height.bin", "campus-v2-height.json"];
const reports = ["map-compare.json", "vr-bearings.json", "invariants.json"];
const inputHashes = { parcels: "fixture-source-sha256" };

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "campus-candidate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const buildDir = path.join(dir, ".build");
  const candidate = createCandidate(buildDir);
  const publicDir = path.join(dir, "public");
  mkdirSync(publicDir);
  for (const name of names) {
    writeFileSync(path.join(publicDir, name), `old:${name}`);
    writeFileSync(path.join(candidate.dir, name), `new:${name}`);
  }
  writeFileSync(candidate.raw, "raw");
  writeFileSync(candidate.repeatRaw, "raw");
  return { candidate, publicDir, buildDir };
}

// A separate process consumes the candidate and emits reports, as the QA CLIs do.
function checks({ candidate, identity }, mode = "pass") {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { readFileSync, writeFileSync } from "node:fs";
    import path from "node:path";
    const { candidate, identity, mode, reports } = JSON.parse(process.argv[1]);
    if (readFileSync(candidate.packed, "utf8") !== "new:campus-v2.glb") process.exit(3);
    for (const name of reports) {
      const report = { ...identity, accepted: mode !== "fail", findings: [] };
      if (mode === "stale") report.runId = "previous-run";
      if (mode === "wrong-hash") report.hashes.packed = "previous-packed-hash";
      if (mode === "wrong-input") report.inputHashes.parcels = "previous-input-hash";
      writeFileSync(path.join(candidate.qaDir, name), JSON.stringify(report));
    }
    if (mode === "mutate") writeFileSync(candidate.heightBin, "changed-after-QA");
    if (mode === "crash") process.exit(4);
  `, JSON.stringify({ candidate, identity, mode, reports })], { encoding: "utf8", timeout: 10000 });
  assert.ifError(child.error);
  if (child.status !== 0) throw new Error(`QA child exited ${child.status}: ${child.stderr}`);
}

test("a passing candidate publishes the GLB and both height files with matching compressed bytes", async (t) => {
  const { candidate, publicDir } = fixture(t);
  await publishCandidate(candidate, { publicDir, inputHashes, runChecks: checks, precompress: true });
  for (const name of names) assert.equal(readFileSync(path.join(publicDir, name), "utf8"), `new:${name}`);
  for (const [suffix, decode] of [["gz", gunzipSync], ["br", brotliDecompressSync]]) {
    assert.equal(decode(readFileSync(path.join(publicDir, `campus-v2.glb.${suffix}`))).toString(), "new:campus-v2.glb");
  }
});

for (const mode of ["fail", "stale", "wrong-hash", "wrong-input", "mutate", "crash", "missing", "malformed", "different-raw", "missing-sidecar"]) {
  test(`${mode} keeps the previous public GLB and height pair`, async (t) => {
    const { candidate, publicDir } = fixture(t);
    if (mode === "different-raw") writeFileSync(candidate.repeatRaw, "RAW");
    if (mode === "missing-sidecar") rmSync(candidate.heightJson);
    await assert.rejects(publishCandidate(candidate, {
      publicDir, inputHashes,
      runChecks: (context) => {
        if (mode === "missing") return;
        if (mode === "malformed") {
          writeFileSync(path.join(candidate.qaDir, reports[0]), "{");
          return;
        }
        checks(context, mode);
      },
    }));
    for (const name of names) assert.equal(readFileSync(path.join(publicDir, name), "utf8"), `old:${name}`);
  });
}

test("reports left by a previous attempt cannot satisfy a new gate invocation", async (t) => {
  const { candidate, publicDir } = fixture(t);
  await assert.rejects(publishCandidate(candidate, {
    publicDir, inputHashes, runChecks: (context) => checks(context, "crash"),
  }), /QA child exited 4/);
  await assert.rejects(publishCandidate(candidate, { publicDir, inputHashes, runChecks: () => {} }), /ENOENT/);
  for (const name of names) assert.equal(readFileSync(path.join(publicDir, name), "utf8"), `old:${name}`);
});

test("publishing without compression removes stale compressed public siblings", async (t) => {
  const { candidate, publicDir } = fixture(t);
  for (const suffix of ["br", "gz"]) writeFileSync(path.join(publicDir, `campus-v2.glb.${suffix}`), "old-compressed");
  await publishCandidate(candidate, { publicDir, inputHashes, runChecks: checks });
  for (const suffix of ["br", "gz"]) assert.equal(existsSync(path.join(publicDir, `campus-v2.glb.${suffix}`)), false);
});

test("candidate output paths reject public directories and symlink escapes", (t) => {
  const { candidate, publicDir, buildDir } = fixture(t);
  assert.throws(() => candidatePaths(publicDir, buildDir), { code: "CANDIDATE_PATH" });
  const link = path.join(buildDir, "candidate-escape");
  symlinkSync(publicDir, link);
  assert.throws(() => candidatePaths(link, buildDir), { code: "CANDIDATE_PATH" });
  symlinkSync(path.join(publicDir, names[0]), candidate.joined);
  assert.throws(() => candidatePaths(candidate.dir, buildDir), { code: "CANDIDATE_PATH" });
});

test("a filesystem error after the GLB replacement rolls back the entire public set", (t) => {
  const { candidate, publicDir } = fixture(t);
  const moduleUrl = new URL("./candidate.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import path from "node:path";
    const { candidate, publicDir, inputHashes, reports } = JSON.parse(process.argv[1]);
    const rename = fs.renameSync;
    // Inject ENOSPC at the filesystem boundary, after real earlier replacements.
    fs.renameSync = (from, to) => {
      if (from === path.join(publicDir, ".campus-publish-lock", "campus-v2-height.json")) {
        throw Object.assign(new Error("injected disk full"), { code: "ENOSPC" });
      }
      return rename(from, to);
    };
    syncBuiltinESMExports();
    const { publishCandidate } = await import(${JSON.stringify(moduleUrl)});
    try {
      await publishCandidate(candidate, { publicDir, inputHashes,
        runChecks: ({ candidate, identity }) => {
          for (const name of reports) fs.writeFileSync(path.join(candidate.qaDir, name),
            JSON.stringify({ ...identity, accepted: true }));
        },
      });
      process.exitCode = 2;
    } catch (error) {
      if (error.code !== "ENOSPC") throw error;
    }
  `, JSON.stringify({ candidate, publicDir, inputHashes, reports })], { encoding: "utf8", timeout: 10000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  for (const name of names) assert.equal(readFileSync(path.join(publicDir, name), "utf8"), `old:${name}`);
  assert.equal(existsSync(path.join(publicDir, ".campus-publish-lock")), false);
});

test("an existing publication lock rejects a concurrent publisher without altering public files", async (t) => {
  const { candidate, publicDir } = fixture(t);
  const lock = path.join(publicDir, ".campus-publish-lock");
  mkdirSync(lock);
  writeFileSync(path.join(lock, "owner"), "other-publisher");
  await assert.rejects(publishCandidate(candidate, { publicDir, inputHashes, runChecks: checks }), { code: "EEXIST" });
  assert.equal(readFileSync(path.join(lock, "owner"), "utf8"), "other-publisher");
  for (const name of names) assert.equal(readFileSync(path.join(publicDir, name), "utf8"), `old:${name}`);
});

test("pack reads the selected candidate raw and fails its existing terrain verification", (t) => {
  const candidate = createCandidate();
  t.after(() => rmSync(candidate.dir, { recursive: true, force: true }));
  // A tiny valid GLB with an empty scene reaches the real terrain check, not a missing-file check.
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scenes: [{}], scene: 0 }));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  writeFileSync(candidate.raw, Buffer.concat([header, padded]));
  const child = spawnSync("bun", [fileURLToPath(new URL("../pack.mjs", import.meta.url)), "--candidate-dir", candidate.dir],
    { encoding: "utf8", timeout: 10000 });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /terrain join: no Topography node/);
  assert.equal(existsSync(candidate.packed), false);
});

for (const script of ["model:pack", "model:precompress"]) {
  test(`${script} cannot publish without an explicit candidate`, () => {
    const frontend = fileURLToPath(new URL("../../../", import.meta.url));
    const child = spawnSync("bun", ["run", "--cwd", frontend, script],
      { encoding: "utf8", timeout: 10000 });
    assert.ifError(child.error);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /candidate.*gate/i);
  });
}

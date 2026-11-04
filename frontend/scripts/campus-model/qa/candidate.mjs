import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  renameSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { brotliCompressSync, constants as zlib, gzipSync } from "node:zlib";
import { assertRawDeterminism } from "./determinism.mjs";

const BUILD_DIR = fileURLToPath(new URL("../.build", import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL("../../../public", import.meta.url));
const REPORTS = ["map-compare.json", "vr-bearings.json", "invariants.json"];
const ARTIFACTS = {
  raw: "campus-v2.raw.glb",
  repeatRaw: "campus-v2.repeat.raw.glb",
  packed: "campus-v2.glb",
  heightBin: "campus-v2-height.bin",
  heightJson: "campus-v2-height.json",
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export class CandidateGateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Only direct candidate-* directories inside a real .build directory are writable. */
export function candidatePaths(dir, buildDir = BUILD_DIR) {
  const build = path.resolve(buildDir);
  const candidate = path.resolve(dir);
  if (path.basename(build) !== ".build" || path.dirname(candidate) !== build
    || !path.basename(candidate).startsWith("candidate-")
    || realpathSync(build) !== path.resolve(realpathSync(path.dirname(build)), ".build")
    || lstatSync(candidate).isSymbolicLink() || !lstatSync(candidate).isDirectory()) {
    throw new CandidateGateError("CANDIDATE_PATH", "candidate output must stay inside the .build gate directory");
  }
  const paths = {
    dir: candidate, buildDir: build,
    ...Object.fromEntries(Object.entries(ARTIFACTS).map(([key, name]) => [key, path.join(candidate, name)])),
    joined: path.join(candidate, "campus-v2.joined.glb"),
    qaDir: path.join(candidate, "qa"),
  };
  for (const file of [...Object.values(ARTIFACTS), "campus-v2.joined.glb", "qa"]) {
    const stat = lstatSync(path.join(candidate, file), { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || (file === "qa" ? !stat.isDirectory() : !stat.isFile()))) {
      throw new CandidateGateError("CANDIDATE_PATH", `candidate gate rejects non-regular output: ${file}`);
    }
  }
  return Object.freeze(paths);
}

/** Call once per build, then direct both raw builds and pack to these paths. */
export function createCandidate(buildDir = BUILD_DIR) {
  mkdirSync(buildDir, { recursive: true });
  return candidatePaths(mkdtempSync(path.join(buildDir, "candidate-")), buildDir);
}

function snapshot(candidate) {
  return Object.fromEntries(Object.keys(ARTIFACTS).map((key) => {
    const bytes = readFileSync(candidate[key]);
    if (!bytes.length) throw new CandidateGateError("CANDIDATE_EMPTY", `candidate ${key} is empty`);
    return [key, bytes];
  }));
}

/**
 * runChecks({candidate, identity}) must write all three JSON reports into qaDir.
 * Each report includes identity's runId, hashes and inputHashes, plus accepted:true.
 * accepted is the caller's complete QA policy decision, not just an empty findings list.
 * Previous reports are removed before invoking the callback; its rejection blocks publish.
 */
export async function publishCandidate(candidate, {
  publicDir = PUBLIC_DIR, inputHashes, runChecks, precompress = false,
}) {
  const paths = candidatePaths(candidate.dir, candidate.buildDir);
  const lock = path.join(paths.dir, ".gate-lock");
  mkdirSync(lock);
  try {
    rmSync(paths.qaDir, { recursive: true, force: true });
    mkdirSync(paths.qaDir);
    const bytes = snapshot(paths);
    assertRawDeterminism(bytes.raw, bytes.repeatRaw);
    const identity = {
      runId: randomUUID(),
      hashes: Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, sha256(value)])),
      inputHashes: structuredClone(inputHashes),
    };
    // A JSON clone prevents callbacks from mutating the expected identity.
    await runChecks({ candidate: paths, identity: structuredClone(identity) });
    for (const name of REPORTS) {
      const report = JSON.parse(readFileSync(path.join(paths.qaDir, name), "utf8"));
      if (report.accepted !== true || report.runId !== identity.runId
        || !isDeepStrictEqual(report.hashes, identity.hashes)
        || !isDeepStrictEqual(report.inputHashes, identity.inputHashes)) {
        throw new CandidateGateError("CANDIDATE_QA", `candidate gate rejected ${name}: failed or stale identity`);
      }
    }
    const after = snapshot(candidatePaths(paths.dir, paths.buildDir));
    if (Object.keys(ARTIFACTS).some((key) => sha256(after[key]) !== identity.hashes[key])) {
      throw new CandidateGateError("CANDIDATE_CHANGED", "candidate bytes changed during QA");
    }
    // Publish the exact bytes QA checked, including both height sidecar files.
    const outputs = new Map(["packed", "heightBin", "heightJson"].map((key) => [ARTIFACTS[key], bytes[key]]));
    outputs.set("campus-v2.glb.br", precompress
      ? brotliCompressSync(bytes.packed, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }) : null);
    outputs.set("campus-v2.glb.gz", precompress ? gzipSync(bytes.packed, { level: 9 }) : null);
    publishFiles(publicDir, outputs);
    return identity;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// Rename staged siblings only after all QA and preparation succeeds. A caught filesystem
// failure rolls the entire set back. Fixed legacy URLs cannot offer multi-file atomic reads
// or power-loss atomicity; a versioned directory/pointer would require a consumer migration.
function publishFiles(publicDir, outputs) {
  mkdirSync(publicDir, { recursive: true });
  const transaction = path.join(publicDir, ".campus-publish-lock");
  mkdirSync(transaction);
  const replaced = [];
  const backups = [];
  let cleaned = false;
  try {
    for (const [name, bytes] of outputs) {
      const target = path.join(publicDir, name);
      const stat = lstatSync(target, { throwIfNoEntry: false });
      if (stat && !stat.isFile()) {
        throw new CandidateGateError("PUBLIC_PATH", `candidate gate rejects non-regular public output: ${name}`);
      }
      if (bytes !== null) writeFileSync(path.join(transaction, name), bytes);
    }
    for (const [name, bytes] of outputs) {
      const target = path.join(publicDir, name);
      if (lstatSync(target, { throwIfNoEntry: false })) {
        renameSync(target, path.join(transaction, `${name}.previous`));
        backups.push(name);
      }
      if (bytes !== null) {
        renameSync(path.join(transaction, name), target);
        replaced.push(name);
      }
    }
    cleaned = true;
  } catch (error) {
    for (const name of replaced.reverse()) rmSync(path.join(publicDir, name));
    for (const name of backups.reverse()) renameSync(path.join(transaction, `${name}.previous`), path.join(publicDir, name));
    cleaned = true;
    throw error;
  } finally {
    // Keep backups and the lock for recovery if the filesystem also refuses rollback.
    if (cleaned) rmSync(transaction, { recursive: true, force: true });
  }
}

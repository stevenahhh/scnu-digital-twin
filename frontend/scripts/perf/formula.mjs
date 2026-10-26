// Measures every input of docs/OPTIMIZATION-FORMULA.md against a running Legacy dev server (local QA only).
//
//   bun scripts/perf/formula.mjs --url http://127.0.0.1:5190/ --label <label> --out <dir> [--cdp 9190] [--runs 5]
//       [--orbit 60] [--ref <dir of an earlier formula run>] [--ref-label <label>] [--skip-q] [--q-from <fidelity.json>]
//
// Runs, one Chrome at a time:
//   bench.mjs --quality low  (runs N, 1440 x 900): D (draw calls, overview/d4/oblique15), T, X, L (median loadMs), B
//   bench.mjs --quality medium / high (1 run each): D at those tiers (drawCallsFrame, the WebGL draws between two
//   rAFs: post-processing renders several scenes a frame and resets renderer.info)
//   bench.mjs --orbit S (1 run each): F at 1440 x 900 low and high, 390 x 844 low (mean fps, 1 % low)
//   overhead-blend.mjs --campus-only + fidelity.mjs: Q (mean SSIM against the NGII photo on 12 tiles) and, with --ref,
//   Qself against the reference run's renders.
// Writes <out>/<label>-formula.json. B is the bytes of the campus model files and decoders the page fetched
// (campus-v2*.glb, .ktx2, .wasm); the dev server sends them uncompressed.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = option("url", "http://127.0.0.1:5190/");
const label = option("label", "candidate");
const out = resolve(option("out", "."));
const cdp = option("cdp", "9190");
const runs = option("runs", "5");
const orbit = option("orbit", "60");
const ref = option("ref", null);
const refLabel = option("ref-label", "baseline");
const qFrom = option("q-from", null);
const skipQ = args.includes("--skip-q") || Boolean(qFrom);
const MODEL_ASSET = /\/campus-v2(?!-height)[^/]*\.(glb|ktx2)(\?|$)|\.wasm(\?|$)/;
mkdirSync(out, { recursive: true });

function run(cmd, argv) {
  console.log(`$ ${cmd} ${argv.join(" ")}`);
  const result = spawnSync(cmd, argv, { cwd: FRONTEND, stdio: ["ignore", "inherit", "inherit"] });
  if (result.status !== 0) throw new Error(`${cmd} ${argv[0]} exited with ${result.status}`);
}
const bench = (name, extra) => {
  run("bun", [join(HERE, "bench.mjs"), url, name, out, "--cdp", cdp, ...extra]);
  return JSON.parse(readFileSync(join(out, `${name}.json`), "utf8"));
};
const views = (s, key) => Object.fromEntries(Object.entries(s.views).map(([k, v]) => [k, v[key]]));

const low = bench(`${label}-low`, ["--quality", "low", "--runs", runs, "--width", "1440", "--height", "900"]);
const medium = bench(`${label}-medium`, ["--quality", "medium", "--runs", "1", "--width", "1440", "--height", "900"]);
const high = bench(`${label}-high`, ["--quality", "high", "--runs", "1", "--width", "1440", "--height", "900"]);
const orbitArgs = ["--runs", "1", "--warmup", "10", "--frames", "20", "--orbit", orbit];
const fLow = bench(`${label}-orbit-1440-low`, [...orbitArgs, "--quality", "low", "--width", "1440", "--height", "900"]);
const fHigh = bench(`${label}-orbit-1440-high`, [...orbitArgs, "--quality", "high", "--width", "1440", "--height", "900"]);
const fMobile = bench(`${label}-orbit-390-low`, [...orbitArgs, "--quality", "low", "--width", "390", "--height", "844"]);

let fidelity = null;
if (!skipQ) {
  const blendDir = join(out, `${label}-blend`);
  // overhead-blend exits 1 when a tile is more than 1 px off the photo; that is its own verdict, not a failed capture.
  const blend = spawnSync("bun", [join(HERE, "overhead-blend.mjs"), "--url", url, "--out", blendDir, "--campus-only"],
    { cwd: FRONTEND, stdio: ["ignore", "inherit", "inherit"] });
  if (blend.status === 2 || blend.status === null) throw new Error(`overhead-blend.mjs could not run (${blend.status})`);
  const refArgs = ref ? ["--ref", join(resolve(ref), `${refLabel}-blend`)] : [];
  run("bun", [join(HERE, "fidelity.mjs"), "--dir", blendDir, ...refArgs]);
  fidelity = JSON.parse(readFileSync(join(blendDir, "fidelity.json"), "utf8"));
}
if (qFrom) fidelity = JSON.parse(readFileSync(resolve(qFrom), "utf8"));

const modelAssets = low.assets.filter((a) => MODEL_ASSET.test(a.name));
const result = {
  label, url, measuredAt: new Date().toISOString(), gitHead: low.gitHead,
  B: modelAssets.reduce((s, a) => s + a.encodedBodySize, 0),
  modelAssets: modelAssets.map((a) => ({ name: a.name, bytes: a.encodedBodySize })),
  D: { low: views(low, "drawCalls"), lowFrame: views(low, "drawCallsFrame"), medium: views(medium, "drawCallsFrame"),
    high: views(high, "drawCallsFrame") },
  T: low.triangles,
  X: low.textureMemory,
  L: { medianMs: low.loadMs, runs: low.runs.map((r) => r.loadMs),
    definition: "navigate (HTTP cache disabled, fresh profile) to more than 5 campus labels, which need the GLB" },
  F: {
    "1440x900-low": fLow.orbit, "1440x900-high": fHigh.orbit, "390x844-low": fMobile.orbit,
  },
  Q: fidelity && { Q: fidelity.Q, Qself: fidelity.Qself, tiles: fidelity.tiles.length, source: qFrom ? resolve(qFrom) : "this run" },
  sceneCensus: low.textureMemory.sceneCensus,
  gpuMs: views(low, "gpuMs"),
  consoleErrors: { low: low.consoleErrors, medium: medium.consoleErrors, high: high.consoleErrors,
    orbit: fLow.consoleErrors + fHigh.consoleErrors + fMobile.consoleErrors },
  consoleErrorMessages: [...new Set([low, medium, high, fLow, fHigh, fMobile].flatMap((s) => s.consoleErrorMessages))],
};
writeFileSync(join(out, `${label}-formula.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(`FORMULA ${label} B=${result.B} D(low overview)=${result.D.low.overview} T=${result.T} X=${result.X.gpuTextureMB}MB ` +
  `L=${result.L.medianMs}ms F(1440 low)=${fLow.orbit.fps}/${fLow.orbit.low1} F(1440 high)=${fHigh.orbit.fps}/${fHigh.orbit.low1} ` +
  `F(390 low)=${fMobile.orbit.fps}/${fMobile.orbit.low1} Q=${result.Q?.Q ?? "skipped"} Qself=${result.Q?.Qself ?? "n/a"}`);

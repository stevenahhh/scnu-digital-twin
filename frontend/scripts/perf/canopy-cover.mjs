// Canopy cover check (local QA only; nothing here ships). Per window, the share of the ground under tree crowns seen from
// straight above, in the model (the Trees_*_crown instances of a campus GLB: each instance a disc of its crown mesh's
// horizontal reach times its scale) against the photo canopy mask of fetch/treeInventory.mjs (green, textured cells of
// the NGII 2025 sheet plus crown shade). Both on the inventory's 0.5 m EPSG:5186 grid. Hedges are not counted.
//
//   bun scripts/perf/canopy-cover.mjs --glb before=<file> --glb after=public/campus-v2.glb [--inventory inv=<trees.json>] [--out <dir>]
//
// Windows: the four overhead-blend.mjs windows (scene centre, metres along the grid) and the b1 south slope (VR scene_b1
// face b). Writes <out>/canopy-cover.json and .md when --out is given. The inventory run uses --out, so data/ is untouched.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { decodePng } from "../campus-model/lib/png.mjs";
import { sceneToTm, tmToScene } from "../../src/geo/epsg5186.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const WINDOWS = [
  { name: "east-woodland", x: 355, z: -185, widthM: 200, heightM: 150 },
  { name: "central-lawn", x: 260, z: -230, widthM: 200, heightM: 150 },
  { name: "d4-block", x: 46.5, z: -266.6, widthM: 200, heightM: 150 },
  { name: "b1-south-slope", x: 412, z: -152, widthM: 80, heightM: 60 },
  { name: "main-gate", x: 450, z: -160, widthM: 200, heightM: 150 },
];

const args = process.argv.slice(2);
const glbs = [];
let outDir = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--glb" || args[i] === "--inventory") {
    const kind = args[i].slice(2);
    const [label, file] = args[++i].split("=");
    glbs.push({ label, file: resolve(file), kind });
  } else if (args[i] === "--out") outDir = resolve(args[++i]);
  else throw new Error(`unknown argument ${args[i]}`);
}
if (!glbs.length) throw new Error("usage: canopy-cover.mjs --glb <label>=<file> [--glb ...] [--out <dir>]");

// ---- photo canopy mask (treeInventory.mjs --debug writes canopy.png and grid.json)
const tmp = mkdtempSync(join(tmpdir(), "canopy-cover-"));
let mask;
let grid;
try {
  execFileSync("bun", [join(HERE, "../campus-model/fetch/treeInventory.mjs"), "--out", join(tmp, "trees.json"), "--debug", tmp], { stdio: ["ignore", "ignore", "inherit"] });
  mask = decodePng(readFileSync(join(tmp, "canopy.png")));
  grid = JSON.parse(readFileSync(join(tmp, "grid.json"), "utf8"));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---- crown discs of a GLB (scene units)
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
async function discs(file) {
  const doc = await io.read(file);
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!/^Trees_.*_crown$/.test(name) || /hedge/.test(name) || !node.getMesh()) continue;
    let reach = 0;
    for (const prim of node.getMesh().listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        reach = Math.max(reach, Math.hypot(v[0], v[2]));
      }
    }
    const inst = node.getExtension("EXT_mesh_gpu_instancing");
    const t = inst.getAttribute("TRANSLATION");
    const s = inst.getAttribute("SCALE");
    const tv = [0, 0, 0];
    const sv = [1, 1, 1];
    for (let i = 0; i < t.getCount(); i += 1) {
      t.getElement(i, tv);
      if (s) s.getElement(i, sv);
      out.push([tv[0], tv[2], reach * Math.max(sv[0], sv[2])]);
    }
  }
  return out;
}

// ---- cover per window
function windowCells(w) {
  const [E, N] = sceneToTm(w.x, w.z);
  const cells = [];
  for (let n = N - w.heightM / 2; n < N + w.heightM / 2; n += grid.CELL) {
    for (let e = E - w.widthM / 2; e < E + w.widthM / 2; e += grid.CELL) cells.push([e + grid.CELL / 2, n + grid.CELL / 2]);
  }
  return cells;
}
function photoCover(cells) {
  let hit = 0;
  for (const [e, n] of cells) {
    const i = Math.floor((e - grid.E0) / grid.CELL);
    const j = Math.floor((grid.N1 - n) / grid.CELL);
    if (i >= 0 && j >= 0 && i < grid.W && j < grid.H && mask.pixels[j * grid.W + i] > 0) hit += 1;
  }
  return hit / cells.length;
}
function modelCover(cells, list) {
  const B = 8;
  const buckets = new Map();
  for (const d of list) {
    for (let bx = Math.floor((d[0] - d[2]) / B); bx <= Math.floor((d[0] + d[2]) / B); bx += 1) {
      for (let bz = Math.floor((d[1] - d[2]) / B); bz <= Math.floor((d[1] + d[2]) / B); bz += 1) {
        const key = `${bx},${bz}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(d);
      }
    }
  }
  let hit = 0;
  for (const [e, n] of cells) {
    const [x, z] = tmToScene(e, n);
    if ((buckets.get(`${Math.floor(x / B)},${Math.floor(z / B)}`) ?? []).some(([dx, dz, r]) => (x - dx) ** 2 + (z - dz) ** 2 <= r * r)) hit += 1;
  }
  return hit / cells.length;
}

const models = [];
// --inventory: the crowns of a data/trees.json as drawn before the build's placement rules (a quick check).
const inventoryDiscs = (file) => JSON.parse(readFileSync(file, "utf8")).trees.map(([e, n, d]) => [...tmToScene(e, n), (d / 2) * 0.6242171526]);
for (const g of glbs) models.push({ ...g, discs: g.kind === "inventory" ? inventoryDiscs(g.file) : await discs(g.file) });
const rows = WINDOWS.map((w) => {
  const cells = windowCells(w);
  const row = { window: w.name, photo: photoCover(cells) };
  for (const m of models) row[m.label] = modelCover(cells, m.discs);
  return row;
});
const pct = (v) => `${(100 * v).toFixed(1)} %`;
const md = [
  `| window | photo canopy mask | ${models.map((m) => `${m.label} (${m.discs.length} crowns)`).join(" | ")} | ${models.map((m) => `${m.label} - photo`).join(" | ")} |`,
  `|---|---:|${models.map(() => "---:").join("|")}|${models.map(() => "---:").join("|")}|`,
  ...rows.map((r) => `| ${r.window} | ${pct(r.photo)} | ${models.map((m) => pct(r[m.label])).join(" | ")} | ${models.map((m) => `${(100 * (r[m.label] - r.photo)).toFixed(1)} pp`).join(" | ")} |`),
].join("\n");
console.log(md);
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "canopy-cover.json"), `${JSON.stringify({ windows: WINDOWS, rows, models: models.map(({ label, file, discs: d }) => ({ label, file, crowns: d.length })) }, null, 2)}\n`);
  writeFileSync(join(outDir, "canopy-cover.md"), `${md}\n`);
}

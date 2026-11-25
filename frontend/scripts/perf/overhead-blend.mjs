// Overhead-blend measurement: does the rendered campus ground sit on the NGII 2025 orthophoto within 1 photo pixel?
// (plan uhf-ground-roads-routing todo 3; local QA only, nothing here ships, every output stays under .omo/).
//
// Modelled on compare-satellite.mjs (same R3F store capture, Low quality pin of commit ef17188, pinned clock and the
// one-task orthographic render), with three differences: the reference is the NGII sheet 34702020 read through
// lib/ngiiSheet.mjs (never the VWorld mosaic), every view is aligned to the EPSG:5186 grid through
// src/geo/epsg5186.mjs (camera up = grid north, which is 0.27 deg off the scene's true north, so the render pixels
// coincide with the sheet pixels), and the comparison is a number: per 100 m tile, Sobel edges of render and photo,
// zero-mean cross-correlation over integer shifts in [-max-shift, max-shift], peak (dx, dy). A tile with at least
// --edge-floor of its render pixels on an edge (normalised Sobel magnitude >= 0.1, the top 10 % of the range) is a
// signal tile; the run PASSES when every signal tile has max(|dx|, |dy|) <= 1 px (0.25 m).
//
// Usage (Legacy dev server already running in frontend/, e.g. `vite --host 127.0.0.1 --port 5184`):
//   bun scripts/perf/overhead-blend.mjs --url http://127.0.0.1:5184/ --out <dir> [--prefix before-] [--tile 100]
//       [--campus-only] [--max-shift 4] [--edge-floor 0.02] [--json <path>] [--clock 2026-10-24T12:00:00+09:00]
//       [--visible-ground]
//   bun scripts/perf/overhead-blend.mjs --compare <before.json> <after.json> --out <dir>
//       [--before-images <dir>:<prefix>] [--after-images <dir>:<prefix>]   (render-only window pairs, residuals.md)
// Outputs: <prefix>tile-<E0>-<N0>-side.png (render | photo), <prefix>tile-<E0>-<N0>-blend.png (photo + render at 50 %
// | edges: render red, photo cyan), the same pair for the four compare-satellite windows (<prefix><name>-*.png,
// 800 x 600) and the JSON report. dx > 0: render content east of the photo; dy > 0: render content south.
//
// Visible-ground mode (--visible-ground; the full mode above still runs and is still reported, unchanged): per 100 m tile
// a second, ground-only render (meshes matching VISIBLE_HIDE: buildings, trees, furniture, lamps, traffic hidden) is
// compared with the same photo window after removing, from BOTH edge maps, (a) every building footprint of
// data/gis-buildings.json dilated by VISIBLE.leanBufferM (the photo shows the roof there, displaced by relief lean, while
// the render shows the ground under it) and (b) the photo's canopy and deep shade (G above R and B by VISIBLE.canopyGreen,
// or luminance below VISIBLE.shadeLum, dilated VISIBLE.canopyDilatePx; trees are not ground). The threshold is the same
// 1 photo px. A tile is "not measurable" when less than VISIBLE.minVisibleShare (N) of it is visible ground, when its
// render edge share inside the visible ground is below VISIBLE.minEdgeShare, or when the correlation peak ratio is below
// VISIBLE.minRatio (X); otherwise PASS or FAIL. N, X and the edge floor are justified in overheadBlendCore.mjs VISIBLE.
// JSON: `visibleGround` { thresholds, tiles, summary }; images <prefix>tile-<E0>-<N0>-visible-blend.png (excluded
// ground darkened). The run passes only when every reported mode passes.
// Objects mode (--objects; plan campus-ground-truth-redesign todo 10, design §10.1): instead of the tile capture, every
// road-marking piece the markings stage draws (stages/markings.mjs markingCandidates, the same pieces the paint gate
// measures) is scored against the photo's paint masks (lib/paintMasks.mjs) with leaned roofs, crowns and cast shadows
// masked out (lib/occlusion.mjs, leans from data/photo/building-lean.json or the leanPrior of building-forms.json) by
// qa/mapCompare.mjs: lateral residual for lines, IoU for areas. Writes <out>/objects.json and <out>/objects.md with the
// over-tolerance list; over-tolerance is a warning (exit 0), as §10.1 says the photo can be wrong. Stall paint comes from the
// generated rows of data/ground/parking.json (--parking <file> reads another record), not from the photo detections, which are
// no longer drawn; missingDividers lists the paint no record explains, and the report gives a table per row. No new renderer:
// Road geometry is read from emitted triangles; object mode needs no dev server.
// --data, --mesh-report and --raw-glb select a source directory and its matching raw candidate.
// Render modes accept --model <candidate.glb> --run-id <id> and verify the served bytes.
// Exit 0 PASS, 1 FAIL, 2 missing sheet or unreachable server (NGII_SHEET overrides the sheet path).
// Chrome is driven over --remote-debugging-pipe, so no TCP port is opened besides the dev server's.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { D4_SCENE_ANCHOR, EXTENT } from "../campus-model/lib/frame.mjs";
import { DEFAULT_SHEET, openSheet } from "../campus-model/lib/ngiiSheet.mjs";
import { decodePng, encodePng } from "../campus-model/lib/png.mjs";
import { GRID_CONVERGENCE_DEG, sceneToTm, tmToPixel, tmToScene, wgs84ToTm } from "../../src/geo/epsg5186.mjs";
import { occlusionMask } from "../campus-model/lib/occlusion.mjs";
import { runMapComparison } from "../campus-model/qa/mapReport.mjs";
import { readRenderIdentity } from "../campus-model/qa/renderReports.mjs";
import { resolveCampusModelUrl } from "../../src/campusModelAsset.mjs";
import { EDGE_THRESHOLD, VISIBLE, aggregate, aggregateVisible, canopyMask, footprintMask, measureTile, measureVisible, pointInRing, renderHalf, residualsMarkdown, sideBySide, tileGrid } from "./overheadBlendCore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CAMPUS = join(HERE, "../campus-model/data/osm-campus.json");
const BUILDINGS = join(HERE, "../campus-model/data/gis-buildings.json");
// Ground-only render of the visible-ground mode: the GLB roots and runtime groups that are not ground.
// CampusBuilding covers the per-building model nodes (CampusBuilding_*); Furniture is the collection of every object node.
const VISIBLE_HIDE = "^(BLD_|CampusBuilding|Trees_|Furniture|Lamps_|campus-traffic)";
const METRES_PER_PIXEL = 0.25;
const PASS_PX = 1;

// Same windows as compare-satellite.mjs (scene units), 200 x 150 m => 800 x 600 px.
const WINDOWS = [
  { name: "d4-block", x: 46.5, z: -266.6, widthM: 200, heightM: 150 },
  { name: "main-gate", x: 450, z: -160, widthM: 200, heightM: 150 },
  { name: "central-lawn", x: 260, z: -230, widthM: 200, heightM: 150 },
  { name: "east-woodland", x: 355, z: -185, widthM: 200, heightM: 150 },
];

async function main() {
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = option("url", "http://127.0.0.1:5184/");
const outDir = resolve(option("out", "overhead-blend"));
const prefix = option("prefix", "");
const tileM = Number(option("tile", "100"));
const campusOnly = args.includes("--campus-only");
const maxShift = Number(option("max-shift", "4"));
const edgeFloor = Number(option("edge-floor", "0.02"));
const jsonPath = resolve(option("json", join(outDir, `${prefix}overhead-blend.json`)));
const clock = option("clock", "2026-10-24T12:00:00+09:00");
const visibleGround = args.includes("--visible-ground");
const modelPath = resolve(option("model", join(HERE, "../../public/campus-v2.glb")));
const runId = option("run-id", randomUUID());
// --occlusion: each window is also measured with leaned roofs (data/photo/building-lean.json), tree crowns
// (data/trees.json) and their cast shadows (lib/occlusion.mjs) removed from both edge maps (result field `occluded`).
const occlusion = args.includes("--occlusion");
const OCCLUDERS = occlusion ? (() => {
  const data = join(dirname(fileURLToPath(import.meta.url)), "..", "campus-model", "data");
  const forms = JSON.parse(readFileSync(join(data, "building-forms.json"), "utf8"));
  const leans = new Map(JSON.parse(readFileSync(join(data, "photo", "building-lean.json"), "utf8")).buildings.map((b) => [b.id, b.lean]));
  const buildings = forms.buildings.flatMap((b) => b.masses.map((m) => ({
    rings: [m.outer, ...(m.holes ?? [])].map((r) => r.map(([lon, lat]) => wgs84ToTm(lon, lat))),
    heightM: m.topMetres, lean: leans.get(b.key) ?? b.leanPrior,
  })));
  const trees = JSON.parse(readFileSync(join(data, "trees.json"), "utf8")).trees.map(([east, north, crownDiameterM, heightM]) => ({ east, north, crownDiameterM, heightM }));
  return { buildings, trees };
})() : null;
if (Number.isNaN(Date.parse(clock))) throw new Error(`--clock is not a date: ${clock}`);

// ---------------------------------------------------------------- --compare <before.json> <after.json> --out <dir>
// Render-only before/after images of the four windows (the left half of each <window>-side.png) and residuals.md.
// Each JSON names its image directory and prefix (`images`); --before-images / --after-images <dir>:<prefix> override.
if (args.includes("--compare")) {
  const at = args.indexOf("--compare");
  const runs = [args[at + 1], args[at + 2]].map((file, i) => {
    const json = JSON.parse(readFileSync(resolve(file), "utf8"));
    const override = option(i === 0 ? "before-images" : "after-images", null);
    const [dir, pre] = override ? [override.slice(0, override.lastIndexOf(":")), override.slice(override.lastIndexOf(":") + 1)] : [json.images?.dir, json.images?.prefix ?? ""];
    if (!dir) throw new Error(`${file}: no images directory (pass --${i === 0 ? "before" : "after"}-images <dir>:<prefix>)`);
    return { json, dir: resolve(dir), prefix: pre };
  });
  mkdirSync(outDir, { recursive: true });
  for (const { name } of WINDOWS) {
    const [before, after] = runs.map((run) => {
      const png = decodePng(readFileSync(join(run.dir, `${run.prefix}${name}-side.png`)));
      return renderHalf(png.pixels, png.width, png.height, png.channels);
    });
    writeFileSync(join(outDir, `${name}-render-before.png`), encodePng(before.width, before.height, 3, before.pixels));
    writeFileSync(join(outDir, `${name}-render-after.png`), encodePng(after.width, after.height, 3, after.pixels));
    const pair = sideBySide(before, after);
    writeFileSync(join(outDir, `${name}-before-after.png`), encodePng(pair.width, pair.height, 3, pair.pixels));
  }
  writeFileSync(join(outDir, "residuals.md"), residualsMarkdown(runs[0].json, runs[1].json));
  console.log(`compare: ${WINDOWS.length} windows -> ${outDir} (render-only before/after, residuals.md)`);
  process.exit(0);
}

// ---------------------------------------------------------------- preconditions (exit 2)
let sheet, identity;
try {
  sheet = openSheet(DEFAULT_SHEET);
} catch (error) {
  console.error(`sheet missing: ${DEFAULT_SHEET} (${error.message})`);
  process.exit(2);
}
if (!args.includes("--objects")) try {
  await fetch(url, { signal: AbortSignal.timeout(5000) });
  identity = await readRenderIdentity({ modelPath, modelUrl: new URL(resolveCampusModelUrl(new URL(url).search), url), runId });
} catch (error) {
  console.error(`server unreachable: ${url} (${error.cause?.code ?? error.message})`);
  sheet.close();
  process.exit(2);
}

// ---------------------------------------------------------------- --objects (per-object map-space comparison)
if (args.includes("--objects")) {
  sheet.close();
  const data = resolve(option("data", join(HERE, "..", "campus-model", "data")));
  const report = await runMapComparison({
    dataDir: data,
    meshReportPath: resolve(option("mesh-report", join(data, "..", ".build", "markings.report.json"))),
    rawGlbPath: resolve(option("raw-glb", join(data, "..", ".build", "campus-v2.raw.glb"))),
    parkingPath: resolve(option("parking", join(data, "ground", "parking.json"))),
    referencePath: resolve(option("road-reference", join(data, "photo", "evidence", "road-reference.json"))),
  });
  report.generatedAt = new Date().toISOString();
  const { objects: scored, byTier, parkingRows: rows, parkingLots: lots } = report;
  const overList = scored.filter(r => r.over);
  const leanSource = report.masks.leans;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "objects.json"), `${JSON.stringify(report, null, 1)}\n`);
  const row = (r) => `| ${r.id} | ${r.kind} | ${r.tier} | ${r.near ?? ""} | ${r.residual_m ?? ""} | ${r.iou ?? ""} | ${r.support ?? ""} | ${r.occluded ? "yes" : ""} | ${r.over ? "OVER" : ""} |`;
  const head = "| id | kind | tier | near | residual m | IoU | support | occluded | over |\n|---|---|---|---|---|---|---|---|---|";
  const md = [
    "# Map-space per-object comparison (design §10.1)", "",
    `Sheet ${report.sheet}, ${scored.length} objects from markingCandidates; occlusion leans: ${leanSource}. Values are photo residuals (추정), warnings only.`, "",
    "## By tier", "", "| tier | objects | occluded | unmeasurable | over | median residual m |", "|---|---|---|---|---|---|",
    ...Object.entries(byTier).map(([k, t]) => `| ${k} | ${t.objects} | ${t.occluded} | ${t.unmeasurable} | ${t.over} | ${t.medianResidualM ?? ""} |`), "",
    "## Parking lots (one line per lot; a reviewed lot holds support >= 0.7 or is marked estimated with a reason)", "", "| lot | reviewed | 추정 | support | visible | over | missing | accepted | reason |", "|---|---|---|---|---|---|---|---|---|",
    ...lots.map((l) => `| ${l.lot} | ${l.curated ?? (l.unreviewed ? "UNREVIEWED" : "")} | ${l.estimated ? "추정" : ""} | ${l.support ?? ""} | ${l.visible} | ${l.over.length} | ${l.missing} | ${l.accepted ? "yes" : "NO"} | ${l.estimatedReason ?? ""} |`), "",
    "## Parking rows (generated from parking.json)", "", "| row | tier | dividers | visible | support | median residual m | max residual m | over | missing | back | front | 추정 dividers | 추정 values |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.row} | ${r.tier}${r.estimated ? " 추정" : ""} | ${r.dividers} | ${r.visibleDividers} | ${r.support ?? ""} | ${r.medianResidualM ?? ""} | ${r.maxResidualM ?? ""} | ${r.over.length} | ${r.missing} | ${r.endLines.back?.support ?? ""} | ${r.endLines.front?.support ?? ""} | ${r.estimatedDividers.join(" ")} | ${r.estimatedValues.join(", ")} |`), "",
    `## Over tolerance (${overList.length})`, "", head, ...overList.map(row), "",
  ].join("\n");
  writeFileSync(join(outDir, "objects.md"), md);
  console.log(`OBJECTS ${scored.length} scored, ${scored.filter((r) => r.occluded).length} occluded, ${overList.length} over tolerance; ${join(outDir, "objects.json")}`);
  process.exit(0);
}

// ---------------------------------------------------------------- grid-aligned views
// A view is a grid-aligned rectangle [E0, E0 + widthM] x [N0, N0 + heightM]; its pixels coincide with sheet pixels
// when E0 - 0.125 and N0 + 0.125 fall on sheet pixel edges (TFW centres are at x.125 / x.875).
function viewFor(E0, N0, widthM, heightM) {
  const width = Math.round(widthM / METRES_PER_PIXEL);
  const height = Math.round(heightM / METRES_PER_PIXEL);
  const [col0, row0] = tmToPixel(E0 + METRES_PER_PIXEL / 2, N0 + heightM - METRES_PER_PIXEL / 2, sheet.tfw);
  const centre = tmToScene(E0 + widthM / 2, N0 + heightM / 2);
  const north = tmToScene(E0 + widthM / 2, N0 + heightM / 2 + 1);
  const west = tmToScene(E0, N0 + heightM / 2);
  const east = tmToScene(E0 + widthM, N0 + heightM / 2);
  const south = tmToScene(E0 + widthM / 2, N0);
  const top = tmToScene(E0 + widthM / 2, N0 + heightM);
  const up = [north[0] - centre[0], north[1] - centre[1]];
  const len = Math.hypot(...up);
  return {
    E0, N0, width, height,
    col0: Math.round(col0), row0: Math.round(row0),
    centre, up: [up[0] / len, up[1] / len],
    halfWidth: Math.hypot(east[0] - west[0], east[1] - west[1]) / 2,
    halfHeight: Math.hypot(top[0] - south[0], top[1] - south[1]) / 2,
  };
}
const snap = (v) => Math.round((v - 243324) / METRES_PER_PIXEL) * METRES_PER_PIXEL + 243324;

const extentCorners = [[EXTENT.minX, EXTENT.minZ], [EXTENT.maxX, EXTENT.minZ], [EXTENT.minX, EXTENT.maxZ], [EXTENT.maxX, EXTENT.maxZ]]
  .map(([x, z]) => sceneToTm(x, z));
let tiles = tileGrid(extentCorners, tileM);
const gridTiles = tiles.length;
let campusNote = "all tiles of the EXTENT grid";
if (campusOnly) {
  const campus = JSON.parse(readFileSync(CAMPUS, "utf8"));
  const ring = campus.ring.map(([lon, lat]) => wgs84ToTm(lon, lat));
  tiles = tiles.filter((t) => pointInRing([t.E0 + tileM / 2, t.N0 + tileM / 2], ring));
  campusNote = `tiles whose centre is inside the campus polygon (${campus.id} from data/osm-campus.json, ${campus.licence})`;
}

// ---------------------------------------------------------------- page scripts
const PIN_CLOCK = `(() => {
  const RealDate = Date;
  const offset = RealDate.parse(${JSON.stringify(clock)}) - RealDate.now();
  class PinnedDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
    static now() { return RealDate.now() + offset; }
  }
  window.Date = PinnedDate;
  try { localStorage.setItem("scnu.renderQuality", "low"); } catch {}
  // The default entry opens on the login screen (src/auth/session.mjs): start signed in as the guest admin, as
  // scripts/qa/visual-qa.mjs does, so the campus scene mounts.
  try { localStorage.getItem("scnu.session") ?? localStorage.setItem("scnu.session", JSON.stringify({ token: null, expiresAt: null, account: { id: "guest-admin", name: "게스트", role: "admin", guest: true } })); } catch {}
})();`;
const CAPTURE_STORE = `(() => {
  Object.defineProperty(Object.prototype, "__r3f", {
    configurable: true,
    get() { return undefined; },
    set(value) {
      Object.defineProperty(this, "__r3f", { value, writable: true, configurable: true, enumerable: true });
      if (!window.__blendStore && value && value.root && typeof value.root.getState === "function") window.__blendStore = value.root;
    },
  });
})()`;
const PAGE_HELPERS = `(() => {
  const store = window.__blendStore;
  const scene = () => store.getState().scene;
  let Box3 = null;
  scene().traverse((o) => { if (!Box3 && o.isMesh && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); Box3 = o.geometry.boundingBox.constructor; } });
  window.__blend = {
    d4Centre() {
      const node = scene().getObjectByName("BLD_D4");
      const c = new Box3().setFromObject(node).getCenter(store.getState().camera.position.clone());
      return { x: c.x, y: c.y, z: c.z };
    },
    render({ centreX, centreZ, upX, upZ, halfWidth, halfHeight, width, height, hide }) {
      const state = store.getState();
      const { gl, scene, camera } = state;
      const saved = {
        position: camera.position.clone(), quaternion: camera.quaternion.clone(), up: camera.up.clone(),
        projection: camera.projectionMatrix.clone(), projectionInverse: camera.projectionMatrixInverse.clone(),
        fog: scene.fog, pixelRatio: gl.getPixelRatio(), width: state.size.width, height: state.size.height,
      };
      const hidden = [];
      if (hide) { const re = new RegExp(hide); scene.traverse((o) => { if (o.visible && re.test(o.name || "")) { o.visible = false; hidden.push(o); } }); }
      try {
        scene.fog = null;
        camera.up.set(upX, 0, upZ);
        camera.position.set(centreX, 400, centreZ);
        camera.lookAt(centreX, 0, centreZ);
        camera.updateMatrixWorld(true);
        camera.projectionMatrix.makeOrthographic(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 1000);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        gl.setPixelRatio(1);
        gl.setSize(width, height, false);
        gl.shadowMap.needsUpdate = true;
        gl.render(scene, camera);
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(gl.domElement, 0, 0, width, height);
        const bytes = new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      } finally {
        hidden.forEach((o) => { o.visible = true; });
        scene.fog = saved.fog;
        camera.position.copy(saved.position); camera.quaternion.copy(saved.quaternion); camera.up.copy(saved.up);
        camera.projectionMatrix.copy(saved.projection); camera.projectionMatrixInverse.copy(saved.projectionInverse);
        camera.updateMatrixWorld(true);
        gl.setPixelRatio(saved.pixelRatio); gl.setSize(saved.width, saved.height, false);
        state.invalidate();
      }
    },
  };
  return true;
})()`;

// ---------------------------------------------------------------- images
function composeSide(render, photo, w, h) {
  const gap = 8;
  const W = w * 2 + gap;
  const out = new Uint8Array(W * h * 3).fill(17);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const s = (y * w + x);
      out.set([render[s * 4], render[s * 4 + 1], render[s * 4 + 2]], (y * W + x) * 3);
      out.set(photo.subarray(s * 3, s * 3 + 3), (y * W + w + gap + x) * 3);
    }
  }
  return encodePng(W, h, 3, out);
}
function composeBlend(render, photo, renderEdges, photoEdges, w, h) {
  const gap = 8;
  const W = w * 2 + gap;
  const out = new Uint8Array(W * h * 3).fill(17);
  const scale = (v) => Math.min(255, Math.round((v / EDGE_THRESHOLD) * 160));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const s = y * w + x;
      for (let k = 0; k < 3; k += 1) out[(y * W + x) * 3 + k] = Math.round(0.5 * photo[s * 3 + k] + 0.5 * render[s * 4 + k]);
      const r = scale(renderEdges[s]);
      const c = scale(photoEdges[s]);
      out.set([r, c, c], (y * W + w + gap + x) * 3);
    }
  }
  return encodePng(W, h, 3, out);
}

// ---------------------------------------------------------------- Chrome over the DevTools pipe
const profile = mkdtempSync(join(tmpdir(), "overhead-blend-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--user-data-dir=${profile}`, "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist",
  "--remote-debugging-pipe", "--window-size=1440,900", "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const toChrome = chrome.stdio[3];
const fromChrome = chrome.stdio[4];
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
let sessionId = null;
let inbox = "";
fromChrome.on("data", (chunk) => {
  inbox += chunk.toString("utf8");
  let end;
  while ((end = inbox.indexOf("\0")) >= 0) {
    const message = JSON.parse(inbox.slice(0, end));
    inbox = inbox.slice(end + 1);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 240));
    } else if (message.method === "Runtime.exceptionThrown") {
      const d = message.params.exceptionDetails;
      consoleErrors.push(`EXC ${(d.exception?.description ?? d.text).slice(0, 240)}`);
    }
  }
});
const cdp = (method, params = {}, session = sessionId) => new Promise((ok) => {
  const id = ++nextId;
  pending.set(id, ok);
  toChrome.write(`${JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })}\0`);
});
const evaluate = async (expression) => {
  const reply = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const details = reply.result?.exceptionDetails;
  if (reply.error || details) throw new Error(`page evaluate failed: ${JSON.stringify(reply.error ?? details.exception?.description ?? details.text)}`);
  return reply.result.result.value;
};

// BLD_D4's bbox centre in public/campus-v2.glb (scene frame): POSITION min/max of its primitives, dequantised and mapped
// through the node's translation/scale, as src/campusModelAsset.test.mjs nodeBox reads it.
function d4SceneCentre() {
  return nodeSceneCentre("BLD_D4") ?? { x: D4_SCENE_ANCHOR.x, z: D4_SCENE_ANCHOR.z };
}
function nodeSceneCentre(name) {
  const file = readFileSync(join(HERE, "..", "..", "public", "campus-v2.glb"));
  const gltf = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString("utf8"));
  const node = gltf.nodes.find((n) => n.name === name);
  if (!node?.mesh && node?.mesh !== 0) {
    if (name === "BLD_D4") return null;
    throw new Error(`--buildings: no mesh node ${name} in public/campus-v2.glb`);
  }
  const norm = { 5120: (v) => Math.max(v / 127, -1), 5121: (v) => v / 255, 5122: (v) => Math.max(v / 32767, -1), 5123: (v) => v / 65535 };
  const t = node.translation ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (const p of gltf.meshes[node.mesh].primitives) {
    const a = gltf.accessors[p.attributes.POSITION];
    const d = a.normalized ? norm[a.componentType] : (v) => v;
    for (const c of [a.min, a.max]) {
      [0, 2].forEach((k, i) => { const w = d(c[k]) * s[k] + t[k]; lo[i] = Math.min(lo[i], w); hi[i] = Math.max(hi[i], w); });
    }
  }
  return { x: (lo[0] + hi[0]) / 2, z: (lo[1] + hi[1]) / 2 };
}

let exitCode = 1;
try {
  const { result: { targetInfos } } = await cdp("Target.getTargets", {}, null);
  const page = targetInfos.find((t) => t.type === "page");
  sessionId = (await cdp("Target.attachToTarget", { targetId: page.targetId, flatten: true }, null)).result.sessionId;
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: PIN_CLOCK + CAPTURE_STORE });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url });

  let ready = false;
  for (let i = 0; i < 240 && !ready; i += 1) {
    ready = await evaluate(`Boolean(window.__blendStore && window.__blendStore.getState().scene.getObjectByName("BLD_D4") && document.querySelectorAll("[data-qa=campus-label]").length > 5)`);
    if (!ready) await Bun.sleep(500);
  }
  if (!ready) throw new Error("campus model did not load (no R3F store, BLD_D4 or campus labels within 120 s)");
  await Bun.sleep(3000); // let textures finish uploading (same settle as compare-satellite.mjs)
  await evaluate(PAGE_HELPERS);
  const d4World = await evaluate("window.__blend.d4Centre()");
  // world minus scene: BLD_D4's bbox centre in the page against the same centre in the GLB's scene frame. In Frame v2
  // the bbox centre is not D4_SCENE_ANCHOR (the anchor is the GIS footprint centroid, the node bbox spans its LOD4
  // masses), so the scene-frame centre is read from the GLB the page loads rather than assumed to be the anchor.
  const d4Scene = d4SceneCentre();
  const offset = { x: d4World.x - d4Scene.x, z: d4World.z - d4Scene.z };
  console.log(`FRAME world-minus-scene offset x=${offset.x.toFixed(3)} z=${offset.z.toFixed(3)}; grid convergence ${GRID_CONVERGENCE_DEG.toFixed(4)} deg`);

  mkdirSync(outDir, { recursive: true });
  const measure = async (view, label) => {
    const b64 = await evaluate(`window.__blend.render(${JSON.stringify({
      centreX: view.centre[0] + offset.x, centreZ: view.centre[1] + offset.z, upX: view.up[0], upZ: view.up[1],
      halfWidth: view.halfWidth, halfHeight: view.halfHeight, width: view.width, height: view.height,
    })})`);
    const render = new Uint8Array(Buffer.from(b64, "base64"));
    const photo = sheet.readWindow(view.col0, view.row0, view.width, view.height);
    const result = measureTile({ render, photo, width: view.width, height: view.height, channels: 4, maxShift, edgeFloor, passPx: PASS_PX });
    writeFileSync(join(outDir, `${prefix}${label}-side.png`), composeSide(render, photo, view.width, view.height));
    writeFileSync(join(outDir, `${prefix}${label}-blend.png`), composeBlend(render, photo, result.renderEdges, result.photoEdges, view.width, view.height));
    const { renderEdges, photoEdges, ...rest } = result;
    if (occlusion) {
      const win = { w: view.width, h: view.height, gsdM: METRES_PER_PIXEL, origin: [view.E0, view.N0 + view.height * METRES_PER_PIXEL] };
      const near = (x0, x1, y0, y1) => ({
        buildings: OCCLUDERS.buildings.filter((b) => b.rings[0].some(([E, N]) => E > x0 - 60 && E < x1 + 60 && N > y0 - 60 && N < y1 + 60)),
        trees: OCCLUDERS.trees.filter((t) => t.east > x0 - 30 && t.east < x1 + 30 && t.north > y0 - 30 && t.north < y1 + 30),
      });
      const { any } = occlusionMask(win, near(view.E0, view.E0 + view.width * METRES_PER_PIXEL, view.N0, win.origin[1]));
      const o = measureVisible({ render, photo, width: view.width, height: view.height, channels: 4, excluded: any, maxShift, passPx: PASS_PX });
      rest.occluded = { dx: o.dx, dy: o.dy, ratio: o.ratio, verdict: o.verdict, visibleShare: o.visibleShare, reason: o.reason };
    }
    return rest;
  };

  // visible-ground pass of one tile: ground-only render, footprints (+ lean buffer) and photo canopy removed from both
  const footprints = visibleGround ? JSON.parse(readFileSync(BUILDINGS, "utf8")).buildings.flatMap((b) => b.polygons.map((poly) => poly[0].map(([lon, lat]) => wgs84ToTm(lon, lat)))) : [];
  const measureVisibleTile = async (view, label) => {
    const b64 = await evaluate(`window.__blend.render(${JSON.stringify({
      centreX: view.centre[0] + offset.x, centreZ: view.centre[1] + offset.z, upX: view.up[0], upZ: view.up[1],
      halfWidth: view.halfWidth, halfHeight: view.halfHeight, width: view.width, height: view.height, hide: VISIBLE_HIDE,
    })})`);
    const render = new Uint8Array(Buffer.from(b64, "base64"));
    const photo = sheet.readWindow(view.col0, view.row0, view.width, view.height);
    const toPx = ([E, N]) => [(E - view.E0) / METRES_PER_PIXEL, (view.N0 + view.height * METRES_PER_PIXEL - N) / METRES_PER_PIXEL];
    const feet = footprintMask(footprints.map((ring) => ring.map(toPx)), view.width, view.height, VISIBLE.leanBufferM / METRES_PER_PIXEL);
    const canopy = canopyMask(photo, view.width, view.height);
    const excluded = feet.map((v, i) => v | canopy[i]);
    const result = measureVisible({ render, photo, width: view.width, height: view.height, channels: 4, excluded, maxShift, passPx: PASS_PX });
    const dimmed = photo.slice();
    for (let i = 0; i < excluded.length; i += 1) if (excluded[i]) for (let k = 0; k < 3; k += 1) dimmed[i * 3 + k] >>= 2;
    writeFileSync(join(outDir, `${prefix}${label}-visible-blend.png`), composeBlend(render, dimmed, result.renderEdges, result.photoEdges, view.width, view.height));
    const { renderEdges, photoEdges, ...rest } = result;
    return { ...rest, footprintShare: Math.round((feet.reduce((n, v) => n + v, 0) / feet.length) * 10000) / 10000 };
  };

  const tileResults = [];
  const visibleResults = [];
  for (const t of tiles) {
    const r = await measure(viewFor(t.E0, t.N0, tileM, tileM), `tile-${t.E0}-${t.N0}`);
    tileResults.push({ E0: t.E0, N0: t.N0, ...r });
    console.log(`TILE ${t.E0} ${t.N0} dx=${r.dx} dy=${r.dy} ratio=${r.ratio} edgeShare=${r.edgeShare} signal=${r.signal} pass=${r.pass}${r.occluded ? ` occ=${r.occluded.verdict}:${r.occluded.dx},${r.occluded.dy}:vis=${r.occluded.visibleShare}` : ""}`);
    if (visibleGround) {
      const v = await measureVisibleTile(viewFor(t.E0, t.N0, tileM, tileM), `tile-${t.E0}-${t.N0}`);
      visibleResults.push({ E0: t.E0, N0: t.N0, ...v });
      console.log(`VISIBLE ${t.E0} ${t.N0} ${v.verdict} dx=${v.dx} dy=${v.dy} ratio=${v.ratio} visible=${v.visibleShare} edgeShare=${v.edgeShare}${v.reason ? ` (${v.reason})` : ""}`);
    }
  }
  // --buildings A,B,...: one 60 x 60 m window per named BLD_* node, centred on its bbox in the GLB scene frame (local QA
  // only; the windows are measured and saved like the fixed ones).
  const named = option("buildings", "").split(",").filter(Boolean).map((id) => ({ name: `bld-${id.replace(/^BLD_/, "")}`, ...nodeSceneCentre(`BLD_${id.replace(/^BLD_/, "")}`), widthM: 60, heightM: 60 }));
  const windows = [];
  for (const w of [...WINDOWS, ...named]) {
    const [Ec, Nc] = sceneToTm(w.x, w.z);
    const view = viewFor(snap(Ec - w.widthM / 2), snap(Nc - w.heightM / 2), w.widthM, w.heightM);
    const r = await measure(view, w.name);
    windows.push({ name: w.name, E0: view.E0, N0: view.N0, ...r });
    console.log(`WINDOW ${w.name} E0=${view.E0} N0=${view.N0} dx=${r.dx} dy=${r.dy} ratio=${r.ratio} edgeShare=${r.edgeShare}${r.occluded ? ` occ=${r.occluded.verdict}:${r.occluded.dx},${r.occluded.dy}:vis=${r.occluded.visibleShare}` : ""}`);
  }

  const summary = aggregate(tileResults);
  const visibleSummary = visibleGround ? aggregateVisible(visibleResults) : null;
  const report = {
    generatedAt: new Date().toISOString(),
    identity,
    url,
    sheet: DEFAULT_SHEET.split("/").pop(),
    clock,
    quality: "low (localStorage scnu.renderQuality, commit ef17188)",
    metresPerPixel: METRES_PER_PIXEL,
    tileM,
    tileSelection: campusNote,
    gridTiles,
    thresholds: { passPx: PASS_PX, maxShift, edgeFloor, edgeThreshold: EDGE_THRESHOLD },
    convention: "dx > 0: render content east of the photo; dy > 0: render content south of the photo (pixels of 0.25 m)",
    ...summary,
    tiles: tileResults,
    windows,
    images: { dir: outDir, prefix },
    ...(visibleGround ? { visibleGround: {
      description: "ground-only render vs photo with building footprints (+ lean buffer) and photo canopy/shade removed from both edge maps; same 1 px threshold",
      hide: VISIBLE_HIDE, footprints: "data/gis-buildings.json", thresholds: { passPx: PASS_PX, maxShift, ...VISIBLE }, ...visibleSummary, tiles: visibleResults,
    } } : {}),
    consoleErrors,
  };
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`RESULT ${summary.pass ? "PASS" : "FAIL"}: ${summary.signalTiles}/${summary.tilesTotal} signal tiles, ${summary.failingTiles} beyond ${PASS_PX} px, max shift ${summary.maxShiftPx} px; json ${jsonPath}`);
  if (visibleSummary) console.log(`RESULT_VISIBLE ${visibleSummary.pass ? "PASS" : "FAIL"}: ${visibleSummary.measurableTiles}/${visibleSummary.tilesTotal} measurable tiles, ${visibleSummary.failingTiles} beyond ${PASS_PX} px, ${visibleSummary.notMeasurable} not measurable`);
  console.log(`CONSOLE_ERRORS ${consoleErrors.length}`);
  exitCode = summary.pass && (!visibleSummary || visibleSummary.pass) ? 0 : 1;
} catch (error) {
  exitCode = 1;
  console.error("OVERHEAD_BLEND_ERROR", error.stack ?? error);
} finally {
  sheet.close();
  chrome.kill();
  await new Promise((done) => (chrome.exitCode !== null ? done() : chrome.once("exit", done)));
  rmSync(profile, { recursive: true, force: true });
}
process.exit(exitCode);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

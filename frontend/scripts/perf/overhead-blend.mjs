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
// Exit 0 PASS, 1 FAIL, 2 missing sheet or unreachable server (NGII_SHEET overrides the sheet path).
// Chrome is driven over --remote-debugging-pipe, so no TCP port is opened besides the dev server's.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { D4_SCENE_ANCHOR, EXTENT } from "../campus-model/lib/frame.mjs";
import { DEFAULT_SHEET, openSheet } from "../campus-model/lib/ngiiSheet.mjs";
import { decodePng, encodePng } from "../campus-model/lib/png.mjs";
import { GRID_CONVERGENCE_DEG, sceneToTm, tmToPixel, tmToScene, wgs84ToTm } from "../../src/geo/epsg5186.mjs";
import { EDGE_THRESHOLD, VISIBLE, aggregate, aggregateVisible, canopyMask, footprintMask, measureTile, measureVisible, pointInRing, renderHalf, residualsMarkdown, sideBySide, tileGrid } from "./overheadBlendCore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CAMPUS = join(HERE, "../campus-model/data/osm-campus.json");
const BUILDINGS = join(HERE, "../campus-model/data/gis-buildings.json");
// Ground-only render of the visible-ground mode: the GLB roots and runtime groups that are not ground.
const VISIBLE_HIDE = "^(BLD_|CampusBuildings|Trees_|Furniture|Lamps_|campus-traffic)";
const METRES_PER_PIXEL = 0.25;
const PASS_PX = 1;

// Same windows as compare-satellite.mjs (scene units), 200 x 150 m => 800 x 600 px.
const WINDOWS = [
  { name: "d4-block", x: 46.5, z: -266.6, widthM: 200, heightM: 150 },
  { name: "main-gate", x: 450, z: -160, widthM: 200, heightM: 150 },
  { name: "central-lawn", x: 260, z: -230, widthM: 200, heightM: 150 },
  { name: "east-woodland", x: 355, z: -185, widthM: 200, heightM: 150 },
];

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
let sheet;
try {
  sheet = openSheet(DEFAULT_SHEET);
} catch (error) {
  console.error(`sheet missing: ${DEFAULT_SHEET} (${error.message})`);
  process.exit(2);
}
try {
  await fetch(url, { signal: AbortSignal.timeout(5000) });
} catch (error) {
  console.error(`server unreachable: ${url} (${error.cause?.code ?? error.message})`);
  sheet.close();
  process.exit(2);
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
  const offset = { x: d4World.x - D4_SCENE_ANCHOR.x, z: d4World.z - D4_SCENE_ANCHOR.z };
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
    console.log(`TILE ${t.E0} ${t.N0} dx=${r.dx} dy=${r.dy} ratio=${r.ratio} edgeShare=${r.edgeShare} signal=${r.signal} pass=${r.pass}`);
    if (visibleGround) {
      const v = await measureVisibleTile(viewFor(t.E0, t.N0, tileM, tileM), `tile-${t.E0}-${t.N0}`);
      visibleResults.push({ E0: t.E0, N0: t.N0, ...v });
      console.log(`VISIBLE ${t.E0} ${t.N0} ${v.verdict} dx=${v.dx} dy=${v.dy} ratio=${v.ratio} visible=${v.visibleShare} edgeShare=${v.edgeShare}${v.reason ? ` (${v.reason})` : ""}`);
    }
  }
  const windows = [];
  for (const w of WINDOWS) {
    const [Ec, Nc] = sceneToTm(w.x, w.z);
    const view = viewFor(snap(Ec - w.widthM / 2), snap(Nc - w.heightM / 2), w.widthM, w.heightM);
    const r = await measure(view, w.name);
    windows.push({ name: w.name, E0: view.E0, N0: view.N0, ...r });
    console.log(`WINDOW ${w.name} E0=${view.E0} N0=${view.N0} dx=${r.dx} dy=${r.dy} ratio=${r.ratio} edgeShare=${r.edgeShare}`);
  }

  const summary = aggregate(tileResults);
  const visibleSummary = visibleGround ? aggregateVisible(visibleResults) : null;
  const report = {
    generatedAt: new Date().toISOString(),
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

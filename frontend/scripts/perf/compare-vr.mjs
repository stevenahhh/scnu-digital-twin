// VR-vs-render comparison harness (local QA only; nothing here ships).
//
// For each exterior station of the SCNU 360 VR tour it renders the Legacy dashboard's campus model from
// the station position and height with four 90-degree perspective cameras (the cube faces f, r, b, l) and
// puts each render next to the cached VR cube face of the same direction. Per scene it writes:
//   <prefix><scene>-<face>-side.png  render | VR face, 1024 px each, 30 px header
//   <prefix><scene>-strip.png        row 1 VR l f r b at 512 px, row 2 the renders in the same order
// VR faces are read from scripts/campus-model/.cache/vr/<scene>/pano_<face>.jpg (gitignored). They are
// compared, never copied into the product: outputs stay under .omo/ and are never committed.
//
// Usage (dev server already running, e.g. `bun x vite --host 127.0.0.1 --port 5182` in frontend/):
//   bun scripts/perf/compare-vr.mjs (--scene <id> [--scene <id> ...] | --all) [--stations <file>]
//       [--faces f,r,b,l] [--yaw-offset <deg>] [--out <dir>] [--prefix <label->]
//       [--url http://127.0.0.1:5182/] [--port 9353] [--clock 2026-10-24T12:00:00+09:00] [--list]
//       [--bearings] [--bearing-records <file>]
//       [--free-standing] uses reviewed VR silhouettes and packed _OBJECT_ID masks.
// --bearings reads records[].evidence.refs ("VR scene_e5 r col 610"), renders the actual object's
// ID mask, writes bearings.json and returns 1 for missing masks, wrong walls or residuals above 1.5 deg.
// It does not fabricate readings for an occluded reference. Unrefined scenes are T4 with no residual.
//   --stations defaults to scripts/perf/vr-stations.json; yaw_refined_deg / station_refined_x /
//   station_refined_z are used when a record has them.
//   --list prints every station's scene-frame position, yaw and terrain height and exits.
//
// Camera method (same page mechanics as compare-satellite.mjs): an init script captures the
// react-three-fiber store; each face is rendered in one synchronous page task with the default camera
// moved to the station, a 90-degree square perspective projection (near 0.5, far 3000), fog off and the
// renderer resized to 1024 x 1024, then everything is restored. The camera height is the terrain under
// the station (ray straight down against the runtime ground meshes, including the partitioned Ground_* surfaces;
// a miss is an error, never an invented y = 0) plus height_refined_m (when a record has it) or
// height_m_est in scene units. Face bearings follow lib/vrCamera.mjs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENE_UNITS_PER_METRE } from "../campus-model/lib/frame.mjs";
import { bearingToDirection, faceYaw, groundTargets, modelWorldOffset, stationWorld, terrainHeight } from "./lib/vrCamera.mjs";
import { GROUND_MESH_NAME } from "../../src/camera/terrainClearance.mjs";
import { bearingObservations, bearingResidual, readBearing } from "../campus-model/fit/vrWallHit.mjs";
import { checkSceneRefs, firstBuildingHit, loadSceneBuildings, SCENE_MAP_FILE, sceneMapInputs } from "../campus-model/fit/vrSceneBuildings.mjs";
import { geoToModel } from "../campus-model/lib/frame.mjs";
import { objectObservations } from "../campus-model/fit/vrObjectObservations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const QA_DIR = join(REPO, ".omo/ulw-research/20261025-091647/qa/uhf-vr-buildings-pavilions");
const VR_CACHE = join(HERE, "../campus-model/.cache/vr");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SIZE = 1024;
const NEAR = 0.5;
const FAR = 3000;
const STRIP_ORDER = ["l", "f", "r", "b"];

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const options = (name) => args.flatMap((value, index) => (args[index - 1] === `--${name}` ? [value] : []));
const url = option("url", "http://127.0.0.1:5182/");
const port = option("port", "9353");
const outDir = resolve(option("out", join(QA_DIR, "compare-vr")));
const prefix = option("prefix", "");
const stationsFile = resolve(option("stations", join(HERE, "vr-stations.json")));
const yawOffset = Number(option("yaw-offset", "0"));
const faces = option("faces", "f,r,b,l").split(",").map((face) => face.trim());
const listOnly = args.includes("--list");
const clock = option("clock", "2026-10-24T12:00:00+09:00");
const freeStanding = args.includes("--free-standing");
const bearingsOnly = args.includes("--bearings") || freeStanding;
const bearingFile = resolve(option("bearing-records", join(HERE, freeStanding
  ? "../campus-model/data/free-standing-vr.json" : "../campus-model/data/buildings/entrances.json")));
const modelBytes = freeStanding ? readFileSync(join(HERE, "../../public/campus-v2.glb")) : null;
const modelJson = modelBytes ? JSON.parse(modelBytes.subarray(20, 20 + modelBytes.readUInt32LE(12)).toString()) : null;
const renderObjectIds = modelJson?.nodes.find(n => n.extras?.renderObjectIds)?.extras.renderObjectIds;
let observations = [], buildings = [], sceneTable = null;

const stations = JSON.parse(readFileSync(stationsFile, "utf8"));
const byScene = new Map(stations.map((record) => [record.scene, record]));
function selectScenes() {
  if (listOnly || args.includes("--all")) return stations;
  const ids = options("scene");
  if (ids.length === 0) throw new Error("give --scene <id> (repeatable), --all or --list");
  return ids.map((id) => {
    const record = byScene.get(id);
    if (!record) throw new Error(`unknown scene ${id} (not in ${stationsFile})`);
    return record;
  });
}
let selected;
try {
  if (Number.isNaN(Date.parse(clock))) throw new Error(`--clock is not a date: ${clock}`);
  if (!Number.isFinite(yawOffset)) throw new Error(`--yaw-offset is not a number`);
  for (const face of faces) if (!STRIP_ORDER.includes(face)) throw new Error(`unsupported face ${face} (f, r, b, l only)`);
  selected = selectScenes();
  if (bearingsOnly) {
    const records = JSON.parse(readFileSync(bearingFile, "utf8"));
    // Explicit T4 entries without a VR observation cannot have a residual; malformed observed refs still fail.
    observations = (freeStanding ? objectObservations(records, stations) :
      bearingObservations({ ...records, records: records.records.filter(r => r.evidence?.tier !== "T4" ||
        r.evidence.refs.some(ref => typeof ref === "string" && ref.startsWith("VR "))) }, stations))
      .filter(o => selected.some(s => s.scene === o.scene) && faces.includes(o.face));
    if (!freeStanding) {
      const saved = JSON.parse(readFileSync(SCENE_MAP_FILE, "utf8"));
      if (JSON.stringify(saved.inputs) !== JSON.stringify(sceneMapInputs())) throw new Error("stale scene-building table; run vrSceneBuildings.mjs --write");
      buildings = await loadSceneBuildings();
      sceneTable = saved;
    }
    if (yawOffset !== 0) throw new Error("--bearings requires the refined yaw without --yaw-offset");
  }
  if (!listOnly) {
    for (const record of selected) {
      for (const face of faces) {
        const file = join(VR_CACHE, record.scene, `pano_${face}.jpg`);
        if (!existsSync(file)) throw new Error(`missing VR face ${file}`);
      }
    }
  }
} catch (error) {
  console.error("COMPARE_ERROR", error.message);
  process.exit(1);
}

const yawOf = (record) => (record.yaw_refined_deg ?? record.yaw_deg) + yawOffset;
const confOf = (record) => record.refined_confidence ?? record.confidence;

// Runs before any page script: shifts Date so the dashboard's live clock starts at `clock`.
const PIN_CLOCK = `(() => {
  const RealDate = Date;
  const offset = RealDate.parse(${JSON.stringify(clock)}) - RealDate.now();
  class PinnedDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
    static now() { return RealDate.now() + offset; }
  }
  window.Date = PinnedDate;
  // Compare on the Low tier, which renders straight to sRGB (see compare-satellite.mjs).
  try { localStorage.setItem("scnu.renderQuality", "low"); } catch {}
})();`;

// Runs before the app: keep the first R3F root store that shows up on an instance record.
const CAPTURE_STORE = `(() => {
  Object.defineProperty(Object.prototype, "__r3f", {
    configurable: true,
    get() { return undefined; },
    set(value) {
      Object.defineProperty(this, "__r3f", { value, writable: true, configurable: true, enumerable: true });
      if (!window.__compareStore && value && value.root && typeof value.root.getState === "function") {
        window.__compareStore = value.root;
      }
    },
  });
})()`;

// Page-side helpers, installed once the model is loaded.
const PAGE_HELPERS = `(() => {
  const GROUND_MESH_NAME = ${GROUND_MESH_NAME};
  const groundTargets = ${groundTargets.toString()};
  const terrainHeight = ${terrainHeight.toString()};
  const store = window.__compareStore;
  const findNode = (name) => store.getState().scene.getObjectByName(name);
  const anyBox = () => {
    let box = null;
    store.getState().scene.traverse((o) => {
      if (!box && o.isMesh && o.geometry) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box = o.geometry.boundingBox;
      }
    });
    return box;
  };
  const Box3 = anyBox().constructor;
  const worldCentre = (object) => {
    const centre = new Box3().setFromObject(object).getCenter(store.getState().camera.position.clone());
    return { x: centre.x, y: centre.y, z: centre.z };
  };
  const toBase64 = async (canvas) => {
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  const bitmap = async (dataUrl) => createImageBitmap(await (await fetch(dataUrl)).blob());
  window.__vrFaces = {};
  window.__vrRenders = {};
  window.__compare = {
    worldCentre: (name) => { const n = findNode(name); return n ? worldCentre(n) : null; },
    groupTransform() {
      const d4 = findNode("BLD_D4");
      return d4 ? Array.from(d4.parent.matrixWorld.elements) : null;
    },
    terrainY(x, z) {
      return terrainHeight(store.getState(), [x, z]);
    },
    async referenceMask({ face, polygon, col }) {
      const canvas = new OffscreenCanvas(2048, 2048);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(window.__vrFaces[face], 0, 0, 2048, 2048);
      ctx.beginPath();
      polygon.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.fillStyle = "rgba(255,0,0,0.35)"; ctx.fill();
      ctx.strokeStyle = "#ff0000"; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = "#ffff00"; ctx.beginPath(); ctx.moveTo(col, 0); ctx.lineTo(col, 2048); ctx.stroke();
      return toBase64(canvas);
    },
    async objectMask({ id, objectId, ring, offset, render }) {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const state = store.getState();
      const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
      const red = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, toneMapped: false });
      const saved = [], temporary = [];
      const background = state.scene.background;
      let triangles = 0, image;
      const inside = (x, z) => {
        let hit = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [a, b] = ring[i], [c, d] = ring[j];
          if ((b > z) !== (d > z) && x < (c - a) * (z - b) / (d - b) + a) hit = !hit;
        }
        return hit;
      };
      const object = findNode(id);
      const named = new Set();
      object?.traverse(o => { if (o.isMesh) named.add(o); });
      try {
        state.scene.background = new THREE.Color(0);
        state.scene.traverse(o => {
          if (!o.isMesh) return;
          saved.push({ o, material: o.material, geometry: o.geometry });
          o.material = named.has(o) ? red : black;
          if (named.has(o)) triangles += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
          if (objectId !== undefined) {
            const attribute = o.geometry.getAttribute("_object_id");
            if (!attribute) return;
            const geometry = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
            const ids = geometry.getAttribute("_object_id");
            const colours = new Float32Array(ids.count * 3);
            for (let i = 0; i < ids.count; i += 3) {
              if (ids.getX(i) !== objectId) continue;
              if (ids.getX(i + 1) !== objectId || ids.getX(i + 2) !== objectId) throw new Error("mixed object IDs in one triangle");
              for (let k = 0; k < 3; k++) colours[(i + k) * 3] = 1;
              triangles += 1;
            }
            geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
            const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
            o.geometry = geometry; o.material = material;
            temporary.push(geometry, material);
            return;
          }
          if (object || !ring || !/^Furniture(?:_|$)/.test(o.name)) return;
          const geometry = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
          const p = geometry.attributes.position;
          const candidates = [];
          const v = new THREE.Vector3();
          let top = -Infinity;
          for (let i = 0; i < p.count; i += 3) {
            const vertices = [0, 1, 2].map(k => v.fromBufferAttribute(p, i + k).applyMatrix4(o.matrixWorld).clone());
            const x = vertices.reduce((sum, q) => sum + q.x, 0) / 3 - offset.x;
            const z = vertices.reduce((sum, q) => sum + q.z, 0) / 3 - offset.z;
            if (!inside(x, z)) continue;
            const y = vertices.reduce((sum, q) => sum + q.y, 0) / 3;
            candidates.push({ i, y });
            top = Math.max(top, y);
          }
          const colours = new Float32Array(p.count * 3);
          for (const c of candidates) if (c.y >= top - ${SCENE_UNITS_PER_METRE} * 0.4) {
            for (let k = 0; k < 3; k++) colours[(c.i + k) * 3] = 1;
            triangles += 1;
          }
          geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
          const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
          o.geometry = geometry;
          o.material = material;
          temporary.push(geometry, material);
        });
        image = window.__compare.render(render);
      } finally {
        for (const s of saved) { s.o.material = s.material; s.o.geometry = s.geometry; }
        for (const item of temporary) item.dispose();
        black.dispose(); red.dispose();
        state.scene.background = background;
      }
      // Restore synchronously before yielding: WaterReflections' next frame needs its real uniforms.
      const canvas = new OffscreenCanvas(render.size, render.size);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(await bitmap(image), 0, 0);
      const pixels = ctx.getImageData(0, 0, render.size, render.size).data;
      let min = render.size, max = -1, count = 0, columnSum = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 200 && pixels[i + 1] < 30 && pixels[i + 2] < 30) {
        const x = (i / 4) % render.size;
        min = Math.min(min, x); max = Math.max(max, x); count += 1;
        columnSum += x + 0.5;
      }
      return { col: count ? (objectId !== undefined ? columnSum / count / render.size * 2048 : (min + max + 1) / render.size * 1024) : null,
        pixels: count, triangles, image };
    },
    render({ px, py, pz, dx, dz, size, near, far }) {
      const state = store.getState();
      const { gl, scene, camera } = state;
      const saved = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        up: camera.up.clone(),
        projection: camera.projectionMatrix.clone(),
        projectionInverse: camera.projectionMatrixInverse.clone(),
        fog: scene.fog,
        pixelRatio: gl.getPixelRatio(),
        width: state.size.width,
        height: state.size.height,
      };
      try {
        scene.fog = null;
        camera.up.set(0, 1, 0);
        camera.position.set(px, py, pz);
        camera.lookAt(px + dx, py, pz + dz);
        camera.updateMatrixWorld(true);
        // Vertical FOV 90 degrees, aspect 1: the frustum half-size at the near plane equals near.
        camera.projectionMatrix.makePerspective(-near, near, near, -near, near, far);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        gl.setPixelRatio(1);
        gl.setSize(size, size, false);
        gl.shadowMap.needsUpdate = true;
        gl.render(scene, camera);
        return gl.domElement.toDataURL("image/png");
      } finally {
        scene.fog = saved.fog;
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        camera.up.copy(saved.up);
        camera.projectionMatrix.copy(saved.projection);
        camera.projectionMatrixInverse.copy(saved.projectionInverse);
        camera.updateMatrixWorld(true);
        gl.setPixelRatio(saved.pixelRatio);
        gl.setSize(saved.width, saved.height, false);
        state.invalidate();
      }
    },
    async loadFace(face, dataUrl) {
      window.__vrFaces[face] = await bitmap(dataUrl);
      return [window.__vrFaces[face].width, window.__vrFaces[face].height];
    },
    async composeSide({ face, renderUrl, size, left, right }) {
      const render = await bitmap(renderUrl);
      window.__vrRenders[face] = render;
      const header = 30, gap = 8;
      const side = new OffscreenCanvas(size * 2 + gap, size + header);
      const s = side.getContext("2d");
      s.fillStyle = "#111";
      s.fillRect(0, 0, side.width, side.height);
      s.drawImage(render, 0, header, size, size);
      s.drawImage(window.__vrFaces[face], size + gap, header, size, size);
      s.fillStyle = "#fff";
      s.font = "14px sans-serif";
      s.fillText(left, 8, 20);
      s.fillText(right, size + gap + 8, 20);
      return toBase64(side);
    },
    async composeStrip({ order, tile, title, labels }) {
      const header = 30;
      const strip = new OffscreenCanvas(tile * order.length, header + tile * 2);
      const s = strip.getContext("2d");
      s.fillStyle = "#111";
      s.fillRect(0, 0, strip.width, strip.height);
      s.fillStyle = "#fff";
      s.font = "14px sans-serif";
      s.fillText(title, 8, 20);
      order.forEach((face, i) => {
        const x = i * tile;
        s.drawImage(window.__vrFaces[face], x, header, tile, tile);
        s.drawImage(window.__vrRenders[face], x, header + tile, tile, tile);
        for (const row of [header, header + tile]) {
          // Yellow ticks at face columns 512 / 1024 / 1536 of 2048, like the contact sheets.
          s.fillStyle = "#ffd400";
          for (const q of [0.25, 0.5, 0.75]) {
            s.fillRect(x + Math.round(tile * q) - 1, row, 2, 14);
            s.fillRect(x + Math.round(tile * q) - 1, row + tile - 14, 2, 14);
          }
          s.fillStyle = "rgba(0,0,0,0.6)";
          s.fillRect(x + 4, row + 18, 210, 22);
          s.fillStyle = "#fff";
          s.font = "13px sans-serif";
          s.fillText((row === header ? "VR " : "render ") + labels[face], x + 8, row + 34);
        }
        s.fillStyle = "#111";
        s.fillRect(x + tile - 1, header, 2, tile * 2);
      });
      return toBase64(strip);
    },
  };
  return true;
})()`;

const profile = mkdtempSync(join(tmpdir(), "compare-vr-"));
const chrome = Bun.spawn(
  [
    CHROME,
    "--headless=new",
    `--user-data-dir=${profile}`,
    "--use-angle=metal",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    `--remote-debugging-port=${port}`,
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore" },
);

let exitCode = 0;
let ws;
try {
  let version = null;
  for (let i = 0; i < 80 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await Bun.sleep(250);
    }
  }
  if (!version) throw new Error(`Chrome CDP did not come up on port ${port}`);
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  let nextId = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 240));
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      consoleErrors.push(`EXC ${(details.exception?.description ?? details.text).slice(0, 240)}`);
    }
  };
  const cdp = (method, params = {}) =>
    new Promise((ok) => {
      const id = ++nextId;
      pending.set(id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const reply = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const details = reply.result?.exceptionDetails;
    if (reply.error || details) {
      throw new Error(`page evaluate failed: ${JSON.stringify(reply.error ?? details.exception?.description ?? details.text)}`);
    }
    return reply.result.result.value;
  };

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: PIN_CLOCK + CAPTURE_STORE });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const navigation = await cdp("Page.navigate", { url });
  if (navigation.result?.errorText) {
    throw new Error(`campus model did not load (navigation to ${url} failed: ${navigation.result.errorText})`);
  }

  let ready = false;
  for (let i = 0; i < 240 && !ready; i++) {
    ready = await evaluate(
      `Boolean(window.__compareStore && window.__compareStore.getState().scene.getObjectByName("BLD_D4") && document.querySelectorAll("[data-qa=campus-label]").length > 5)`,
    );
    if (!ready) await Bun.sleep(500);
  }
  if (!ready) throw new Error("campus model did not load (no R3F store, BLD_D4 or campus labels within 120 s)");
  await Bun.sleep(3000); // let textures finish uploading
  await evaluate(PAGE_HELPERS);

  // The runtime may recentre the model group after the first frames, so the scene-to-world offset is measured
  // again for every station and logged whenever it changes.
  let offset = null;
  const measureOffset = async () => {
    const groupMatrix = await evaluate(`window.__compare.groupTransform()`);
    const next = modelWorldOffset(groupMatrix);
    if (!offset || Math.abs(next.x - offset.x) > 1e-3 || Math.abs(next.z - offset.z) > 1e-3) {
      console.log(`FRAME offset world-minus-scene x=${next.x.toFixed(3)} z=${next.z.toFixed(3)}; D4 parent matrixWorld=${JSON.stringify(groupMatrix.map((v) => +v.toFixed(4)))}`);
    }
    offset = next;
  };

  const placeStation = async (record) => {
    await measureOffset();
    const world = stationWorld(record, offset);
    const terrain = await evaluate(`window.__compare.terrainY(${world.x}, ${world.z})`);
    if (terrain === null) {
      throw new Error(`NO_TERRAIN ${record.scene} x=${world.x.toFixed(2)} z=${world.z.toFixed(2)}: no valid camera height`);
    }
    return { world, terrain, y: terrain + (record.height_refined_m ?? record.height_m_est) * SCENE_UNITS_PER_METRE };
  };

  if (listOnly) {
    for (const record of selected) {
      const { world, terrain, y } = await placeStation(record);
      console.log(
        `LIST ${record.scene} scene x=${(world.x - offset.x).toFixed(2)} z=${(world.z - offset.z).toFixed(2)} world x=${world.x.toFixed(2)} z=${world.z.toFixed(2)} terrainY=${terrain.toFixed(2)} cameraY=${y.toFixed(2)} yaw=${yawOf(record)} method=${record.method} conf=${confOf(record)}`,
      );
    }
  } else {
    mkdirSync(outDir, { recursive: true });
    const bearingRows = [];
    const siteFeatures = bearingsOnly && !freeStanding ? JSON.parse(readFileSync(join(HERE, "../campus-model/data/photo/site-detail.geojson"), "utf8")).features : [];
    for (const record of selected) {
      const scene = record.scene;
      const yaw = yawOf(record);
      if (bearingsOnly && readBearing(record, { face: "f", col: 1024 }).tier === "T4") {
        bearingRows.push({ scene, tier: "T4", estimated: true, residualDeg: null, reason: "unrefined_station" });
        continue;
      }
      const { world, y } = await placeStation(record);
      const refined = record.yaw_refined_deg != null || record.station_refined_x != null ? " refined" : "";
      console.log(
        `STATION ${scene} x=${(world.x - offset.x).toFixed(2)} z=${(world.z - offset.z).toFixed(2)} y=${y.toFixed(2)} yaw=${yaw} method=${record.method}${refined} conf=${confOf(record)}`,
      );
      const labels = {};
      for (const face of faces) {
        const bearing = faceYaw(yaw, face);
        labels[face] = `${face} ${bearing.toFixed(1)} deg`;
        const jpeg = readFileSync(join(VR_CACHE, scene, `pano_${face}.jpg`));
        await evaluate(`window.__compare.loadFace(${JSON.stringify(face)}, "data:image/jpeg;base64,${jpeg.toString("base64")}")`);
        const [dx, , dz] = bearingToDirection(bearing);
        const renderUrl = await evaluate(
          `window.__compare.render(${JSON.stringify({ px: world.x, py: y, pz: world.z, dx, dz, size: SIZE, near: NEAR, far: FAR })})`,
        );
        const left = `${scene} face ${face} bearing ${bearing.toFixed(1)} (yaw ${yaw}) station ${record.method}${refined} conf ${confOf(record)} - model render (estimated geometry)`;
        const side = await evaluate(
          `window.__compare.composeSide(${JSON.stringify({ face, renderUrl, size: SIZE, left, right: "SCNU 360 VR (reference only, not shipped)" })})`,
        );
        const sidePath = join(outDir, `${prefix}${scene}-${face}-side.png`);
        writeFileSync(sidePath, Buffer.from(side, "base64"));
        console.log(`PAIR ${scene} ${face} -> ${sidePath}`);
        if (bearingsOnly) for (const observation of observations.filter(o => o.scene === scene && o.face === face)) {
          const feature = siteFeatures.find(f => f.properties.id === observation.id);
          const ring = feature?.geometry.type === "Polygon" ? feature.geometry.coordinates[0].map(p => geoToModel(...p)) : null;
          const objectId = freeStanding ? renderObjectIds[observation.id] : undefined;
          if (freeStanding && objectId === undefined) throw new Error(`${observation.id}: missing packed object ID`);
          let renderedFace = face;
          let mask = await evaluate(`window.__compare.objectMask(${JSON.stringify({ id: observation.id, objectId, ring, offset,
            render: { px: world.x, py: y, pz: world.z, dx, dz, size: SIZE, near: NEAR, far: FAR } })})`);
          // A misplaced object can leave the observed cube face. Measure its bearing on another
          // face at the SAME station, rather than returning the anchor projection as a render.
          if (freeStanding && mask.pixels === 0) for (const other of STRIP_ORDER.filter(f => f !== face)) {
            const [ox, , oz] = bearingToDirection(faceYaw(yaw, other));
            const candidate = await evaluate(`window.__compare.objectMask(${JSON.stringify({ id: observation.id, objectId, offset,
              render: { px: world.x, py: y, pz: world.z, dx: ox, dz: oz, size: SIZE, near: NEAR, far: FAR } })})`);
            if (candidate.pixels) { mask = candidate; renderedFace = other; break; }
          }
          const maskPath = join(outDir, `${prefix}${scene}-${face}-${observation.id.replaceAll("/", "_")}-id.png`);
          writeFileSync(maskPath, Buffer.from(mask.image.split(",")[1], "base64"));
          if (freeStanding && observation.referencePolygon) {
            const reference = await evaluate(`window.__compare.referenceMask(${JSON.stringify({
              face, polygon: observation.referencePolygon, col: observation.col,
            })})`);
            writeFileSync(maskPath.replace("-id.png", "-reference.png"), Buffer.from(reference, "base64"));
          }
          const mappingErrors = freeStanding ? [] : checkSceneRefs([observation], stations, buildings);
          const hit = freeStanding ? null : firstBuildingHit(record, observation, buildings);
          let residual = observation.col === null
            ? { residualDeg: null, pass: false, reason: observation.reason }
            : bearingResidual(record, observation, mask.col);
          if (observation.col !== null && mask.col !== null && renderedFace !== face) {
            const observed = readBearing(record, observation);
            const drawn = readBearing(record, { face: renderedFace, col: mask.col });
            const residualDeg = ((drawn.bearingDeg - observed.bearingDeg + 540) % 360) - 180;
            residual = { tier: "T2", estimated: true, observedDeg: observed.bearingDeg,
              renderedDeg: drawn.bearingDeg, residualDeg, toleranceDeg: 1.5, pass: Math.abs(residualDeg) <= 1.5 };
          }
          const row = { ...observation, correspondenceReason: observation.reason, ...residual, wallHit: hit, renderCol: mask.col,
            renderedFace, method: freeStanding ? "reviewed VR silhouette centroid vs visible packed _OBJECT_ID pixel centroid" : "rendered wall mask",
            maskPixels: mask.pixels, maskTriangles: mask.triangles, mappingErrors, pass: residual.pass && mappingErrors.length === 0 };
          bearingRows.push(row);
          console.log(`BEARING ${observation.id} ${scene}/${face} residual=${row.residualDeg} pass=${row.pass} wall=${hit?.wall ?? "free-standing"}`);
        }
      }
      const order = STRIP_ORDER.filter((face) => faces.includes(face));
      const title = `${scene} ${record.title ?? ""} yaw ${yaw} station ${record.method}${refined} conf ${confOf(record)} | row 1 SCNU 360 VR (reference only, not shipped) | row 2 model render (estimated geometry)`;
      const strip = await evaluate(`window.__compare.composeStrip(${JSON.stringify({ order, tile: 512, title, labels })})`);
      const stripPath = join(outDir, `${prefix}${scene}-strip.png`);
      writeFileSync(stripPath, Buffer.from(strip, "base64"));
      console.log(`STRIP ${scene} -> ${stripPath}`);
    }
    if (bearingsOnly) {
      const report = { frameVersion: 2, toleranceDeg: 1.5, estimated: true, inputs: sceneTable?.inputs ?? {
        modelSha256: createHash("sha256").update(modelBytes).digest("hex"),
        observationsSha256: createHash("sha256").update(readFileSync(bearingFile)).digest("hex"),
        stationsSha256: createHash("sha256").update(readFileSync(stationsFile)).digest("hex"),
      },
        scenes: selected.map(s => ({ scene: s.scene, ...readBearing(s, { face: "f", col: 1024 }), residualDeg: null })),
        rows: bearingRows, pass: bearingRows.filter(r => r.tier !== "T4").length > 0 && bearingRows.every(r => r.tier === "T4" || r.pass) };
      writeFileSync(join(outDir, "bearings.json"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`BEARINGS_RESULT pass=${report.pass} rows=${bearingRows.length} -> ${join(outDir, "bearings.json")}`);
      if (!report.pass) exitCode = 1;
    }
  }
  console.log(`CONSOLE_ERRORS ${consoleErrors.length}${consoleErrors.length ? " " + JSON.stringify(consoleErrors.slice(0, 5)) : ""}`);
} catch (error) {
  exitCode = 1;
  console.error("COMPARE_ERROR", error.stack ?? error);
} finally {
  ws?.close();
  chrome.kill();
  await chrome.exited;
  rmSync(profile, { recursive: true, force: true });
}
process.exit(exitCode);

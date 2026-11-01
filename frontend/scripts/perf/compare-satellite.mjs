// Satellite-vs-render comparison harness (BUILD-PLAN U03, local QA only; nothing here ships).
//
// Renders four campus windows of the Legacy dashboard straight down with an orthographic projection at
// 0.25 m/px and puts each next to the same ground area cropped from the z19 reference mosaic
// (qa/ref/sat-z19.jpg + sat-z19.json). Per window it writes:
//   <prefix><name>-side.png   render | mosaic crop, side by side
//   <prefix><name>-blend.png  mosaic with the render on top at 50 % opacity
// The mosaic is a VWorld derivative used for inspection only; the outputs stay under .omo/ and are never
// committed.
//
// Usage (dev server already running, e.g. `vite --host 127.0.0.1 --port 5182` in frontend/):
//   bun frontend/scripts/perf/compare-satellite.mjs [--url http://127.0.0.1:5182/] [--port 9352]
//       [--out <dir>] [--prefix <label->] [--clock 2026-10-24T12:00:00+09:00] [--list]
//   --clock pins the page clock (default noon KST) so the sun and lighting match the reference midday mosaic
//   regardless of when the script runs.
//   --list prints the scene-frame centre of every BLD_* node (handy for choosing windows) and exits.
//
// Camera method: the page exposes no hook, so an init script captures the react-three-fiber store from
// the first `__r3f` instance record R3F attaches (src/ is untouched). Each window is rendered in one
// synchronous page task: the default camera is moved above the window centre (up = -z, so north is at
// the top), its projection matrix is replaced by an orthographic one, fog is switched off, the renderer
// is resized to the output size and `gl.render` + `toDataURL` run before anything is restored. No
// animation frame ever sees the temporary camera, so the dashboard state is unchanged.
//
// Frames: windows are given in uni.glb scene units (+x east, +z south, 0.6242171526 units/m), the same
// frame as gen/lib/frame.mjs. The runtime recentres the model (CityModel group at -center), so the
// script measures BLD_D4's world bounding-box centre and subtracts D4_SCENE to get that offset. Mosaic
// pixels come from modelToGeo() of the window corners and Web Mercator rows from the bounds JSON.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { D4_SCENE, SCENE_UNITS_PER_METRE, modelToGeo } from "../campus-model/lib/frame.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const RESEARCH = join(REPO, ".omo/ulw-research/20261023-181400");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const METRES_PER_PIXEL = 0.25;

// Window centres in scene units (picked on the z19 mosaic); sizes in metres (=> 800 x 600 px at 0.25 m/px).
//   d4-block      BLD_D4 bounding-box centre (D4_SCENE) with D3 and the west slope
//   main-gate     east entrance on the arterial road, north-east of the stadium
//   central-lawn  oval-pond plaza, roundabout and lawns north of BLD_E1
//   east-woodland tree belt between the B buildings and the stadium
const WINDOWS = [
  { name: "d4-block", label: "D4 block", x: 46.5, z: -266.6, widthM: 200, heightM: 150 },
  { name: "main-gate", label: "Main gate", x: 450, z: -160, widthM: 200, heightM: 150 },
  { name: "central-lawn", label: "Central lawn", x: 260, z: -230, widthM: 200, heightM: 150 },
  { name: "east-woodland", label: "East woodland", x: 355, z: -185, widthM: 200, heightM: 150 },
];

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = option("url", "http://127.0.0.1:5182/");
const port = option("port", "9352");
const outDir = resolve(option("out", join(RESEARCH, "qa/compare")));
const prefix = option("prefix", "");
const listOnly = args.includes("--list");
const clock = option("clock", "2026-10-24T12:00:00+09:00");
if (Number.isNaN(Date.parse(clock))) throw new Error(`--clock is not a date: ${clock}`);
// Runs before any page script: shifts Date so the dashboard's live clock starts at `clock`.
const PIN_CLOCK = `(() => {
  const RealDate = Date;
  const offset = RealDate.parse(${JSON.stringify(clock)}) - RealDate.now();
  class PinnedDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
    static now() { return RealDate.now() + offset; }
  }
  window.Date = PinnedDate;
  // Medium/High post-processing switches gl.outputColorSpace to linear, so a direct gl.render capture would
  // save unencoded linear values (too dark). Compare on the Low tier, which renders straight to sRGB.
  try { localStorage.setItem("scnu.renderQuality", "low"); } catch {}
})();`;

const bounds = JSON.parse(await Bun.file(join(RESEARCH, "qa/ref/sat-z19.json")).text());
const mercatorY = (latitude) => Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
function mosaicPixel(x, z) {
  const [longitude, latitude] = modelToGeo(x, z);
  return [
    ((longitude - bounds.west) / (bounds.east - bounds.west)) * bounds.width,
    ((mercatorY(bounds.north) - mercatorY(latitude)) / (mercatorY(bounds.north) - mercatorY(bounds.south))) *
      bounds.height,
  ];
}

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
  window.__compare = {
    worldCentre: (name) => { const n = findNode(name); return n ? worldCentre(n) : null; },
    buildings() {
      const out = {};
      store.getState().scene.traverse((o) => {
        if (/^BLD_[A-Z]\\d+$/.test(o.name) && !(o.name in out)) out[o.name] = worldCentre(o);
      });
      return out;
    },
    groupTransform() {
      const d4 = findNode("BLD_D4");
      return d4 ? Array.from(d4.parent.matrixWorld.elements) : null;
    },
    render({ centreX, centreZ, halfWidth, halfHeight, width, height }) {
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
        camera.up.set(0, 0, -1);
        camera.position.set(centreX, 400, centreZ);
        camera.lookAt(centreX, 0, centreZ);
        camera.updateMatrixWorld(true);
        camera.projectionMatrix.makeOrthographic(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 1000);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        gl.setPixelRatio(1);
        gl.setSize(width, height, false);
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
    async loadMosaic(dataUrl) {
      const blob = await (await fetch(dataUrl)).blob();
      window.__compareMosaic = await createImageBitmap(blob);
      return [window.__compareMosaic.width, window.__compareMosaic.height];
    },
    async compose({ renderUrl, crop, width, height, title }) {
      const render = await createImageBitmap(await (await fetch(renderUrl)).blob());
      const mosaic = window.__compareMosaic;
      const header = 30, gap = 8;
      const side = new OffscreenCanvas(width * 2 + gap, height + header);
      const s = side.getContext("2d");
      s.fillStyle = "#111";
      s.fillRect(0, 0, side.width, side.height);
      s.drawImage(render, 0, header, width, height);
      s.drawImage(mosaic, crop.sx, crop.sy, crop.sw, crop.sh, width + gap, header, width, height);
      s.fillStyle = "#fff";
      s.font = "15px sans-serif";
      s.fillText(title + " - model render (estimated geometry), 0.25 m/px, north up", 8, 20);
      s.fillText("VWorld z19 mosaic crop (reference imagery)", width + gap + 8, 20);
      // 50 m scale bar in both panels.
      const bar = 50 / ${METRES_PER_PIXEL};
      for (const left of [12, width + gap + 12]) {
        s.fillStyle = "rgba(0,0,0,0.6)";
        s.fillRect(left - 4, header + height - 30, bar + 8, 24);
        s.fillStyle = "#fff";
        s.fillRect(left, header + height - 12, bar, 4);
        s.font = "12px sans-serif";
        s.fillText("50 m", left, header + height - 16);
      }
      const blend = new OffscreenCanvas(width, height);
      const b = blend.getContext("2d");
      b.drawImage(mosaic, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
      b.globalAlpha = 0.5;
      b.drawImage(render, 0, 0, width, height);
      const toDataUrl = async (canvas) => {
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      };
      return { side: await toDataUrl(side), blend: await toDataUrl(blend) };
    },
  };
  return true;
})()`;

const profile = mkdtempSync(join(tmpdir(), "compare-satellite-"));
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
  await cdp("Page.navigate", { url });

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

  const d4World = await evaluate(`window.__compare.worldCentre("BLD_D4")`);
  const offset = { x: d4World.x - D4_SCENE.x, z: d4World.z - D4_SCENE.z };
  const groupMatrix = await evaluate(`window.__compare.groupTransform()`);
  console.log(`FRAME offset world-minus-scene x=${offset.x.toFixed(3)} z=${offset.z.toFixed(3)}; D4 parent matrixWorld=${JSON.stringify(groupMatrix.map((v) => +v.toFixed(4)))}`);

  if (listOnly) {
    const buildings = await evaluate(`window.__compare.buildings()`);
    for (const [name, c] of Object.entries(buildings).sort()) {
      console.log(`${name} x=${(c.x - offset.x).toFixed(1)} z=${(c.z - offset.z).toFixed(1)}`);
    }
  } else {
    mkdirSync(outDir, { recursive: true });
    const mosaicBytes = await Bun.file(join(RESEARCH, "qa/ref/sat-z19.jpg")).bytes();
    const mosaicSize = await evaluate(
      `window.__compare.loadMosaic("data:image/jpeg;base64,${Buffer.from(mosaicBytes).toString("base64")}")`,
    );
    console.log(`MOSAIC ${mosaicSize.join("x")} zoom ${bounds.zoom}`);

    for (const area of WINDOWS) {
      const width = Math.round(area.widthM / METRES_PER_PIXEL);
      const height = Math.round(area.heightM / METRES_PER_PIXEL);
      const halfWidth = (area.widthM * SCENE_UNITS_PER_METRE) / 2;
      const halfHeight = (area.heightM * SCENE_UNITS_PER_METRE) / 2;
      const [left, top] = mosaicPixel(area.x - halfWidth, area.z - halfHeight);
      const [right, bottom] = mosaicPixel(area.x + halfWidth, area.z + halfHeight);
      const crop = { sx: left, sy: top, sw: right - left, sh: bottom - top };
      if (left < 0 || top < 0 || right > bounds.width || bottom > bounds.height) {
        throw new Error(`${area.name} falls outside the mosaic: ${JSON.stringify(crop)}`);
      }
      const renderUrl = await evaluate(
        `window.__compare.render(${JSON.stringify({ centreX: area.x + offset.x, centreZ: area.z + offset.z, halfWidth, halfHeight, width, height })})`,
      );
      const images = await evaluate(
        `window.__compare.compose(${JSON.stringify({ renderUrl, crop, width, height, title: area.label })})`,
      );
      const sidePath = join(outDir, `${prefix}${area.name}-side.png`);
      const blendPath = join(outDir, `${prefix}${area.name}-blend.png`);
      writeFileSync(sidePath, Buffer.from(images.side, "base64"));
      writeFileSync(blendPath, Buffer.from(images.blend, "base64"));
      const [lonW, latN] = modelToGeo(area.x - halfWidth, area.z - halfHeight);
      const [lonE, latS] = modelToGeo(area.x + halfWidth, area.z + halfHeight);
      console.log(
        `PAIR ${area.name} ${width}x${height}px centre=(${area.x},${area.z}) geo=[${lonW.toFixed(6)},${latS.toFixed(6)},${lonE.toFixed(6)},${latN.toFixed(6)}] crop=${crop.sw.toFixed(1)}x${crop.sh.toFixed(1)}@(${crop.sx.toFixed(1)},${crop.sy.toFixed(1)}) -> ${sidePath} ${blendPath}`,
      );
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

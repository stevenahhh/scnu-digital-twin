// Headless real-GPU benchmark for the Legacy dashboard (BUILD-PLAN U00 / acceptance A5).
// Seeded from .omo/ulw-research/20261023-181400/qa/perf.mjs. Usage and output fields: see README.md.
//
//   bun scripts/perf/bench.mjs <url> <label> <outDir> [--compare <urlB> <labelB>] [--runs 5]
//       [--cdp 9351] [--width 1920] [--height 1080] [--warmup 60] [--frames 300]
//       [--clock 2026-10-24T15:00:00+09:00] [--chrome <path>] [--orbit <seconds>]
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NOISE_FLOOR_MS = 1.5; // M5 Pro run-to-run spread of gpuMs.median (BUILD-PLAN U00, MEASURED)
const ASSET_RE = /\.(glb|gltf|bin|ktx2|drc|wasm|hdr|exr)(\?|$)|\/basis_transcoder\.js(\?|$)/;
// Local backends (weather 8000, vision 8001, simulation 8002). Unless --live-backends is given they answer
// 404, so a missing service cannot add console errors or change the frame (the d4 camera is within the
// app's 120-unit proximity radius and opens building popups).
const BACKEND_PATTERNS = ["http://127.0.0.1:80*", "http://localhost:80*"];

function parseArgs(argv) {
  const positional = [];
  const opts = {
    runs: 5, cdp: 9351, width: 1920, height: 1080, warmup: 60, frames: 300,
    clock: "2026-10-24T15:00:00+09:00",
    chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    compare: null, liveBackends: false,
    // Synthetic traffic agents fed through a fake simulation WebSocket (see fakeSocketScript); 0 sends none.
    agents: 0,
    // Simulation status the fake socket reports with --agents (running|paused). Paused keeps sending the same positions.
    "agent-status": "running",
    // Render quality tier seeded into localStorage before load (low|medium|high); empty keeps the app default.
    // Post-processing passes reset renderer.info, so draw-call counts are comparable only at "low".
    quality: "",
    // Seconds of a camera orbit after the fixed views (docs/OPTIMIZATION-FORMULA.md F: mean fps and 1 % low); 0 skips it.
    orbit: 0,
    // Device scale factor of the emulated screen (the app caps the canvas pixel ratio per quality tier).
    dpr: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (key === "compare") { opts.compare = { url: argv[++i], label: argv[++i] }; continue; }
    if (key === "live-backends") { opts.liveBackends = true; continue; }
    if (!(key in opts)) throw new Error(`unknown option ${arg}`);
    const value = argv[++i];
    opts[key] = typeof opts[key] === "number" ? Number(value) : value;
  }
  if (positional.length < 3) {
    throw new Error("usage: bun scripts/perf/bench.mjs <url> <label> <outDir> [--compare <urlB> <labelB>] [--runs N] ...");
  }
  const [url, label, outDir] = positional;
  if (opts.runs < 1 || opts.frames < 20) throw new Error("--runs must be >= 1 and --frames >= 20");
  if (Number.isNaN(Date.parse(opts.clock))) throw new Error(`--clock is not a date: ${opts.clock}`);
  return { configs: [{ url, label }, ...(opts.compare ? [opts.compare] : [])], outDir: resolve(outDir), opts };
}

// The three A8 cameras (BUILD-PLAN section 3). "d4" is resolved in the page from the BLD_D4 bounding box.
// Positions are scene units (+x east, +z south). The oblique camera looks from the south-west so the
// 15:00 KST shadows fall away from the viewer; its exact position is a harness choice, kept fixed.
const VIEWS = [
  { name: "overview", position: [0, 260, 260], target: [0, 0, 0] },
  { name: "d4", anchor: "BLD_D4", offset: [60, 50, 60] },
  { name: "oblique15", position: [-220, 110, 180], target: [0, 0, 0] },
];

// Local backends also open WebSockets (simulation 8002), which Fetch interception does not see. Unless --live-backends
// is given, sockets to 127.0.0.1:80* / localhost:80* get a fake that never reaches the port. With --agents N it opens
// and sends a "running" simulation_update with N deterministic agents every 100 ms (60 % cars, 30 % people, 10 %
// scooters, every 15th at warning risk, each on a slow 6 m circle), so traffic draw calls are measured without a server.
const fakeSocketScript = (agents, status = "running") => `(() => {
  const RealSocket = window.WebSocket;
  const LOCAL = /^wss?:\\/\\/(127\\.0\\.0\\.1|localhost):80\\d\\d\\b/;
  const N = ${Number(agents) || 0};
  const STATUS = ${JSON.stringify(status)};
  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url; this.readyState = 0; this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
      if (N === 0) return;
      setTimeout(() => { this.readyState = 1; this.onopen?.({ type: "open" }); this.timer = setInterval(() => this.tick(), 100); this.tick(); }, 50);
    }
    tick() {
      // Paused: the server keeps sending updates, but the time and every position stay the same.
      if (STATUS !== "running" && this.t0 === undefined) this.t0 = performance.now() / 1000;
      const t = STATUS === "running" ? performance.now() / 1000 : this.t0;
      const entities = [];
      for (let i = 0; i < N; i++) {
        const type = i % 10 < 6 ? "car" : i % 10 < 9 ? "person" : "scooter";
        const cx = 60 + (i % 20) * 30, cz = -150 + Math.floor(i / 20) * 40, a = t * 0.3 + i;
        entities.push({ id: "bench-" + i, type, x: cx + 6 * Math.cos(a), y: 0, z: cz + 6 * Math.sin(a),
          speed: type === "person" ? 1.2 : 5, heading: (a * 180) / Math.PI + 90,
          risk_level: i % 15 === 0 ? "warning" : "normal", state: "moving" });
      }
      this.onmessage?.({ data: JSON.stringify({ type: "simulation_update", status: STATUS, simulation_time: t, entities }) });
    }
    send() {}
    close() { clearInterval(this.timer); this.readyState = 3; }
  }
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) FakeSocket[k] = RealSocket[k];
  window.WebSocket = new Proxy(RealSocket, { construct(target, args) { return LOCAL.test(String(args[0])) ? new FakeSocket(args[0]) : new target(...args); } });
})();
`;

// Runs before any page script: draw-call hooks, the pinned clock and the bench state object.
const initScript = (clock) => `(() => {
  const RealDate = Date;
  const offset = RealDate.parse(${JSON.stringify(clock)}) - RealDate.now();
  class PinnedDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
    static now() { return RealDate.now() + offset; }
  }
  window.Date = PinnedDate;

  const B = window.__bench = { gl: { calls: 0, tris: 0 }, view: null, measuring: false, frames: [], gpu: [],
    pending: [], activeQuery: null, disjointDrops: 0, renderer: null, renderCalls: 0, store: null, orbit: null, orbitTimes: [] };
  // The R3F store (same capture as overhead-blend.mjs): the orbit invalidates it every frame, because the
  // dashboard renders on demand and would otherwise draw nothing while the camera is driven from here.
  Object.defineProperty(Object.prototype, "__r3f", {
    configurable: true,
    get() { return undefined; },
    set(value) {
      Object.defineProperty(this, "__r3f", { value, writable: true, configurable: true, enumerable: true });
      if (!B.store && value && value.root && typeof value.root.getState === "function") B.store = value.root;
    },
  });
  const P = WebGL2RenderingContext.prototype;
  for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"]) {
    const original = P[name];
    P[name] = function (...a) {
      B.gl.calls++;
      const count = name.startsWith("drawArrays") ? a[2] : name === "drawRangeElements" ? a[3] : a[1];
      const instances = name.endsWith("Instanced") ? a[a.length - 1] : 1;
      if (a[0] === 4) B.gl.tris += (count / 3) * instances;
      return original.apply(this, a);
    };
  }

  B.poll = () => {
    if (!B.ext || B.pending.length === 0) return;
    const gl = B.ctx;
    // A disjoint event invalidates every query that was in flight; drop them instead of reporting garbage.
    const disjoint = gl.getParameter(B.ext.GPU_DISJOINT_EXT);
    const still = [];
    for (const q of B.pending) {
      if (!disjoint && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { still.push(q); continue; }
      if (disjoint) B.disjointDrops++;
      else B.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    B.pending = still;
  };

  // Called from Scene.prototype.onBeforeRender: after the scene graph update, before the frustum,
  // the shadow pass and the main pass. r163 resets renderer.info after shadowMap.render (r186 before it),
  // so autoReset is turned off and the reset happens here to count shadow draws on either version.
  B.before = (renderer, scene, camera) => {
    B.renderCalls++;
    if (!B.renderer) {
      B.renderer = renderer; B.scene = scene; B.camera = camera;
      renderer.info.autoReset = false;
      B.ctx = renderer.getContext();
      B.ext = B.ctx.getExtension("EXT_disjoint_timer_query_webgl2");
    }
    if (renderer !== B.renderer) return;
    if (B.orbit) {
      const o = B.orbit;
      const a = ((performance.now() - o.t0) / (o.seconds * 1000)) * 2 * Math.PI;
      camera.position.set(o.radius * Math.sin(a), o.height, o.radius * Math.cos(a));
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    } else if (B.view) {
      camera.position.fromArray(B.view.position);
      camera.lookAt(B.view.target[0], B.view.target[1], B.view.target[2]);
      camera.updateMatrixWorld();
    }
    renderer.info.reset();
    B.c0 = B.gl.calls; B.t0 = B.gl.tris;
    B.poll();
    if (B.measuring && B.ext && !B.activeQuery) {
      B.activeQuery = B.ctx.createQuery();
      B.ctx.beginQuery(B.ext.TIME_ELAPSED_EXT, B.activeQuery);
    }
  };
  B.after = (renderer) => {
    if (renderer !== B.renderer) return;
    if (B.activeQuery) { B.ctx.endQuery(B.ext.TIME_ELAPSED_EXT); B.pending.push(B.activeQuery); B.activeQuery = null; }
    if (B.measuring) B.frames.push({ infoCalls: renderer.info.render.calls, infoTris: renderer.info.render.triangles,
      glCalls: B.gl.calls - B.c0, glTris: B.gl.tris - B.t0 });
  };
})()`;

// Evaluated once the dashboard has rendered: reach the same three module instance the app uses.
const attachScript = `(async () => {
  const B = window.__bench;
  const url = performance.getEntriesByType("resource").map((e) => e.name)
    .find((n) => /\\/node_modules\\/\\.vite\\/deps\\/three\\.js(\\?|$)/.test(n));
  if (!url) throw new Error("three module not found in resource timing; bench.mjs needs the vite dev server");
  const THREE = await import(url);
  B.THREE = THREE;
  THREE.Scene.prototype.onBeforeRender = function (renderer, scene, camera) { B.before(renderer, scene, camera); };
  THREE.Scene.prototype.onAfterRender = function (renderer) { B.after(renderer); };
  const t0 = performance.now();
  while (!B.renderer) {
    if (performance.now() - t0 > 10000) throw new Error("no Scene render observed within 10 s");
    await new Promise((r) => requestAnimationFrame(r));
  }
  const dbg = B.ctx.getExtension("WEBGL_debug_renderer_info");
  return { threeRevision: THREE.REVISION, threeUrl: url.replace(location.origin, ""),
    renderer: dbg ? B.ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : B.ctx.getParameter(B.ctx.RENDERER),
    vendor: dbg ? B.ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : B.ctx.getParameter(B.ctx.VENDOR),
    timerQuery: Boolean(B.ext), drawingBuffer: [B.ctx.drawingBufferWidth, B.ctx.drawingBufferHeight] };
})()`;

const measureScript = (view, warmup, frames) => `(async () => {
  const B = window.__bench;
  const view = ${JSON.stringify(view)};
  if (view.anchor) {
    const object = B.scene.getObjectByName(view.anchor);
    if (!object) throw new Error("view anchor " + view.anchor + " not in scene");
    const c = new B.THREE.Box3().setFromObject(object).getCenter(new B.THREE.Vector3());
    view.target = [c.x, c.y, c.z];
    view.position = [c.x + view.offset[0], c.y + view.offset[1], c.z + view.offset[2]];
  }
  B.view = view;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < ${warmup}; i++) await frame();
  B.frames = []; B.gpu = []; B.disjointDrops = 0;
  const dts = [];
  const frameCalls = [];
  let last = await frame();
  const start = last;
  B.measuring = true;
  let calls0 = B.gl.calls;
  for (let i = 0; i < ${frames}; i++) {
    const t = await frame(); dts.push(t - last); last = t;
    frameCalls.push(B.gl.calls - calls0); calls0 = B.gl.calls;
  }
  B.measuring = false;
  const elapsed = last - start;
  for (let i = 0; i < 120 && (B.pending.length || B.activeQuery); i++) { await frame(); B.poll(); }
  // Idle: 2 s with no input. idleFrames2s counts the rAF frames in which anything was drawn.
  const idleStart = B.gl.calls;
  let idleFrames2s = 0;
  const idleEnd = performance.now() + 2000;
  for (let c = B.gl.calls; performance.now() < idleEnd;) {
    await frame();
    if (B.gl.calls !== c) idleFrames2s += 1;
    c = B.gl.calls;
  }
  const idleDrawCalls2s = B.gl.calls - idleStart;
  const pct = (values, p) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const col = (k) => B.frames.map((f) => f[k]);
  return { view: view.name, position: view.position.map((v) => +v.toFixed(3)), target: view.target.map((v) => +v.toFixed(3)),
    frames: dts.length, renderedFrames: B.frames.length, fps: +(dts.length / (elapsed / 1000)).toFixed(2),
    frameMs: { median: pct(dts, 0.5), p95: pct(dts, 0.95) },
    drawCalls: pct(col("infoCalls"), 0.5), drawCallsGl: pct(col("glCalls"), 0.5),
    // WebGL draw calls between two rAFs: every render() of the frame, post-processing passes included.
    drawCallsFrame: pct(frameCalls.filter((c) => c > 0), 0.5),
    triangles: pct(col("infoTris"), 0.5), trianglesGl: Math.round(pct(col("glTris"), 0.5)),
    gpuMs: B.ext ? { median: pct(B.gpu, 0.5), p95: pct(B.gpu, 0.95), samples: B.gpu.length, disjointDropped: B.disjointDrops } : null,
    idleDrawCalls2s, idleFrames2s,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null };
})()`;

// One camera turn around the origin at medium zoom (260 units out, 180 up) over `seconds`, one render per frame
// (the store is invalidated every rAF). fps is frames that rendered per second (rAF timestamps); low1 is 1000 / the
// mean of the slowest 1 % of their intervals.
const orbitScript = (seconds) => `(async () => {
  const B = window.__bench;
  if (!B.store) throw new Error("orbit: R3F store not captured");
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  B.orbitTimes = [];
  B.orbit = { seconds: ${seconds}, radius: 260, height: 180, t0: performance.now() };
  const end = B.orbit.t0 + ${seconds} * 1000;
  let renders = B.renderCalls;
  while (performance.now() < end) {
    B.store.getState().invalidate();
    const t = await frame();
    // A frame counts once however many render() calls it made (post-processing renders several scenes).
    if (B.renderCalls !== renders) { B.orbitTimes.push(t); renders = B.renderCalls; }
  }
  B.orbit = null;
  B.store.getState().invalidate();
  const t = B.orbitTimes.slice(1);
  const dts = t.slice(1).map((v, i) => v - t[i]);
  const sorted = [...dts].sort((a, b) => b - a);
  const worst = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 100)));
  return { seconds: ${seconds}, renderedFrames: t.length,
    fps: +((dts.length / (t[t.length - 1] - t[0])) * 1000).toFixed(2),
    low1: +(1000 / (worst.reduce((s, v) => s + v, 0) / worst.length)).toFixed(2),
    frameMsMax: +sorted[0].toFixed(2) };
})()`;

// X of docs/OPTIMIZATION-FORMULA.md, an estimate (추정) from the scene, not a driver reading: every distinct texture
// source of the main scene's materials, compressed ones by their mip data bytes, others as RGBA8 with a full mip chain
// (x 4/3) when mipmaps are generated.
const textureMemoryScript = `(() => {
  const B = window.__bench;
  const KEYS = ["map", "emissiveMap", "normalMap", "aoMap", "roughnessMap", "metalnessMap", "alphaMap", "bumpMap",
    "lightMap", "specularMap", "clearcoatNormalMap", "transmissionMap"];
  const seen = new Set();
  let bytes = 0, compressed = 0;
  B.scene.traverse((o) => {
    for (const m of [o.material].flat()) {
      if (!m) continue;
      for (const k of KEYS) {
        const t = m[k];
        if (!t) continue;
        const key = t.source?.uuid ?? t.uuid;
        if (seen.has(key)) continue;
        seen.add(key);
        if (t.isCompressedTexture) {
          compressed += 1;
          bytes += t.mipmaps.reduce((s, mip) => s + mip.data.byteLength, 0);
        } else {
          const img = t.image ?? {};
          const mips = t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1;
          bytes += (img.width ?? 0) * (img.height ?? 0) * 4 * mips;
        }
      }
    }
  });
  // Visible meshes by scene-root ancestor name (digits folded to #), to see where draw calls come from.
  const census = {};
  B.scene.traverseVisible((o) => {
    if (!o.isMesh) return;
    let top = o;
    while (top.parent && top.parent !== B.scene && top.parent.parent) top = top.parent;
    const key = (top.name || top.type).replace(/[0-9]+/g, "#");
    census[key] = (census[key] ?? 0) + 1;
  });
  const sceneCensus = Object.entries(census).sort((a, b) => b[1] - a[1]).slice(0, 20);
  return { gpuTextureMB: +(bytes / 1048576).toFixed(1), textures: seen.size, compressedTextures: compressed,
    rendererTextures: B.renderer.info.memory.textures, sceneCensus };
})()`;

const resourcesScript = `performance.getEntriesByType("resource").map((e) => ({ name: e.name.replace(location.origin, ""),
  encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize, transferSize: e.transferSize,
  responseEndMs: Math.round(e.responseEnd) }))`;

async function runOnce(config, runIndex, outDir, opts) {
  const profile = mkdtempSync(join(tmpdir(), "scnu-bench-"));
  const chrome = Bun.spawn([opts.chrome, "--headless=new", `--user-data-dir=${profile}`, "--use-angle=metal",
    "--enable-gpu", "--ignore-gpu-blocklist", "--enable-precise-memory-info", "--no-first-run",
    `--remote-debugging-port=${opts.cdp}`, `--window-size=${opts.width},${opts.height}`, "about:blank"],
  { stdout: "ignore", stderr: "ignore" });
  let ws;
  try {
    let version = null;
    for (let i = 0; i < 80 && !version; i++) {
      try { version = await (await fetch(`http://127.0.0.1:${opts.cdp}/json/version`)).json(); } catch { await Bun.sleep(250); }
    }
    if (!version) throw new Error(`Chrome CDP did not come up on port ${opts.cdp}`);
    const page = (await (await fetch(`http://127.0.0.1:${opts.cdp}/json/list`)).json()).find((t) => t.type === "page");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map();
    const consoleErrors = [];
    const logErrors = [];
    const stubbed = [];
    ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
      }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        consoleErrors.push(`EXC ${(d.exception?.description ?? d.text).slice(0, 300)}`);
      }
      if (m.method === "Fetch.requestPaused") {
        stubbed.push(m.params.request.url.slice(0, 200));
        cdp("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 404,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }],
          body: Buffer.from('{"detail":"stubbed by scripts/perf/bench.mjs"}').toString("base64") });
      }
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
        logErrors.push(`${m.params.entry.text} ${m.params.entry.url ?? ""}`.slice(0, 300));
      }
    };
    const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression) => {
      const m = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (m.error) throw new Error(`CDP ${m.error.message}`);
      if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
      return m.result.result.value;
    };

    await cdp("Page.enable");
    await cdp("Runtime.enable");
    await cdp("Log.enable");
    await cdp("Network.enable");
    await cdp("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp("Emulation.setTimezoneOverride", { timezoneId: "Asia/Seoul" });
    await cdp("Emulation.setDeviceMetricsOverride", { width: opts.width, height: opts.height, deviceScaleFactor: opts.dpr, mobile: opts.width < 600 });
    const qualitySeed = opts.quality ? `try{localStorage.setItem("scnu.renderQuality",${JSON.stringify(opts.quality)})}catch{}\n` : "";
    const socketStub = opts.liveBackends ? "" : fakeSocketScript(opts.agents, opts["agent-status"]);
    await cdp("Page.addScriptToEvaluateOnNewDocument", { source: qualitySeed + socketStub + initScript(opts.clock) });
    if (!opts.liveBackends) await cdp("Fetch.enable", { patterns: BACKEND_PATTERNS.map((urlPattern) => ({ urlPattern })) });

    const t0 = Date.now();
    await cdp("Page.navigate", { url: config.url });
    let labels = 0;
    for (let i = 0; i < 180 && labels <= 5; i++) {
      labels = await evaluate('document.querySelectorAll("[data-qa=campus-label]").length');
      if (labels <= 5) await Bun.sleep(500);
    }
    const loadMs = Date.now() - t0;
    if (labels <= 5) throw new Error(`campus labels never appeared (${labels}) at ${config.url}`);

    const gpu = await evaluate(attachScript);
    if (/swiftshader/i.test(gpu.renderer)) throw new Error(`software renderer detected (${gpu.renderer}); aborting`);

    const views = {};
    for (const view of VIEWS) {
      views[view.name] = await evaluate(measureScript(view, opts.warmup, opts.frames));
      if (runIndex === 0) {
        const shot = await cdp("Page.captureScreenshot", { format: "png" });
        const file = join(outDir, `${config.label}-${view.name}.png`);
        await Bun.write(file, Buffer.from(shot.result.data, "base64"));
        views[view.name].screenshot = file;
      }
    }
    const textureMemory = await evaluate(textureMemoryScript);
    const orbit = opts.orbit > 0 ? await evaluate(orbitScript(opts.orbit)) : null;
    const resources = await evaluate(resourcesScript);
    const assets = resources.filter((r) => ASSET_RE.test(r.name));
    return { run: runIndex, label: config.label, chrome: version.Browser, gpu, loadMs, labels, views, textureMemory, orbit,
      transferBytes: assets.reduce((sum, a) => sum + a.encodedBodySize, 0), assets,
      consoleErrors, logErrors, stubbedRequests: stubbed.length };
  } finally {
    ws?.close();
    chrome.kill();
    await chrome.exited;
    rmSync(profile, { recursive: true, force: true });
  }
}

const median = (values) => {
  const s = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (v, d = 3) => (v == null ? null : +v.toFixed(d));

// Median across runs of each run's per-view value; p95 is the median of the run p95s.
function summarizeView(runs, name) {
  const per = runs.map((r) => r.views[name]);
  const gpuRuns = per.filter((v) => v.gpuMs && v.gpuMs.samples > 0);
  return {
    position: per[0].position, target: per[0].target,
    drawCalls: median(per.map((v) => v.drawCalls)), drawCallsGl: median(per.map((v) => v.drawCallsGl)),
    drawCallsFrame: median(per.map((v) => v.drawCallsFrame)),
    triangles: median(per.map((v) => v.triangles)), trianglesGl: median(per.map((v) => v.trianglesGl)),
    fps: round(median(per.map((v) => v.fps)), 2),
    frameMs: { median: round(median(per.map((v) => v.frameMs.median))), p95: round(median(per.map((v) => v.frameMs.p95))) },
    gpuMs: gpuRuns.length
      ? { median: round(median(gpuRuns.map((v) => v.gpuMs.median))), p95: round(median(gpuRuns.map((v) => v.gpuMs.p95))),
        runMedians: gpuRuns.map((v) => round(v.gpuMs.median)), samples: gpuRuns.reduce((s, v) => s + v.gpuMs.samples, 0),
        disjointDropped: gpuRuns.reduce((s, v) => s + v.gpuMs.disjointDropped, 0) }
      : null,
    idleDrawCalls2s: median(per.map((v) => v.idleDrawCalls2s)),
    idleFrames2s: median(per.map((v) => v.idleFrames2s)),
    heapMB: median(per.map((v) => v.heapMB)),
    screenshot: per.find((v) => v.screenshot)?.screenshot ?? null,
  };
}

function summarize(config, runs, opts, head) {
  const views = Object.fromEntries(VIEWS.map((v) => [v.name, summarizeView(runs, v.name)]));
  const o = views.overview;
  const consoleErrors = runs.flatMap((r) => r.consoleErrors);
  return {
    label: config.label, url: config.url, gitHead: head, measuredAt: new Date().toISOString(),
    // Headline numbers are the overview camera, the dashboard's default view.
    drawCalls: o.drawCalls, triangles: o.triangles, fps: o.fps, idleDrawCalls2s: o.idleDrawCalls2s,
    gpuMs: o.gpuMs ? { median: o.gpuMs.median, p95: o.gpuMs.p95 } : null,
    transferBytes: median(runs.map((r) => r.transferBytes)),
    consoleErrors: consoleErrors.length,
    loadMs: median(runs.map((r) => r.loadMs)),
    textureMemory: runs[0].textureMemory,
    orbit: runs[0].orbit ? { seconds: runs[0].orbit.seconds, fps: round(median(runs.map((r) => r.orbit.fps)), 2),
      low1: round(median(runs.map((r) => r.orbit.low1)), 2), runs: runs.map((r) => r.orbit) } : null,
    noiseFloorMs: NOISE_FLOOR_MS,
    setup: { chrome: runs[0].chrome, gpu: runs[0].gpu, width: opts.width, height: opts.height, deviceScaleFactor: opts.dpr,
      runs: runs.length, warmupFrames: opts.warmup, timedFrames: opts.frames, clock: opts.clock, timezone: "Asia/Seoul",
      backends: opts.liveBackends ? "live" : `stubbed 404 (${BACKEND_PATTERNS.join(", ")})`,
      stubbedRequests: median(runs.map((r) => r.stubbedRequests)) },
    views,
    assets: runs[0].assets,
    consoleErrorMessages: [...new Set(consoleErrors)].slice(0, 20),
    logErrorMessages: [...new Set(runs.flatMap((r) => r.logErrors))].slice(0, 20),
    runs: runs.map((r) => ({ run: r.run, loadMs: r.loadMs, orbit: r.orbit, transferBytes: r.transferBytes,
      consoleErrors: r.consoleErrors.length, views: r.views })),
  };
}

function compare(a, b) {
  const delta = (x, y) => (x == null || y == null ? null : round(y - x));
  const views = Object.fromEntries(VIEWS.map(({ name }) => {
    const va = a.views[name], vb = b.views[name];
    const gpu = delta(va.gpuMs?.median, vb.gpuMs?.median);
    return [name, { drawCalls: delta(va.drawCalls, vb.drawCalls), triangles: delta(va.triangles, vb.triangles),
      fps: delta(va.fps, vb.fps), gpuMsMedian: gpu, gpuMsP95: delta(va.gpuMs?.p95, vb.gpuMs?.p95),
      gpuVerdict: gpu == null ? "no timer" : Math.abs(gpu) < NOISE_FLOOR_MS ? "below noise floor" : gpu < 0 ? "faster" : "slower" }];
  }));
  return { a: a.label, b: b.label, noiseFloorMs: NOISE_FLOOR_MS, transferBytes: delta(a.transferBytes, b.transferBytes),
    consoleErrors: [a.consoleErrors, b.consoleErrors], views };
}

const { configs, outDir, opts } = parseArgs(process.argv.slice(2));
mkdirSync(outDir, { recursive: true });
const head = (await Bun.$`git rev-parse --short HEAD`.nothrow().quiet().text()).trim() || null;
const runsByLabel = new Map(configs.map((c) => [c.label, []]));
// Interleave A B A B so drift (thermals, background load) hits both configs equally.
for (let run = 0; run < opts.runs; run++) {
  for (const config of configs) {
    const result = await runOnce(config, run, outDir, opts);
    runsByLabel.get(config.label).push(result);
    const o = result.views.overview;
    console.log(`run ${run + 1}/${opts.runs} ${config.label}: draws ${o.drawCalls} (gl ${o.drawCallsGl}) tris ${o.triangles}` +
      ` fps ${o.fps} gpu ${o.gpuMs?.median?.toFixed(3) ?? "n/a"} ms transfer ${result.transferBytes} errors ${result.consoleErrors.length}`);
  }
}
const summaries = configs.map((c) => summarize(c, runsByLabel.get(c.label), opts, head));
for (const s of summaries) {
  const file = join(outDir, `${s.label}.json`);
  await Bun.write(file, `${JSON.stringify(s, null, 2)}\n`);
  console.log(`BENCH_RESULT ${file} ${JSON.stringify({ drawCalls: s.drawCalls, triangles: s.triangles, fps: s.fps,
    idleDrawCalls2s: s.idleDrawCalls2s, gpuMs: s.gpuMs, transferBytes: s.transferBytes, consoleErrors: s.consoleErrors,
    loadMs: s.loadMs, gpuTextureMB: s.textureMemory?.gpuTextureMB, orbit: s.orbit && { fps: s.orbit.fps, low1: s.orbit.low1 } })}`);
}
if (summaries.length === 2) {
  const file = join(outDir, `${summaries[0].label}-vs-${summaries[1].label}.json`);
  await Bun.write(file, `${JSON.stringify(compare(summaries[0], summaries[1]), null, 2)}\n`);
  console.log(`BENCH_COMPARE ${file}`);
}

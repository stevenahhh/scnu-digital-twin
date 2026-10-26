// Headless Chrome driven through Bun.WebView (no Playwright/Puppeteer dependency).
// Mirrors the audit capture run: SwiftShader GL, own profile dir, CDP device metrics for D/P.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const VIEWPORTS = Object.freeze({
  D: Object.freeze({ id: "D", width: 1440, height: 900, scale: 1, mobile: false }),
  P: Object.freeze({ id: "P", width: 390, height: 844, scale: 2, mobile: true }),
});

export const CHROME_ARGS = Object.freeze([
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--enable-webgl",
  "--headless=new",
]);

export const BLOCKED_URLS = Object.freeze(["*api.open-meteo.com*"]);

export const DEFAULT_CLOCK = "2026-10-25T19:00:00+09:00";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BrowserTimeoutError extends Error {}

// Every browser round trip is bounded: a page that stops rendering must fail the run, never hang it.
export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new BrowserTimeoutError(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Pins Date to a fixed start (advancing with real elapsed time) so "now" scenes are reproducible.
function clockScript(iso) {
  return `(() => {
    const base = ${Date.parse(iso)};
    const start = performance.now();
    const RealDate = Date;
    const now = () => base + (performance.now() - start);
    class QaDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(now()); else super(...args); }
      static now() { return now(); }
    }
    QaDate.UTC = RealDate.UTC;
    QaDate.parse = RealDate.parse;
    window.Date = QaDate;
  })();`;
}

export class Browser {
  constructor(view, viewport, profileDir) {
    this.view = view;
    this.viewport = viewport;
    this.profileDir = profileDir;
    this.logs = [];
    this.logMark = 0;
  }

  static async open({ viewport, clock = DEFAULT_CLOCK, reducedMotion = false, colorScheme = "dark" }) {
    const profileDir = mkdtempSync(path.join(tmpdir(), "scnu-visual-qa-"));
    const view = new Bun.WebView({
      width: viewport.width,
      height: viewport.height,
      dataStore: { directory: profileDir },
      backend: { type: "chrome", url: false, argv: [...CHROME_ARGS] },
    });
    const browser = new Browser(view, viewport, profileDir);
    await view.navigate("about:blank");
    await view.cdp("Runtime.enable");
    await view.cdp("Log.enable");
    await view.cdp("Page.enable");
    // Hermetic runs: live Open-Meteo cloud cover changes the sky between runs, so it is blocked.
    await view.cdp("Network.enable");
    await view.cdp("Network.setBlockedURLs", { urls: [...BLOCKED_URLS] });
    view.addEventListener("Runtime.consoleAPICalled", (event) => {
      const type = event.data.type;
      if (type === "error" || type === "warning") {
        browser.logs.push({ t: type, msg: event.data.args.map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 240) });
      }
    });
    view.addEventListener("Runtime.exceptionThrown", (event) => {
      const details = event.data.exceptionDetails;
      browser.logs.push({ t: "exception", msg: (details.exception?.description || details.text || "").slice(0, 240) });
    });
    view.addEventListener("Log.entryAdded", (event) => {
      const entry = event.data.entry;
      if (entry.level === "error" || entry.level === "warning") {
        browser.logs.push({ t: `log-${entry.level}`, msg: `${entry.text} ${entry.url || ""}`.slice(0, 240) });
      }
    });
    await view.cdp("Emulation.setDeviceMetricsOverride", {
      width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale, mobile: viewport.mobile,
    });
    // Phone = a touch device: without this `(pointer: coarse)` never matches, so every 44 px touch-target rule the app
    // ships under that query is invisible to the 44 px rows (V-Q-17, V-F-73, GAP-33). Mouse input stays mouse input.
    await view.cdp("Emulation.setTouchEmulationEnabled", viewport.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await view.cdp("Emulation.setTimezoneOverride", { timezoneId: "Asia/Seoul" });
    await browser.setMedia({ reducedMotion, colorScheme });
    if (clock) await view.cdp("Page.addScriptToEvaluateOnNewDocument", { source: clockScript(clock) });
    return browser;
  }

  async setMedia({ reducedMotion = false, colorScheme = "dark" }) {
    await this.view.cdp("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" },
        { name: "prefers-color-scheme", value: colorScheme },
      ],
    });
  }

  async navigate(url) {
    await withTimeout(this.view.navigate(url), 90000, `navigate ${url}`);
  }

  // Evaluates fn(...args) in the page. fn must be self-contained (it is serialised).
  async run(fn, ...args) {
    return withTimeout(this.view.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`), 60000, "evaluate");
  }

  async evaluate(expression) {
    return withTimeout(this.view.evaluate(expression), 60000, "evaluate");
  }

  async screenshot() {
    const shot = await withTimeout(this.view.screenshot({ encoding: "buffer" }), 60000, "screenshot");
    return new Uint8Array(shot);
  }

  consoleSince() {
    const secret = process.env.VITE_VWORLD_API_KEY;
    const entries = this.logs.slice(this.logMark).map((entry) => (secret ? { ...entry, msg: entry.msg.split(secret).join("<redacted>") } : entry));
    this.logMark = this.logs.length;
    const counts = new Map();
    for (const entry of entries) {
      const key = `[${entry.t}] ${entry.msg.replace(/0x[0-9a-f]+/g, "0x..")}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts].map(([key, n]) => `${n}x ${key}`);
  }

  // Centre of the first matching element (exact trimmed text when given) inside the viewport.
  async center(selector, text) {
    return this.run((sel, txt) => {
      const nodes = [...document.querySelectorAll(sel)].filter((node) => txt == null || (node.textContent || "").trim() === txt
        || (node.querySelector(".line-clamp-2")?.textContent || "").trim() === txt);
      for (const node of nodes) {
        const r = node.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        if (r.width > 0 && x > 0 && y > 0 && x < innerWidth && y < innerHeight) return [x, y];
      }
      return null;
    }, selector, text ?? null);
  }

  // SCREENS "tap": retry up to 12 s, scrollIntoView for camera presets, native click at the centre.
  async tap(selector, text, { timeoutMs = 12000 } = {}) {
    if (selector.includes("camera-preset")) {
      // Named presets live in the 시점 menu (HudToolbar); open it first when the item is not in the DOM.
      await this.run((sel) => {
        if (!document.querySelector(sel)) document.querySelector("[data-qa=camera-view-menu]")?.click();
      }, selector);
      await sleep(300);
      await this.run((sel) => document.querySelector(sel)?.scrollIntoView({ inline: "center", block: "nearest" }), selector);
    }
    const deadline = Date.now() + timeoutMs;
    let point = await this.center(selector, text);
    while (!point && Date.now() < deadline) {
      await sleep(500);
      point = await this.center(selector, text);
    }
    if (!point) return { ok: false, action: `NOT FOUND ${selector}${text ? ` "${text}"` : ""}` };
    await withTimeout(this.view.click(point[0], point[1]), 30000, "click");
    return { ok: true, action: `click ${selector}${text ? ` "${text}"` : ""} @${Math.round(point[0])},${Math.round(point[1])}` };
  }

  async wheel(x, y, deltaY, times) {
    for (let index = 0; index < times; index += 1) {
      await withTimeout(this.view.cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY }), 30000, "mouseWheel");
      await sleep(60);
    }
  }

  async mouse(type, x, y, buttons = 0, modifiers = 0) {
    await withTimeout(this.view.cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, modifiers }), 30000, type);
  }

  async key(key) {
    await withTimeout(this.view.press(key), 30000, `press ${key}`);
  }

  // Camera settle instead of a fixed wait: an in-page requestAnimationFrame loop counts consecutive frames in which the
  // label layer reports no motion (data-motion != "true") and no visible chip moved more than epsilonPx. Settled after
  // `frames` such frames in a row; gives up after timeoutMs (reported, never silently treated as settled). Frames only
  // count once motion has been seen or armMs has passed, so a fly that starts a frame late is not read as "still".
  async cameraSettle({ frames = 8, epsilonPx = 0.5, timeoutMs = 15000, armMs = 600 } = {}) {
    const started = Date.now();
    await this.run((need, eps, arm) => {
      if (window.__qaSettle) window.__qaSettle.cancel = true;
      const state = { done: false, still: 0, cancel: false, sawMotion: false, t0: performance.now() };
      window.__qaSettle = state;
      let previous = null;
      const tick = () => {
        if (state.cancel) return;
        const moving = document.querySelector("[data-qa=campus-label-layer]")?.dataset.motion === "true";
        const now = [...document.querySelectorAll("button[data-qa=campus-label]")].map((el) => {
          const r = el.getBoundingClientRect();
          return [r.x, r.y];
        });
        let delta = previous && previous.length === now.length ? 0 : Infinity;
        if (delta === 0) now.forEach(([x, y], i) => { delta = Math.max(delta, Math.abs(x - previous[i][0]), Math.abs(y - previous[i][1])); });
        previous = now;
        if (moving || (delta !== Infinity && delta > eps)) state.sawMotion = true;
        const armed = state.sawMotion || performance.now() - state.t0 > arm;
        state.still = armed && !moving && delta <= eps ? state.still + 1 : 0;
        if (state.still >= need) state.done = true;
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, frames, epsilonPx, armMs);
    for (;;) {
      const done = await this.run(() => Boolean(window.__qaSettle?.done));
      if (done) return { settled: true, ms: Date.now() - started };
      if (Date.now() - started > timeoutMs) {
        await this.run(() => { if (window.__qaSettle) window.__qaSettle.cancel = true; });
        return { settled: false, ms: Date.now() - started };
      }
      await sleep(100);
    }
  }

  async setTimeMinutes(minutes) {
    return this.run((value) => {
      const input = document.querySelector("[data-qa=time-slider] input[type=range]");
      if (!input) return null;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { min: Number(input.min), max: Number(input.max), value: Number(input.value) };
    }, minutes);
  }

  async close() {
    try {
      this.view.close();
    } catch {
      // Already closed.
    }
    rmSync(this.profileDir, { recursive: true, force: true });
  }
}

export function closeAllBrowsers() {
  try {
    Bun.WebView.closeAll();
  } catch {
    // No view open.
  }
}

export { sleep };

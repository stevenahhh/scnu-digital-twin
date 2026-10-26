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
    await this.view.navigate(url);
  }

  // Evaluates fn(...args) in the page. fn must be self-contained (it is serialised).
  async run(fn, ...args) {
    return this.view.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
  }

  async evaluate(expression) {
    return this.view.evaluate(expression);
  }

  async screenshot() {
    const shot = await this.view.screenshot({ encoding: "buffer" });
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
      const nodes = [...document.querySelectorAll(sel)].filter((node) => txt == null || (node.textContent || "").trim() === txt);
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
      await this.run((sel) => document.querySelector(sel)?.scrollIntoView({ inline: "center", block: "nearest" }), selector);
    }
    const deadline = Date.now() + timeoutMs;
    let point = await this.center(selector, text);
    while (!point && Date.now() < deadline) {
      await sleep(500);
      point = await this.center(selector, text);
    }
    if (!point) return { ok: false, action: `NOT FOUND ${selector}${text ? ` "${text}"` : ""}` };
    await this.view.click(point[0], point[1]);
    return { ok: true, action: `click ${selector}${text ? ` "${text}"` : ""} @${Math.round(point[0])},${Math.round(point[1])}` };
  }

  async wheel(x, y, deltaY, times) {
    for (let index = 0; index < times; index += 1) {
      await this.view.cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
      await sleep(60);
    }
  }

  async mouse(type, x, y, buttons = 0, modifiers = 0) {
    await this.view.cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, modifiers });
  }

  async key(key) {
    await this.view.press(key);
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

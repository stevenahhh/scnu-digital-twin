// S01..S17 state machine. S01..S12 follow SCREENS "How to reproduce" literally; S13..S17 are the
// plan's additions. Each state's `steps` run from the previous state and end at the capture point;
// `after` runs once the screenshot and checks are done (e.g. releasing the S11 drag).
import { sleep } from "./browser.mjs";
import { decode, inPage, pixelDiff } from "./probe.mjs";

export const STATE_IDS = Object.freeze(["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12", "S13", "S14", "S15", "S16", "S17"]);
export const CHAIN_IDS = Object.freeze(STATE_IDS.slice(0, 15));
export const S17_SUBSTATES = Object.freeze(["S01", "S04", "S06", "S08", "S13"]);
export const VWORLD_STATE_IDS = Object.freeze(STATE_IDS.slice(0, 12));
export const SAMPLE_OFFSETS_MS = Object.freeze([500, 2000, 2500]);

const PANEL_CLOSE = '[aria-label="패널 닫기"]';
const PANEL_OPEN = '[aria-label="패널 열기"]';
const CHIP = "button[data-qa=campus-label]";

async function act(ctx, selector, text, options) {
  const result = await ctx.b.tap(selector, text, options);
  ctx.actions.push(result.action);
  return result.ok;
}

async function tapIfVisible(ctx, selector, text) {
  if (await ctx.b.center(selector, text)) return act(ctx, selector, text);
  return false;
}

async function wait(ctx, ms) {
  ctx.actions.push(`wait ${ms / 1000} s`);
  await sleep(ms);
}

// After a camera move (preset fly, wheel): wait until the camera and the labels it drives are still, so the next tap
// lands on the chip at its final position instead of where it was mid-flight.
async function settleCamera(ctx) {
  const result = await ctx.b.cameraSettle();
  ctx.actions.push(result.settled ? `camera settled after ${result.ms} ms (8 still frames)` : `camera NOT settled after ${result.ms} ms`);
}

async function closePanelOnMobile(ctx) {
  if (ctx.mobile && (await tapIfVisible(ctx, PANEL_CLOSE))) await sleep(1200);
}

async function openPanelOnMobile(ctx) {
  if (ctx.mobile && (await tapIfVisible(ctx, PANEL_OPEN))) await sleep(1200);
}

async function setTime(ctx, minutes) {
  const result = await ctx.b.setTimeMinutes(minutes);
  ctx.actions.push(result
    ? `set [data-qa=time-slider] input[type=range] (min ${result.min}, max ${result.max}) to ${minutes} via native value setter + input/change`
    : "NOT FOUND [data-qa=time-slider] input[type=range]");
}

// DOM snapshot used by the loading/skeleton checks (GAP-31, V-F-48).
async function domSample(ctx) {
  return ctx.b.run(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const inspector = document.querySelector("[data-qa=selection-inspector]");
    const spinners = [...document.querySelectorAll(".animate-spin,[role=progressbar],[aria-busy=true]")].filter(visible);
    return {
      spinners: spinners.length,
      spinnerTexts: spinners.map((el) => (el.closest("[role=status],div")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)),
      skeletons: [...document.querySelectorAll("[data-qa=skeleton],.animate-pulse")].filter(visible).length,
      inspector: Boolean(inspector),
      text: (inspector ?? document.querySelector("[data-qa=dashboard-panel]"))?.innerText?.replace(/\s+/g, " ").slice(0, 200) ?? null,
    };
  });
}

// Samples the DOM (and optionally screenshots) at fixed offsets after a trigger action.
async function samplesAfterTrigger(ctx, label) {
  const start = Date.now();
  const samples = [];
  for (const offset of SAMPLE_OFFSETS_MS) {
    const remaining = offset - (Date.now() - start);
    if (remaining > 0) await sleep(remaining);
    const sample = { offsetMs: offset, ...(await domSample(ctx)) };
    if (ctx.sampleShots?.includes(offset)) sample.file = await ctx.saveSample(label, offset);
    samples.push(sample);
  }
  ctx.memo.set(`${ctx.stateLabel}:samples`, samples);
  ctx.actions.push(`sampled DOM at ${SAMPLE_OFFSETS_MS.join("/")} ms after the tap`);
}

async function waitForReady(ctx) {
  const legacy = ctx.entry === "legacy";
  for (let index = 0; index < 120; index += 1) {
    const ready = await ctx.b.run((isLegacy) => Boolean(document.querySelector("canvas"))
      && (isLegacy ? document.querySelectorAll("button[data-qa=campus-label]").length > 5 : Boolean(document.querySelector("[data-qa=dashboard-panel]"))), legacy);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

// Screenshot every 3 s until two consecutive PNG sizes differ by < 2 % (min 15 s, max 75 s).
async function settle(ctx) {
  const t0 = Date.now();
  let previous = 0;
  for (;;) {
    await sleep(3000);
    const size = (await ctx.b.screenshot()).length;
    const elapsed = Date.now() - t0;
    if ((elapsed > 15000 && previous && Math.abs(size - previous) / previous < 0.02) || elapsed > 75000) break;
    previous = size;
  }
  return Math.round((Date.now() - t0) / 1000);
}

// 설정 > 테마 > 라이트|다크 through the real dialog; dark keeps the default 시스템 + dark media.
export async function applyTheme(ctx, theme) {
  if (theme !== "light") {
    ctx.actions.push("theme 시스템 (prefers-color-scheme: dark emulated)");
    return true;
  }
  await openPanelOnMobile(ctx);
  await act(ctx, '[aria-label="설정"]');
  await sleep(800);
  await act(ctx, "[role=dialog] button", "라이트");
  await sleep(500);
  await ctx.b.key("Escape");
  ctx.actions.push("press Escape");
  await sleep(600);
  if (await ctx.b.center('[role=dialog] [aria-label="닫기"]')) await act(ctx, '[role=dialog] [aria-label="닫기"]');
  const applied = await ctx.b.evaluate("document.documentElement.dataset.theme");
  ctx.actions.push(`data-theme=${applied}`);
  return applied === "light";
}

// VWorld streams map tiles from a live service after every camera move and refines them in batches;
// wait until three screenshots 1.5 s apart all stay within 1 % PNG size (min 6 s, max 40 s) so a
// frame is never half-loaded or caught between two refinement batches.
export async function settleTiles(ctx) {
  const t0 = Date.now();
  const sizes = [(await ctx.b.screenshot()).length];
  for (;;) {
    await sleep(1500);
    sizes.push((await ctx.b.screenshot()).length);
    const last = sizes.slice(-3);
    const stable = last.length === 3 && Math.max(...last) / Math.min(...last) - 1 < 0.01;
    const elapsed = Date.now() - t0;
    if ((elapsed >= 6000 && stable) || elapsed > 40000) break;
  }
  ctx.actions.push(`map tiles settled after ${Math.round((Date.now() - t0) / 100) / 10} s`);
}

export async function loadAndSettle(ctx, url) {
  await ctx.b.navigate(url);
  ctx.memo.set(`${ctx.stateLabel}:navigatedAt`, Date.now());
  ctx.actions.push(`navigate ${url.replace(/^https?:\/\/[^/]+/, "")}`);
  const ready = await waitForReady(ctx);
  ctx.actions.push(ready ? "ready: canvas + labels/panel present" : "NOT READY after 60 s");
  await applyTheme(ctx, ctx.theme);
  const seconds = await settle(ctx);
  ctx.actions.push(`settled after ${seconds} s`);
}

async function enterD4(ctx, beforeLabelTap) {
  await tapIfVisible(ctx, '[aria-label="닫기"]');
  await closePanelOnMobile(ctx);
  if (ctx.entry === "vworld") {
    // VWorld has no campus chips: D4 opens from its MODEL_NAME pick or the D4 coordinate-marker button.
    if (beforeLabelTap) await beforeLabelTap();
    await act(ctx, "button", "D4 공과대학 3호관 상세 보기");
    await wait(ctx, 4000);
    return;
  }
  await act(ctx, "[data-qa=camera-preset-d4]");
  await settleCamera(ctx);
  if (beforeLabelTap) await beforeLabelTap();
  // Building chips show the one display name (GAP-12), not the preset short name 공대 3호관.
  await act(ctx, CHIP, "공과대학 3호관");
  await wait(ctx, 4000);
}

async function selectLibrary(ctx, waitAfterMs) {
  await act(ctx, "[data-qa=camera-preset-library]");
  await settleCamera(ctx);
  await act(ctx, CHIP, "도서관");
  await samplesAfterTrigger(ctx, ctx.stateLabel);
  const extra = waitAfterMs - SAMPLE_OFFSETS_MS[SAMPLE_OFFSETS_MS.length - 1];
  if (extra > 0) await wait(ctx, extra);
}

export const STATES = Object.freeze([
  {
    id: "S01", name: "initial-load",
    steps: async (ctx) => loadAndSettle(ctx, ctx.url),
  },
  {
    id: "S02", name: "zoomed-out-campus",
    steps: async (ctx) => {
      await closePanelOnMobile(ctx);
      await ctx.b.wheel(ctx.map.x, ctx.map.y, 300, 8);
      ctx.actions.push(`8x mouseWheel deltaY=+300 at ${ctx.map.x},${ctx.map.y}`);
      // OrbitControls damping keeps the camera (and the faded, frozen label layer) moving well past 2.5 s under SwiftShader.
      await settleCamera(ctx);
    },
  },
  {
    id: "S03", name: "zoomed-in-plaza-labels",
    steps: async (ctx) => {
      // Legacy zooms toward the orbit target (the campus centre). The VWorld SDK zooms toward the cursor, so a wheel at the
      // map centre after S02 dives into whatever lies there; zoom toward a fixed campus anchor instead: the 도서관 chip's
      // anchor point (data-anchor-top, the chip's centre x), else the map centre.
      let { x, y } = ctx.map;
      if (ctx.entry === "vworld") {
        const anchor = await ctx.b.run(() => {
          const slot = [...document.querySelectorAll("[data-label-slot]")].find((node) => node.style.visibility === "visible"
            && node.querySelector("button[data-qa=campus-label]")?.getAttribute("data-element-id") === "BLD_C1");
          if (!slot?.dataset.anchorTop) return null;
          const r = slot.getBoundingClientRect();
          return [Math.round(r.x + r.width / 2), Math.round(Number(slot.dataset.anchorTop))];
        });
        if (anchor) [x, y] = anchor;
      }
      await ctx.b.wheel(x, y, -300, 14);
      ctx.actions.push(`14x mouseWheel deltaY=-300 at ${x},${y}${ctx.entry === "vworld" ? " (VWorld: 도서관 anchor)" : ""}`);
      await settleCamera(ctx);
    },
  },
  {
    id: "S04", name: "building-selected-library",
    steps: async (ctx) => {
      await ctx.snapshot("S04:before-click");
      await selectLibrary(ctx, 3500);
    },
  },
  {
    id: "S05", name: "D4-section-drilldown",
    steps: async (ctx) => {
      // GAP-07 / V-S-82: the tab and panel scroll position right before the D4 label is tapped.
      await enterD4(ctx, async () => ctx.memo.set("S05:before", await inPage(ctx.b, (qa) => ({
        tab: qa.activeTab(),
        scrollTop: qa.one("[data-qa=dashboard-panel] .overflow-y-auto")?.scrollTop ?? null,
      }))));
    },
  },
  {
    id: "S06", name: "time-night-2100",
    steps: async (ctx) => {
      await act(ctx, '[aria-label="캠퍼스 지도로 돌아가기"]');
      await wait(ctx, 3000);
      ctx.memo.set("S06:after-return", await inPage(ctx.b, (qa) => ({
        tab: qa.activeTab(),
        scrollTop: qa.one("[data-qa=dashboard-panel] .overflow-y-auto")?.scrollTop ?? null,
      })));
      await act(ctx, "[data-qa=camera-preset-overview]");
      await settleCamera(ctx);
      await setTime(ctx, 1260);
      await wait(ctx, 3500);
    },
  },
  {
    id: "S07", name: "time-noon-1200",
    steps: async (ctx) => {
      await setTime(ctx, 720);
      await wait(ctx, 3500);
    },
  },
  {
    id: "S08", name: "panel-environment-tab",
    steps: async (ctx) => {
      await openPanelOnMobile(ctx);
      await act(ctx, "[data-qa=dashboard-tab-environment]");
      await wait(ctx, 3000);
    },
  },
  {
    id: "S09", name: "camera-preset-gate",
    steps: async (ctx) => {
      await act(ctx, "[data-qa=dashboard-tab-dashboard]");
      await sleep(600);
      await closePanelOnMobile(ctx);
      await act(ctx, "[data-qa=camera-preset-gate]");
      await settleCamera(ctx);
    },
  },
  {
    id: "S10", name: "settings-render-quality",
    steps: async (ctx) => {
      await openPanelOnMobile(ctx);
      await act(ctx, '[aria-label="설정"]');
      await wait(ctx, 1500);
    },
    after: async (ctx) => {
      await ctx.b.key("Escape");
      await sleep(600);
      await tapIfVisible(ctx, '[role=dialog] [aria-label="닫기"]');
      await sleep(600);
    },
  },
  {
    id: "S11", name: "mid-drag",
    steps: async (ctx) => {
      await closePanelOnMobile(ctx);
      const { x, y } = ctx.map;
      await ctx.b.mouse("mouseMoved", x, y, 0);
      await ctx.b.mouse("mousePressed", x, y, 1);
      for (let index = 1; index <= 10; index += 1) {
        await ctx.b.mouse("mouseMoved", x + index * 15, y + index * 6, 1);
        await sleep(40);
      }
      const holdMs = ctx.args?.holdMs ?? 150;
      await sleep(holdMs);
      // OrbitControls damping keeps easing after the last move, so a frame taken 150 ms in depends on
      // the frame rate. Keep holding until two frames 300 ms apart differ by < 0.2 % (max 10 s).
      const started = Date.now();
      let previous = decode(await ctx.b.screenshot());
      let diff = 1;
      while (Date.now() - started < 10000) {
        await sleep(300);
        const next = decode(await ctx.b.screenshot());
        diff = pixelDiff(previous, next);
        previous = next;
        if (diff < 0.002) break;
      }
      ctx.actions.push(`mousePressed at ${x},${y}; 10x mouseMoved (+15,+6); held ${holdMs} ms + ${Date.now() - started} ms until the orbit settled (frame diff ${diff.toFixed(4)}); capture while held`);
    },
    after: async (ctx) => {
      await ctx.b.mouse("mouseReleased", ctx.map.x + 150, ctx.map.y + 60, 0);
      await sleep(1500);
    },
  },
  {
    id: "S12", name: "panel-open-overlap",
    steps: async (ctx) => {
      await selectLibrary(ctx, 2500);
      if (await tapIfVisible(ctx, PANEL_OPEN)) await wait(ctx, 1500);
    },
  },
  {
    id: "S13", name: "parking-safety-tab",
    steps: async (ctx) => {
      await openPanelOnMobile(ctx);
      await act(ctx, "[data-qa=dashboard-tab-parking_safety]");
      await wait(ctx, 3000);
    },
  },
  {
    id: "S14", name: "d4-room-grid-floor-6",
    steps: async (ctx) => {
      await enterD4(ctx);
      if (!(await ctx.b.center('[aria-label="6층 선택"]'))) await tapIfVisible(ctx, "button", "교수동");
      await sleep(1500);
      await act(ctx, '[aria-label="6층 선택"]');
      let grid = false;
      for (let index = 0; index < 24 && !grid; index += 1) {
        grid = await ctx.b.run(() => Boolean(document.querySelector("[data-qa=d4-room-grid]")));
        if (!grid) await sleep(500);
      }
      ctx.actions.push(grid ? "[data-qa=d4-room-grid] present" : "waited 12 s: [data-qa=d4-room-grid] not present (hook not in product yet)");
    },
  },
  {
    id: "S15", name: "roof-editor",
    steps: async (ctx) => {
      const inD4 = await ctx.b.run(() => Boolean(document.querySelector("#d4-installation-tab")));
      if (!inD4) await enterD4(ctx);
      // 편집 only exists when the plan list loads, so the energy fixtures are up for this state only.
      if (ctx.fixtureControl) {
        await ctx.fixtureControl.up();
        ctx.actions.push("fixtures up for S15 (the plan list needs a plan for 편집)");
      }
      await act(ctx, "#d4-installation-tab");
      await wait(ctx, 3000);
      await act(ctx, "button", "편집");
      await wait(ctx, 3000);
    },
    after: async (ctx) => {
      await tapIfVisible(ctx, '[aria-label="캠퍼스 지도로 돌아가기"]');
      await sleep(2000);
      if (ctx.fixtureControl) await ctx.fixtureControl.restore();
    },
  },
  {
    id: "S16", name: "light-theme",
    forcedTheme: "light",
    steps: async (ctx) => loadAndSettle(ctx, ctx.url),
  },
  {
    id: "S17", name: "fixtures-up",
    steps: async () => {},
  },
]);

export function stateById(id) {
  return STATES.find((state) => state.id === id);
}

// Expands "S01..S17", "S01,S04" or "S03..S06" into ordered ids.
export function parseStateList(value) {
  if (!value) return [...STATE_IDS];
  const out = new Set();
  for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    const range = part.match(/^(S\d\d)\.\.(S\d\d)$/);
    if (range) {
      const from = STATE_IDS.indexOf(range[1]);
      const to = STATE_IDS.indexOf(range[2]);
      if (from < 0 || to < 0 || to < from) throw new Error(`unknown state range ${part}`);
      for (let index = from; index <= to; index += 1) out.add(STATE_IDS[index]);
    } else if (STATE_IDS.includes(part) || part === "GALLERY") {
      out.add(part);
    } else {
      throw new Error(`unknown state ${part}`);
    }
  }
  return STATE_IDS.filter((id) => out.has(id)).concat(out.has("GALLERY") ? ["GALLERY"] : []);
}

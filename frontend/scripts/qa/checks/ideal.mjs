// IS-01..IS-40: the verifiable ideal-state rows of .omo/ui-hig-2026-11-09/audit/ideal-state.md section 6.2, measured with
// the section 6.1 helpers (installed in the page as window.__qaIdeal). The browser side collects facts; checks/ideal-eval.mjs
// decides. A row whose product hook does not exist yet FAILs with measured "hook missing" (never a vacuous pass).
//
// Each check declares `scenarios` ({ states, viewports, entries?, fixtures }) because one state id can be needed with the
// fixtures down (S01) and up (the S17 sub-state S01). `parts` share the id but act on the page (`mutates`, probe replay).
// Tablet policy: a row evaluates on T only when its scenarios name T (IS-07, IS-17, IS-18, IS-25, IS-27, IS-33);
// every other row reports n/a on T (`naOnTablet`).
import { decode } from "../lib/probe.mjs";
import { sleep } from "../lib/browser.mjs";
import { readFixtureRequests, waitFixturesAnswered } from "../lib/fixtures.mjs";
import { openPanel, openTab, panelState, pickTabValue, TAB_ROLES, tabSelector } from "../lib/tabs.mjs";
import { readCameraPose } from "../lib/states.mjs";
import { restoreCamera, saveCamera } from "./common.mjs";
import { IDEAL_ROWS } from "./ideal-rows.mjs";
import {
  CAMERA_REST_TIMEOUT_MS, CAMERA_STILL_MAX_DEG, CAMERA_STILL_MAX_M, STILL_MAX_BITS, cameraMotion, cameraRestAt, cameraVerdict, compareNameSets, controlBudgetLimit, countAtMost, countExactly, duplicateValues, hookMissing, hudPanelViolations,
  isLayoutTransition, kstDate, lineCount, loadingProblems, minimum, nearestSample, overlappingPairs, presentationExtras,
  regionDistance, stoppedAfterD4, tabsMatch, undersized, verdict,
} from "./ideal-eval.mjs";

// ideal-state.md section 6.1, verbatim, plus small fact collectors used by several rows.
export const IDEAL_PAGE_SOURCE = `(() => {
  if (window.__qaIdeal) return true;
  const CONTROL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=combobox], [role=slider], [role=menuitem], [role=switch]';
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
      if (n.hidden || n.inert || n.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  }
  const visibleControls = (root = document) => [...root.querySelectorAll(CONTROL)]
    .filter(isVisible)
    .filter(el => !el.closest('[data-qa=campus-label-layer]'))
    .filter(el => !(el.matches('input') && el.closest('[role=combobox]') && el.closest('[role=combobox]') !== el));
  const overlaps = (a, b) => { const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    return p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom; };
  const sceneTime = () => { const input = document.querySelector('[data-qa=time-slider] input[type=range]'); if (!input) return null;
    const v = Number(input.value);
    return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0'); };
  const textNodesWith = (s) => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const out = [];
    for (let n; (n = w.nextNode());) if (n.nodeValue.includes(s) && n.parentElement && isVisible(n.parentElement)) out.push(n); return out; };
  // The accessible name IS-03 compares: aria-label, else the trimmed text.
  const nameOf = (el) => (el.getAttribute('aria-label') ?? el.textContent.trim()).replace(/\\s+/g, ' ');
  // In the accessibility tree (screen-reader-only text included): not display:none, visibility:hidden, hidden or aria-hidden.
  const exposed = (el) => { for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden' || n.hidden || n.getAttribute('aria-hidden') === 'true') return false; } return true; };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  // [data-qa=campus-hud] spans the whole viewport (CampusHud.jsx:44-47); the bar is [data-qa=hud-bar], else its first row child.
  const hudBar = () => { const hook = document.querySelector('[data-qa=hud-bar]'); if (hook) return { el: hook, via: '[data-qa=hud-bar]' };
    const hud = document.querySelector('[data-qa=campus-hud]'); if (!hud) return null;
    const row = [...hud.children].find((c) => { const s = getComputedStyle(c); return s.display.includes('flex') && !s.flexDirection.startsWith('column'); }) ?? hud.firstElementChild;
    return row ? { el: row, via: 'first row child of [data-qa=campus-hud] (until [data-qa=hud-bar] exists)' } : null; };
  const facts = (root = document) => { const list = visibleControls(root);
    return list.map((el) => ({ name: nameOf(el).slice(0, 40) || el.tagName.toLowerCase(), rect: rect(el), w: rect(el).w, h: rect(el).h,
      slider: el.matches('input[type=range], [role=slider]'),
      ancestors: list.map((other, j) => (other !== el && other.contains(el) ? j : -1)).filter((j) => j >= 0) })); };
  window.__qaIdeal = { CONTROL, isVisible, visibleControls, overlaps, sceneTime, textNodesWith, nameOf, exposed, rect, hudBar, facts };
  return true;
})()`;

// Runs fn(window.__qaIdeal, args) in the page. fn must be self-contained (it is serialised).
export async function ip(ctx, fn, args = {}) {
  await ctx.b.evaluate(IDEAL_PAGE_SOURCE);
  return ctx.b.evaluate(`(${fn.toString()})(window.__qaIdeal, ${JSON.stringify(args)})`);
}

const CHIP = "button[data-qa=campus-label]";
const PANEL_CLOSE = '[aria-label="패널 닫기"]';
const PLAY = '[data-qa=time-slider] button[aria-label="시간 재생"]';
const PAUSE = '[data-qa=time-slider] button[aria-label="시간 일시정지"]';
const BACK_TO_CAMPUS = '[aria-label="캠퍼스 지도로 돌아가기"]';
const S01_S15 = ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12", "S13", "S14", "S15"];

const sc = (states, viewports, fixtures = "down", entries) => Object.freeze({ states, viewports, fixtures, ...(entries ? { entries } : {}) });
const viewportsOf = (scenarios) => [...new Set(scenarios.flatMap((spec) => spec.viewports ?? ["D", "P", "T"]))];

function defineIdeal(id, spec) {
  const row = IDEAL_ROWS[id];
  if (!row) throw new Error(`no ideal-state row for ${id}`);
  const doc = `${row.check} | ${row.states} | ${row.measure}`;
  const parts = (spec.parts ?? []).map((part) => Object.freeze({ id, doc, part: true, ...part, viewports: viewportsOf(part.scenarios) }));
  const own = spec.scenarios ? viewportsOf(spec.scenarios) : [];
  const all = [...own, ...parts.flatMap((part) => part.viewports)];
  return Object.freeze({ id, doc, ...spec, ...(spec.scenarios ? { viewports: own } : {}), parts, naOnTablet: !all.includes("T") });
}

// A part that only acts (every measurement of the row needs a page action).
const actingOnly = { scenarios: Object.freeze([]), run: async () => verdict(false, "unreachable", null) };

const sleepMs = (ms) => sleep(ms);

async function tapVisible(ctx, selector, text) {
  if (!(await ctx.b.center(selector, text))) return false;
  await ctx.b.tap(selector, text, { timeoutMs: 3000 });
  return true;
}

// The map area of the current frame: the largest canvas minus the panel, inspector card, rail and phone sheet.
async function mapRegion(ctx) {
  return ip(ctx, (I) => {
    const canvas = [...document.querySelectorAll("canvas")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!canvas) return null;
    const c = canvas.getBoundingClientRect();
    const left = Math.max(c.left, 0);
    let right = Math.min(c.right, innerWidth);
    let bottom = Math.min(c.bottom, innerHeight);
    for (const sel of ["[data-qa=dashboard-panel]", "[data-qa=inspector-card]", "[data-qa=dashboard-rail]"]) {
      const el = document.querySelector(sel);
      if (!el || !I.isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left > left + 100 && r.left < right && r.top < innerHeight / 2) right = r.left;
    }
    const sheet = document.querySelector("[data-qa=sheet]");
    if (sheet && I.isVisible(sheet)) bottom = Math.min(bottom, sheet.getBoundingClientRect().top);
    const top = Math.max(c.top, 0);
    return { x: left, y: top, w: Math.max(1, right - left - 4), h: Math.max(1, bottom - top) };
  });
}

// Clicks `selector` in the page (or dispatches `key` on the focused element) and samples the DOM at `offsets` ms.
// kind: hudPanel (IS-34), closeContent (IS-35), labelOpacity (IS-37), updated (IS-36), loading (IS-39), sheetOpacity (IS-38).
async function actAndSample(ctx, { selector = null, key = null, kind, offsets, every = 0, duration = 0 }) {
  return ip(ctx, async (I, a) => {
    const measure = () => {
      if (a.kind === "hudPanel") {
        const h = document.querySelector("[data-qa=campus-hud]")?.getBoundingClientRect();
        const p = document.querySelector("[data-qa=dashboard-panel]")?.getBoundingClientRect();
        return { hudRight: h ? Math.round(h.right * 10) / 10 : null, panelLeft: p ? Math.round(p.left * 10) / 10 : null };
      }
      if (a.kind === "closeContent") {
        const list = document.querySelector("[data-qa=dashboard-panel] [role=tablist]");
        const rail = document.querySelector("[data-qa=dashboard-rail]");
        return { tablistVisible: Boolean(list && I.isVisible(list)), railVisible: Boolean(rail && I.isVisible(rail)) };
      }
      if (a.kind === "labelOpacity") {
        const layer = document.querySelector("[data-qa=campus-label-layer]");
        return { opacity: layer ? Number(getComputedStyle(layer).opacity) : null };
      }
      if (a.kind === "updated") {
        const card = document.querySelector("[data-qa=time-slider]");
        return { updated: document.querySelectorAll("[data-updated=true]").length, border: card ? getComputedStyle(card).borderTopColor : null };
      }
      if (a.kind === "sheetOpacity") {
        // The phone shell passes data-qa="dashboard-panel" to its Sheet, which overrides the Sheet's own data-qa="sheet".
        const sheet = document.querySelector("[data-qa=sheet]") ?? document.querySelector("[data-qa=dashboard-panel][data-detent]");
        return { opacity: sheet ? Number(getComputedStyle(sheet).opacity) : null };
      }
      if (a.kind === "loading") {
        const cardOf = (el) => el.closest("[data-qa=selection-inspector],[data-qa=energy-dashboard],[data-qa=building-analysis],[data-qa=campus-comparison],section,article");
        const label = (card) => (card ? card.getAttribute("data-qa") || `${card.tagName.toLowerCase()}:${(card.getAttribute("aria-label") || card.querySelector("h2,h3,h4")?.textContent || "").trim().slice(0, 24)}` : "page");
        // A spinner counts only when the spinning element itself is visible (a delayed spinner waits at opacity 0).
        const spinEls = [...document.querySelectorAll(".animate-spin")].filter(I.isVisible);
        const spinners = [...document.querySelectorAll("[role=status]")].filter(I.isVisible).filter((el) => spinEls.some((spin) => el === spin || el.contains(spin)));
        const skeletons = [...document.querySelectorAll("[data-qa=skeleton], .animate-pulse")].filter(I.isVisible);
        const cards = new Map();
        for (const el of spinEls) { const k = label(cardOf(el)); const c = cards.get(k) ?? { card: k, spinners: 0, skeletons: 0 }; c.spinners += 1; cards.set(k, c); }
        for (const el of skeletons) { const k = label(cardOf(el)); const c = cards.get(k) ?? { card: k, spinners: 0, skeletons: 0 }; c.skeletons += 1; cards.set(k, c); }
        return { spinners: spinners.length, cards: [...cards.values()] };
      }
      return {};
    };
    const before = measure();
    let target = null;
    if (a.selector) {
      target = [...document.querySelectorAll(a.selector)].find(I.isVisible);
      if (!target) return { missing: a.selector, before };
    }
    const out = [];
    const started = performance.now();
    if (target) target.click();
    if (a.key) {
      const on = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
      on.dispatchEvent(new KeyboardEvent("keydown", { key: a.key, code: a.key, bubbles: true, cancelable: true }));
      on.dispatchEvent(new KeyboardEvent("keyup", { key: a.key, code: a.key, bubbles: true, cancelable: true }));
    }
    // Offsets count from the moment the click/key handler returned: under SwiftShader a Legacy handler can hold the main
    // thread for over a second, and no frame (so no transition) starts before it returns.
    const t0 = performance.now();
    const handlerMs = Math.round(t0 - started);
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (a.every) {
      while (performance.now() - t0 < a.duration) { out.push({ t: Math.round(performance.now() - t0), ...measure() }); await wait(a.every); }
    } else {
      for (const offset of a.offsets) {
        const left = offset - (performance.now() - t0);
        if (left > 0) await wait(left);
        out.push({ t: Math.round(performance.now() - t0), ...measure() });
      }
    }
    return { before, handlerMs, samples: out };
  }, { selector, key, kind, offsets: offsets ?? [], every, duration });
}

async function sliderMinutes(ctx) {
  return ctx.b.run(() => {
    const input = document.querySelector("[data-qa=time-slider] input[type=range]");
    return input ? Number(input.value) : null;
  });
}

// The tab whose content holds the traffic simulation panel (contract C5): tries the traffic role's tab values in turn.
async function findTrafficPanel(ctx) {
  const start = await panelState(ctx.b);
  const tried = [];
  const visible = () => ip(ctx, (I) => { const el = document.querySelector("[data-qa=traffic-simulation-panel]"); return Boolean(el && I.isVisible(el)); });
  if (await visible()) return { found: true, value: start.active, tried, start };
  for (const value of TAB_ROLES.traffic.filter((v) => start.values.includes(v))) {
    tried.push(value);
    await openTab(ctx, value);
    await sleepMs(1500);
    if (await visible()) return { found: true, value, tried, start };
  }
  return { found: false, value: null, tried, start };
}

async function restoreTab(ctx, start) {
  if (start?.active) await openTab(ctx, start.active);
  await sleepMs(600);
}

// IS-31/IS-32/IS-38 camera reads. A chip tap focuses the VWorld camera only when the building lies outside the central
// 60% of the canvas (VWorldRenderer focusBuilding), so the checks tap the visible chip farthest from the centre. The 전체
// preset is tried first (the 도서관 preset is too close for one); when HUD chrome hides every off-centre chip there (an open
// inspector narrows the map area), the next named presets are tried. Returns { region, chip, preset } with chip null when
// no preset yields one.
const OFF_CENTRE_PRESETS = ["overview", "gate", "engineering", "humanities"];
async function offCentreChip(ctx) {
  let last = { region: null, chip: null, preset: null };
  for (const preset of OFF_CENTRE_PRESETS) {
    await ctx.b.tap(`[data-qa=camera-preset-${preset}]`, null, { timeoutMs: 4000 });
    await ctx.b.cameraSettle();
    await sleepMs(ctx.entry === "vworld" ? 1500 : 300);
    const region = await mapRegion(ctx);
    if (!region) return { region: null, chip: null, preset };
    const chip = await ip(ctx, (I, r) => {
      const canvas = [...document.querySelectorAll("canvas")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      const c = canvas.getBoundingClientRect();
      const cx = c.left + c.width / 2;
      const cy = c.top + c.height / 2;
      const chips = [...document.querySelectorAll("button[data-qa=campus-label]")].filter(I.isVisible)
        .filter((el) => el.getAttribute("data-state") !== "selected")
        .map((el) => { const b = el.getBoundingClientRect(); return { el, name: el.textContent.trim(), x: b.left + b.width / 2, y: b.top + b.height / 2 }; })
        .filter((p) => p.x > r.x + 40 && p.x < r.x + r.w - 40 && p.y > r.y + 80 && p.y < r.y + r.h - 80)
        .filter((p) => Math.abs(p.x - cx) > c.width * 0.3 + 20 || Math.abs(p.y - cy) > c.height * 0.3 + 20)
        .filter((p) => document.elementFromPoint(p.x, p.y)?.closest("button[data-qa=campus-label]") === p.el)
        .sort((p, q) => Math.hypot(q.x - cx, q.y - cy) - Math.hypot(p.x - cx, p.y - cy));
      return chips[0] ? { name: chips[0].name, x: Math.round(chips[0].x), y: Math.round(chips[0].y) } : null;
    }, region);
    last = { region, chip, preset };
    if (chip) return last;
  }
  return last;
}

// Records every pose the app sends to VWorld map.lookat.moveTo (cameraFocus.mjs focus + orbit) into window.__qaMoveTo.
// Under headless SwiftShader the SDK does not apply the per-frame calls, so the commanded pose is read alongside the
// rendered camera. True when the hook is in place (always false on Legacy, which has no such map).
async function recordMoveTo(ctx) {
  return ctx.b.run(() => {
    const lookat = window.__scnuVWorldMapInstance?.lookat;
    window.__qaMoveTo = [];
    if (!lookat || typeof lookat.moveTo !== "function") return false;
    if (lookat.__qaWrapped) return true;
    const original = lookat.moveTo.bind(lookat);
    lookat.moveTo = (...args) => {
      const a = args[0];
      window.__qaMoveTo.push({ t: performance.now(), arg: { location: a?.location ? { x: a.location.x, y: a.location.y, z: a.location.z } : null, direction: a?.direction ? { heading: a.direction.heading, tilt: a.direction.tilt } : null } });
      return original(...args);
    };
    lookat.__qaWrapped = true;
    return true;
  });
}

// { rendered, commanded, calls }: the live camera (readCameraPose) and the latest commanded moveTo pose, heading in deg and
// position in metres east/north/up of the first recorded call.
async function cameraPoses(ctx) {
  const rendered = await ctx.b.run(readCameraPose);
  const { commanded, calls } = await ctx.b.run(() => {
    const list = window.__qaMoveTo ?? [];
    const first = list[0]?.arg?.location;
    const last = list.at(-1)?.arg;
    if (!first || !last?.location || !Number.isFinite(last.direction?.heading)) return { commanded: null, calls: list.length };
    const k = Math.cos((first.y * Math.PI) / 180);
    return { calls: list.length, commanded: { source: "map.lookat.moveTo (commanded)", heading: last.direction.heading,
      position: [(last.location.x - first.x) * 111320 * k, (last.location.y - first.y) * 110574, last.location.z - first.z] } };
  });
  return { rendered, commanded, calls };
}

const cameraHook = (ctx) => (ctx.entry === "vworld" ? "window.ws3d.viewer.camera" : "OrbitControls (controlsRef) via React props");
const roundPose = (pose) => pose && { heading: Math.round(pose.heading * 1000) / 1000, position: pose.position.map((v) => Math.round(v * 10) / 10) };

// Verdict plus a measured record of both readings at offsets a and b (ms after the tap).
function cameraReport(chip, from, to, [a, b], actualMs, expected) {
  const v = cameraVerdict(from, to);
  return verdict(v.still, {
    chip: chip.name, by: v.by, headingDeltaDeg: v.headingDeltaDeg, positionDeltaM: v.positionDeltaM,
    rendered: { source: from.rendered?.source, headingDeltaDeg: v.rendered.headingDeltaDeg, positionDeltaM: v.rendered.positionDeltaM, [a]: roundPose(from.rendered), [b]: roundPose(to.rendered) },
    commanded: v.commanded
      ? { headingDeltaDeg: v.commanded.headingDeltaDeg, positionDeltaM: v.commanded.positionDeltaM, calls: to.calls, [a]: roundPose(from.commanded), [b]: roundPose(to.commanded) }
      : { calls: to.calls },
    actualMs,
  }, expected);
}

// Stops any orbit (it ends only on user input on the map viewport) and replays S04's 도서관 preset + chip. Returns whether
// the moveTo stream stopped.
async function stopOrbitAndReplayS04(ctx) {
  await ctx.b.run(() => {
    const canvas = [...document.querySelectorAll("canvas")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    canvas?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true }));
    canvas?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, isPrimary: true }));
    return true;
  });
  const before = await ctx.b.run(() => window.__qaMoveTo?.length ?? 0);
  await sleepMs(500);
  const after = await ctx.b.run(() => window.__qaMoveTo?.length ?? 0);
  // Legacy D4 칩 선택은 D4 실내 패인을 연다. 열린 채로 두면 다음 검사(IS-32)의 HUD 배치가 패널 여닫기에 따라 바뀐다.
  if (await tapVisible(ctx, BACK_TO_CAMPUS)) await sleepMs(600);
  await ctx.b.tap("[data-qa=camera-preset-library]", null, { timeoutMs: 4000 });
  await ctx.b.cameraSettle();
  await ctx.b.tap(CHIP, "도서관", { timeoutMs: 4000 });
  await ctx.b.cameraSettle();
  return after === before;
}

async function enterD4(ctx) {
  if (await tapVisible(ctx, "[data-qa=d4-open]")) return "[data-qa=d4-open]";
  if (ctx.entry === "vworld") {
    await ctx.b.tap("button", "D4 공과대학 3호관 상세 보기", { timeoutMs: 6000 });
    return "D4 coordinate marker button (until [data-qa=d4-open] exists)";
  }
  await ctx.b.tap("[data-qa=camera-preset-d4]", null, { timeoutMs: 6000 });
  await ctx.b.cameraSettle();
  await ctx.b.tap(CHIP, "공과대학 3호관", { timeoutMs: 6000 });
  return "S05 entry: D4 preset + 공과대학 3호관 chip (until [data-qa=d4-open] exists)";
}

async function waitD4Open(ctx, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await ctx.b.run((sel) => Boolean(document.querySelector("[data-pane=d4]") || document.querySelector(sel)), BACK_TO_CAMPUS);
    if (open) return true;
    await sleepMs(250);
  }
  return false;
}

const countVisible = (ctx, selector, within = null) => ip(ctx, (I, a) => {
  const root = a.within ? document.querySelector(a.within) : document;
  return root ? [...root.querySelectorAll(a.selector)].filter(I.isVisible).length : 0;
}, { selector, within });

export const IDEAL_CHECKS_LIST = [
  defineIdeal("IS-01", {
    scenarios: [sc(["S01"], ["D"], "down"), sc(["S01"], ["D"], "up")],
    async run(ctx) {
      const names = await ip(ctx, (I) => I.visibleControls().map(I.nameOf));
      return countAtMost(names.length, controlBudgetLimit("D", ctx.fixtures), { names });
    },
  }),
  defineIdeal("IS-02", {
    scenarios: [sc(["S01"], ["P"], "down"), sc(["S01"], ["P"], "up")],
    async run(ctx) {
      const names = await ip(ctx, (I) => I.visibleControls().map(I.nameOf));
      return countAtMost(names.length, controlBudgetLimit("P", ctx.fixtures), { names });
    },
  }),
  defineIdeal("IS-03", {
    aggregate: true,
    collect: {
      scenarios: [sc(["S01"], ["D", "P"], "down")],
      async run(ctx) {
        const names = await ip(ctx, (I) => I.visibleControls().filter((el) => !el.matches('a[href*="vworld"]')).map(I.nameOf));
        ctx.runMemo.set(`IS-03:${ctx.entry}:${ctx.viewport}:${ctx.theme}`, names);
      },
    },
    async run(ctx) {
      const rows = [];
      for (const viewport of ctx.args.viewports.filter((v) => v === "D" || v === "P")) {
        for (const theme of ctx.args.themes) {
          const legacy = ctx.runMemo.get(`IS-03:legacy:${viewport}:${theme}`);
          const vworld = ctx.runMemo.get(`IS-03:vworld:${viewport}:${theme}`);
          if (!legacy || !vworld) {
            rows.push({ viewport, theme, same: false, missing: `${!legacy ? "legacy" : ""}${!legacy && !vworld ? "+" : ""}${!vworld ? "vworld" : ""} S01-${viewport} not collected (entry not run or unavailable)` });
            continue;
          }
          rows.push({ viewport, theme, ...compareNameSets(legacy, vworld) });
        }
      }
      return verdict(rows.length > 0 && rows.every((row) => row.same), rows.length ? rows : "no S01-D/P frame in this run", "Legacy and VWorld S01 control names are the same set");
    },
  }),
  defineIdeal("IS-04", {
    scenarios: [sc(["S01", "S04", "S05", "S14"], ["D"])],
    async run(ctx) {
      const bar = await ip(ctx, (I) => { const b = I.hudBar(); if (!b) return null; return { via: b.via, height: Math.round(b.el.getBoundingClientRect().height * 10) / 10 }; });
      if (!bar) return hookMissing("[data-qa=campus-hud]", "HUD bar height <= 64");
      return verdict(bar.height <= 64, bar, "HUD bar height <= 64");
    },
  }),
  defineIdeal("IS-05", {
    scenarios: [sc(["S01", "S04"], ["P"])],
    async run(ctx) {
      const bar = await ip(ctx, (I) => { const b = I.hudBar(); if (!b) return null; return { via: b.via, height: Math.round(b.el.getBoundingClientRect().height * 10) / 10 }; });
      if (!bar) return hookMissing("[data-qa=campus-hud]", "HUD bar height <= 64");
      return verdict(bar.height <= 64, bar, "HUD bar height <= 64");
    },
  }),
  defineIdeal("IS-06", {
    scenarios: [sc(["S01", "S08"], ["D", "P"]), sc(["S04"], ["P"]), sc(["S13"], ["D"])],
    async run(ctx) {
      const m = await ip(ctx, (I) => {
        const time = I.sceneTime();
        if (time == null) return null;
        const nodes = I.textNodesWith(time).filter((n) => !n.parentElement.closest("[data-qa=time-slider] [aria-hidden=true]"));
        return { time, count: nodes.length, where: nodes.map((n) => n.parentElement.closest("[data-qa]")?.getAttribute("data-qa") ?? n.parentElement.tagName.toLowerCase()) };
      });
      if (!m) return hookMissing("[data-qa=time-slider] input[type=range]", "scene time shown exactly once");
      return countExactly(m.count, 1, m);
    },
  }),
  defineIdeal("IS-07", {
    scenarios: [sc(S01_S15, ["D", "P", "T"], "any")],
    async run(ctx) {
      const hits = await ip(ctx, (I) => {
        const re = /현재 \d{2}:\d{2}:\d{2}/;
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const out = new Set();
        for (let n; (n = w.nextNode());) {
          const el = n.parentElement;
          if (!el || !I.isVisible(el)) continue;
          const joined = (el.parentElement ?? el).textContent.replace(/\s+/g, " ");
          if (re.test(n.nodeValue) || re.test(el.textContent.replace(/\s+/g, " ")) || re.test(joined)) out.add(`${el.closest("[data-qa]")?.getAttribute("data-qa") ?? el.tagName.toLowerCase()}: ${(joined.match(re) ?? [""])[0]}`);
        }
        return [...out];
      });
      return countAtMost(hits.length, 0, { hits });
    },
  }),
  defineIdeal("IS-08", {
    scenarios: [sc(["S01"], ["D", "P"], "up")],
    async run(ctx) {
      const stamps = await ip(ctx, (I) => { const hud = document.querySelector("[data-qa=campus-hud]"); return hud ? [...hud.querySelectorAll("[data-qa=freshness-stamp]")].filter(I.isVisible).map((el) => el.textContent.trim().slice(0, 30)) : null; });
      if (!stamps) return hookMissing("[data-qa=campus-hud]", "0 visible freshness stamps in the HUD");
      return countAtMost(stamps.length, 0, { stamps });
    },
  }),
  defineIdeal("IS-09", {
    scenarios: [sc(["S01"], ["D", "P"], "down")],
    async run(ctx) {
      const m = await ip(ctx, (I) => {
        const hud = document.querySelector("[data-qa=campus-hud]");
        if (!hud) return null;
        const marks = [...hud.querySelectorAll("[data-qa=freshness-stamp], [data-qa=feed-status-chip]")].filter(I.isVisible).length;
        const buttons = [...hud.querySelectorAll("button")].filter(I.isVisible).map(I.nameOf).filter((n) => n.includes("새로고침") || n.includes("다시 시도"));
        return { marks, buttons, chip: Boolean(document.querySelector("[data-qa=feed-status-chip]")) };
      });
      const expected = "<= 1 HUD status mark ([data-qa=feed-status-chip]) and 0 새로고침/다시 시도 buttons in the HUD";
      if (!m) return hookMissing("[data-qa=campus-hud]", expected);
      if (!m.chip) return hookMissing("[data-qa=feed-status-chip]", expected, m);
      return verdict(m.marks <= 1 && m.buttons.length === 0, m, expected);
    },
  }),
  defineIdeal("IS-10", {
    scenarios: [sc(["S01", "S04", "S13"], ["D"], "down"), sc(["S13"], ["D"], "up")],
    async run(ctx) {
      const sources = await ip(ctx, (I) => [...document.querySelectorAll("[data-qa=alert], [data-qa=feed-alert]")].filter(I.isVisible)
        .map((el) => el.getAttribute("data-source") ?? el.getAttribute("data-feed") ?? null));
      const named = sources.filter(Boolean);
      const duplicates = duplicateValues(named);
      return verdict(duplicates.length === 0, { sources: named, unsourced: sources.length - named.length, duplicates }, "no data source repeated among visible alerts");
    },
  }),
  defineIdeal("IS-11", {
    scenarios: [sc(["S09"], ["D", "P"]), sc(["S13"], ["D"])],
    async run(ctx) {
      const texts = await ip(ctx, () => { const list = document.querySelector("[data-qa=dashboard-panel] [role=tablist]"); return list ? [...list.querySelectorAll("[role=tab]")].map((t) => t.textContent.trim()) : null; });
      if (!texts) return hookMissing("[data-qa=dashboard-panel] [role=tablist]", "tabs 건물, 현황, 에너지, 시뮬레이션");
      return verdict(tabsMatch(texts), { tabs: texts }, "tabs exactly 건물, 현황, 에너지, 시뮬레이션");
    },
  }),
  defineIdeal("IS-12", {
    scenarios: [sc(["S08", "S09"], ["P"]), sc(["S08"], ["D"])],
    async run(ctx) {
      // Line tops of the tab's text nodes (a Range over the whole tab also returns the selected-tab icon's box).
      const tabs = await ip(ctx, (I) => [...document.querySelectorAll("[role=tab]")].filter(I.isVisible).map((tab) => {
        const tops = [];
        const w = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) {
          if (!n.nodeValue.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) tops.push(r.top);
        }
        return { name: tab.textContent.trim(), tops };
      }));
      if (!tabs.length) return verdict(false, "no visible [role=tab]", "every tab label on one line");
      const lines = tabs.map((tab) => ({ name: tab.name, lines: lineCount(tab.tops) }));
      return verdict(lines.every((tab) => tab.lines === 1), { tabs: lines }, "every tab label on one line");
    },
  }),
  defineIdeal("IS-13", {
    scenarios: [sc(["S01"], ["D"])],
    async run(ctx) {
      const names = await ip(ctx, (I) => { const rail = document.querySelector("[data-qa=dashboard-rail]"); return rail ? [...rail.querySelectorAll("button")].filter(I.isVisible).map(I.nameOf) : null; });
      if (!names) return verdict(false, "no [data-qa=dashboard-rail] shown", "rail with 3 tab buttons, none named 패널 열기");
      return verdict(names.length === 3 && !names.includes("패널 열기"), { buttons: names }, "rail with 3 tab buttons, none named 패널 열기");
    },
    parts: [{
      scenarios: [sc(["S04"], ["D"])],
      mutates: true,
      async run(ctx) {
        const wasOpen = (await panelState(ctx.b)).open;
        if (wasOpen && await tapVisible(ctx, PANEL_CLOSE)) await sleepMs(900);
        const names = await ip(ctx, (I) => { const rail = document.querySelector("[data-qa=dashboard-rail]"); return rail ? [...rail.querySelectorAll("button")].filter(I.isVisible).map(I.nameOf) : null; });
        if (wasOpen) await openPanel(ctx);
        if (!names) return verdict(false, "no [data-qa=dashboard-rail] shown after closing the panel", "rail with 4 tab buttons, none named 패널 열기");
        return verdict(names.length === 4 && !names.includes("패널 열기"), { buttons: names, closedForMeasure: wasOpen }, "rail with 4 tab buttons, none named 패널 열기");
      },
    }],
  }),
  defineIdeal("IS-14", {
    scenarios: [sc(["S04", "S12"], ["D"]), sc(["S04"], ["P"])],
    async run(ctx) {
      const m = await ip(ctx, (I) => {
        const list = [...document.querySelectorAll("[data-qa=selection-inspector]")].filter(I.isVisible);
        const selected = document.querySelector("[data-qa=dashboard-panel] [role=tab][aria-selected=true]")?.textContent.trim() ?? null;
        return { inspectors: list.length, insidePanel: list.length === 1 && Boolean(list[0].closest("[data-qa=dashboard-panel]")), selectedTab: selected };
      });
      return verdict(m.inspectors === 1 && m.insidePanel && m.selectedTab === "건물", m, "exactly 1 visible inspector, inside the panel, on the 건물 tab");
    },
  }),
  defineIdeal("IS-15", {
    scenarios: [sc(["S13"], ["D"], "down"), sc(["S13"], ["D"], "up")],
    async run(ctx) {
      const m = await ip(ctx, (I) => {
        const panel = document.querySelector("[data-qa=dashboard-panel]");
        if (!panel) return null;
        const tabpanel = [...panel.querySelectorAll("[role=tabpanel]")].find(I.isVisible);
        const scope = tabpanel ?? panel.querySelector("[data-qa=panel-scroll]");
        const h3 = scope ? [...scope.querySelectorAll("h3")].find(I.isVisible) : null;
        return { scope: tabpanel ? "[role=tabpanel]" : scope ? "[data-qa=panel-scroll] (no [role=tabpanel] yet)" : null, h3: h3?.textContent.trim().slice(0, 30) ?? null,
          offset: h3 ? Math.round(h3.getBoundingClientRect().top - panel.getBoundingClientRect().top) : null };
      });
      if (!m) return hookMissing("[data-qa=dashboard-panel]", "first h3 <= 200 px below the panel top");
      if (m.offset == null) return verdict(false, { ...m, measured: "no visible h3 in the selected tab" }, "first h3 <= 200 px below the panel top");
      return verdict(m.offset <= 200, m, "first h3 <= 200 px below the panel top");
    },
  }),
  defineIdeal("IS-16", {
    scenarios: [sc(["S04", "S12"], ["D"]), sc(["S04"], ["P"])],
    async run(ctx) {
      const m = await ip(ctx, (I) => {
        const chip = document.querySelector("[data-qa=campus-label][data-state=selected]")
          ?? [...document.querySelectorAll("button[data-qa=campus-label][aria-pressed=true]")].find(I.isVisible);
        if (!chip) return null;
        const c = chip.getBoundingClientRect();
        const bar = I.hudBar();
        const targets = [["[data-qa=dashboard-panel]", document.querySelector("[data-qa=dashboard-panel]")], ["HUD bar", bar?.el],
          ["[data-qa=time-slider]", document.querySelector("[data-qa=time-slider]")], ["[data-qa=camera-controls]", document.querySelector("[data-qa=camera-controls]")]];
        return {
          chip: chip.textContent.trim().slice(0, 24),
          via: chip.matches("[data-state=selected]") ? "[data-state=selected]" : "[aria-pressed=true] (no data-state yet)",
          inView: c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight,
          coveredBy: targets.filter(([, el]) => el && I.isVisible(el) && I.overlaps(chip, el)).map(([name]) => name),
        };
      });
      if (!m) return verdict(false, "no selected building chip", "selected chip in view and not covered");
      return verdict(m.inView && m.coveredBy.length === 0, m, "selected chip in view and not covered by panel, HUD, time card or camera controls");
    },
  }),
  defineIdeal("IS-17", {
    scenarios: [sc(["S01", "S04", "S05", "S08", "S13"], ["D", "P", "T"])],
    async run(ctx) {
      const items = await ip(ctx, (I) => I.facts());
      const pairs = overlappingPairs(items);
      return countAtMost(pairs.length, 0, { controls: items.length, pairs: pairs.slice(0, 12) });
    },
  }),
  defineIdeal("IS-18", {
    scenarios: [sc(["*"], ["P", "T"], "any")],
    async run(ctx) {
      const items = await ip(ctx, (I) => I.facts());
      const small = undersized(items, 44).map((item) => `${item.name} ${Math.round(item.w)}x${Math.round(item.h)}`);
      return countAtMost(small.length, 0, { controls: items.length, under44: small.slice(0, 20) });
    },
  }),
  defineIdeal("IS-19", {
    scenarios: [sc(["*"], ["D"], "any")],
    async run(ctx) {
      const items = await ip(ctx, (I) => I.facts());
      const small = undersized(items, 24).map((item) => `${item.name} ${Math.round(item.w)}x${Math.round(item.h)}`);
      return countAtMost(small.length, 0, { controls: items.length, under24: small.slice(0, 20) });
    },
  }),
  defineIdeal("IS-20", {
    scenarios: [sc(["S01", "S04", "S05", "S08", "S13", "S09E"], ["D", "P"])],
    async run(ctx) {
      const names = await ip(ctx, (I) => [...document.querySelectorAll("button[data-variant=primary]")].filter(I.isVisible).map(I.nameOf));
      return countAtMost(names.length, 1, { primary: names });
    },
  }),
  defineIdeal("IS-21", {
    scenarios: [sc(["S01", "S08", "S09E", "S13"], ["D"])],
    async run(ctx) {
      // h1 and h2 are counted in the accessibility tree (screen-reader-only headings count): the rail keeps its h2 sr-only.
      const m = await ip(ctx, (I) => {
        const panel = document.querySelector("[data-qa=dashboard-panel]");
        const h2 = panel ? [...panel.querySelectorAll("h2")].filter(I.exposed).map((h) => h.textContent.trim()) : [];
        const tab = panel?.querySelector("[role=tab][aria-selected=true]")?.textContent.trim()
          ?? document.querySelector("[data-qa^=dashboard-tab-][aria-current=page]")?.getAttribute("aria-label") ?? null;
        return { h1: [...document.querySelectorAll("h1")].filter(I.exposed).length, h2, selectedTab: tab };
      });
      return verdict(m.h1 === 1 && m.h2.length === 1 && m.h2[0] === m.selectedTab, m, "1 h1; 1 panel h2 whose text equals the selected tab name");
    },
  }),
  defineIdeal("IS-22", {
    ...actingOnly,
    parts: [{
      scenarios: [sc(["S01"], ["D", "P"])],
      mutates: true,
      async run(ctx) {
        const inputs = () => ip(ctx, (I) => ({
          date: [...document.querySelectorAll("input[type=date]")].filter(I.isVisible).length,
          time: [...document.querySelectorAll("input[type=time]")].filter(I.isVisible).length,
        }));
        const before = await inputs();
        const marked = await ip(ctx, (I) => {
          const value = [...document.querySelectorAll("[data-qa=time-slider] [data-qa=time-slider-value]")].find(I.isVisible);
          const button = value?.closest("button");
          if (!button) return false;
          button.setAttribute("data-qa-is22", "value-button");
          return true;
        });
        const expected = "0 date/time inputs on the first screen; 1 of each after pressing the time card's value button";
        if (!marked) return verdict(false, { before, measured: "hook missing", hook: "time card value button ([data-qa=time-slider-value] inside a button)" }, expected);
        await ctx.b.tap('[data-qa-is22="value-button"]');
        await sleepMs(700);
        const after = await inputs();
        await ctx.b.run(() => { document.querySelector("[data-qa-is22]")?.removeAttribute("data-qa-is22"); return true; });
        if (!(await tapVisible(ctx, '[aria-label="시간 조작 접기"]'))) await ctx.b.key("Escape");
        await sleepMs(500);
        return verdict(before.date + before.time === 0 && after.date === 1 && after.time === 1, { before, after }, expected);
      },
    }],
  }),
  defineIdeal("IS-23", {
    scenarios: [sc(["S09E", "S12E"], ["D"])],
    async run(ctx) {
      const m = await ip(ctx, (I, a) => {
        const panel = document.querySelector("[data-qa=dashboard-panel]");
        if (!panel) return null;
        const sceneDate = document.querySelector("[data-qa=time-slider] input[type=date]")?.value || a.fallback;
        const text = panel.innerText;
        return { dateInputs: [...panel.querySelectorAll("input[type=date]")].filter(I.isVisible).length, sceneDate, showsDate: text.includes(sceneDate), showsLabel: text.includes("장면 날짜") };
      }, { fallback: kstDate(ctx.args?.clock ?? "") });
      if (!m) return hookMissing("[data-qa=dashboard-panel]", "0 date inputs; panel text has the scene date and 장면 날짜");
      return verdict(m.dateInputs === 0 && m.showsDate && m.showsLabel, m, "0 date inputs in the panel; panel text has the scene date (YYYY-MM-DD) and 장면 날짜");
    },
  }),
  defineIdeal("IS-24", {
    scenarios: [sc(["S09E"], ["D"])],
    async run(ctx) {
      const m = await ip(ctx, (I) => {
        const panel = document.querySelector("[data-qa=dashboard-panel]");
        if (!panel) return null;
        const tables = [...panel.querySelectorAll("table")].filter(I.isVisible)
          .filter((t) => `${t.querySelector("caption")?.textContent ?? ""} ${t.getAttribute("aria-label") ?? ""}`.includes("캠퍼스 비교"));
        return {
          comparisonTables: tables.length,
          orderedLists: [...panel.querySelectorAll("ol")].filter(I.isVisible).length,
          mapSolarChips: I.textNodesWith("태양광 상태").filter((n) => !n.parentElement.closest("[data-qa=dashboard-panel]")).length,
        };
      });
      if (!m) return hookMissing("[data-qa=dashboard-panel]", "1 캠퍼스 비교 table, 0 ranking lists, 0 map 태양광 상태 chips");
      return verdict(m.comparisonTables === 1 && m.orderedLists === 0 && m.mapSolarChips === 0, m, "1 캠퍼스 비교 table, 0 ranking lists (ol), 0 map 태양광 상태 chips");
    },
  }),
  defineIdeal("IS-25", {
    scenarios: [sc(["S04", "S08"], ["D", "T"], "up")],
    run: (ctx) => estimateLabels(ctx),
    parts: [{
      // S09E with the fixtures up: the energy tab is re-entered after switching the fixtures on, then put back.
      scenarios: [sc(["S09E"], ["D", "T"])],
      mutates: true,
      async run(ctx) {
        await ctx.setFixtures({ mode: "up" });
        try {
          await openTab(ctx, "home");
          await sleepMs(600);
          await openTab(ctx, "energy");
          await sleepMs(3500);
          return await estimateLabels(ctx, { fixturesUp: true });
        } finally {
          await ctx.restoreFixtures();
        }
      },
    }],
  }),
  defineIdeal("IS-26", {
    ...actingOnly,
    parts: [{
      scenarios: [sc(["S09"], ["D"])],
      mutates: true,
      async run(ctx) {
        const expected = "<= 8 visible controls in the simulation tab panel with 고급 closed";
        const found = await findTrafficPanel(ctx);
        try {
          if (!found.found) return hookMissing("[data-qa=traffic-simulation-panel]", expected, { triedTabs: found.tried });
          await ip(ctx, (I) => { const adv = [...document.querySelectorAll("[data-qa=dashboard-panel] button, [data-qa=dashboard-panel] summary")].filter(I.isVisible).find((el) => el.textContent.trim().startsWith("고급") && el.getAttribute("aria-expanded") === "true"); adv?.click(); return true; });
          await sleepMs(400);
          const names = await ip(ctx, (I) => {
            const host = document.querySelector("[data-qa=traffic-simulation-panel]");
            const scope = host.closest("[role=tabpanel]") ?? document.querySelector("[data-qa=panel-scroll]") ?? host;
            return I.visibleControls(scope).map(I.nameOf);
          });
          return countAtMost(names.length, 8, { tab: found.value, controls: names });
        } finally {
          await restoreTab(ctx, found.start);
        }
      },
    }],
  }),
  defineIdeal("IS-27", {
    scenarios: [sc(["*"], ["D", "P", "T"], "any")],
    async run(ctx) {
      const hits = await ip(ctx, (I) => ["커버리지", "경로 편집", "시뮬레이션 타임라인", "안전 모니터링"].map((word) => [word, I.textNodesWith(word).length]).filter(([, n]) => n > 0));
      return countAtMost(hits.length, 0, { hits, debugQuery: /debug/.test(ctx.args?.urlSuffix ?? "") });
    },
    parts: [{
      // Contract C5: the traffic simulation panel, wherever it lives, shows no developer tools.
      scenarios: [sc(["S09"], ["D", "P"])],
      mutates: true,
      async run(ctx) {
        const found = await findTrafficPanel(ctx);
        try {
          if (!found.found) return hookMissing("[data-qa=traffic-simulation-panel]", "0 developer-tool texts in the traffic simulation panel", { triedTabs: found.tried });
          const hits = await ip(ctx, (I) => ["커버리지", "경로 편집", "시뮬레이션 타임라인", "안전 모니터링"].map((word) => [word, I.textNodesWith(word).length]).filter(([, n]) => n > 0));
          return countAtMost(hits.length, 0, { tab: found.value, hits });
        } finally {
          await restoreTab(ctx, found.start);
        }
      },
    }],
  }),
  defineIdeal("IS-28", {
    ...actingOnly,
    parts: [{
      scenarios: [sc(["S01", "S08", "S09E", "S13"], ["D", "P"])],
      mutates: true,
      async run(ctx) {
        const expected = "1 visible [data-qa=more-menu]; its menu items include 설정, 발표 모드, 링크 복사";
        const menus = await countVisible(ctx, "[data-qa=more-menu]");
        if (menus === 0) return hookMissing("[data-qa=more-menu]", expected);
        if (menus > 1) return verdict(false, { menus }, expected);
        await ctx.b.tap("[data-qa=more-menu]");
        await sleepMs(500);
        const items = await ip(ctx, (I) => [...document.querySelectorAll("[role=menuitem]")].filter(I.isVisible).map((el) => el.textContent.trim()));
        await ctx.b.key("Escape");
        await sleepMs(400);
        const want = ["설정", "발표 모드", "링크 복사"];
        return verdict(want.every((name) => items.some((item) => item.includes(name))), { menus, items }, expected);
      },
    }],
  }),
  defineIdeal("IS-29", {
    scenarios: [sc(["S18"], ["D", "P"])],
    async run(ctx) {
      const m = await ip(ctx, (I) => {
        const inside = (sel) => { const root = document.querySelector(sel); return root ? I.visibleControls(root).length : 0; };
        return {
          names: I.visibleControls().map(I.nameOf),
          touring: document.querySelector("[data-qa=camera-tour-toggle]")?.getAttribute("aria-pressed") === "true",
          panelControls: inside("[data-qa=dashboard-panel]"),
          timeControls: inside("[data-qa=time-slider]"),
        };
      });
      const { extras, missing } = presentationExtras(m.names, { touring: m.touring });
      return verdict(extras.length === 0 && missing.length === 0 && m.panelControls === 0 && m.timeControls === 0, { ...m, extras, missing },
        "only 발표 모드 끝내기 and 투어 시작 (tour dots while touring); 0 panel and time-card controls");
    },
  }),
  defineIdeal("IS-30", {
    scenarios: [sc(["S05", "S14"], ["P"])],
    async run(ctx) {
      const m = await ip(ctx, (I) => {
        const pane = document.querySelector("[data-qa=dashboard-panel][data-pane=d4]");
        const root = pane ?? document;
        const presets = [...root.querySelectorAll("button")].filter(I.isVisible).map((b) => b.textContent.trim()).filter((t) => ["정문", "도서관", "생명대", "본부"].includes(t));
        const crumbs = [...document.querySelectorAll("[data-qa=breadcrumb]")].filter(I.isVisible);
        let lastCurrent = null;
        if (crumbs.length === 1) {
          const items = crumbs[0].querySelectorAll("li");
          const last = items.length ? items[items.length - 1] : crumbs[0].lastElementChild;
          lastCurrent = Boolean(last && (last.matches("[aria-current=page]") || last.querySelector("[aria-current=page]")));
        }
        return { scope: pane ? "D4 pane" : "document (no [data-pane=d4])", presetButtons: presets, breadcrumbs: crumbs.length, lastStepCurrent: lastCurrent };
      });
      return verdict(m.presetButtons.length === 0 && m.breadcrumbs === 1 && m.lastStepCurrent === true, m,
        "0 campus preset buttons in the D4 window; 1 breadcrumb whose last step has aria-current=page");
    },
  }),
  defineIdeal("IS-31", {
    scenarios: [sc(["S04"], ["D"])],
    async run(ctx) {
      const shots = ctx.memo.get(`${ctx.stateLabel}:shots`);
      // The verdict reads the camera itself: VWorld's post-selection orbit (4 deg/s) moves the view about 8 deg in these
      // 2 s, which a 9x8 dHash of the map scored as 0 bits on origin/dev. The dHash stays in `measured` for reference.
      const expected = `camera heading change <= ${CAMERA_STILL_MAX_DEG} deg and position change <= ${CAMERA_STILL_MAX_M} m between 1500 and 3500 ms after the chip tap`;
      if (!shots?.[1500] || !shots?.[3500]) return verdict(false, "no S04 screenshots at 1500/3500 ms", expected);
      const region = await mapRegion(ctx);
      const dHashDistance = region ? regionDistance(decode(shots[1500]), decode(shots[3500]), region, ctx.scale) : null;
      const from = shots.pose?.[1500];
      const to = shots.pose?.[3500];
      if (!from || !to) {
        return hookMissing(ctx.entry === "vworld" ? "window.ws3d.viewer.camera" : "OrbitControls (controlsRef) via React props", expected, { dHashDistance, actualMs: shots.actualMs });
      }
      const motion = cameraMotion(from, to);
      return verdict(motion.still, {
        headingDeltaDeg: motion.headingDeltaDeg, positionDeltaM: motion.positionDeltaM, source: from.source,
        heading: { 1500: Math.round(from.heading * 1000) / 1000, 3500: Math.round(to.heading * 1000) / 1000 },
        position: { 1500: from.position.map((v) => Math.round(v * 10) / 10), 3500: to.position.map((v) => Math.round(v * 10) / 10) },
        dHashDistance, actualMs: shots.actualMs,
      }, expected);
    },
    // S04 taps 도서관 right after the 도서관 preset, so the building is already central and VWorld's focusLabelPosition
    // skips focus() (no flight, no orbit). This part taps the visible chip farthest from the map centre, which does
    // focus the camera, reads the pose at 1500 and 3500 ms, then stops any orbit and replays S04's preset + chip.
    // VWorld is judged twice: the rendered Cesium camera, and the pose the app commands through map.lookat.moveTo
    // (cameraFocus.mjs orbit). Under headless SwiftShader the SDK does not apply the per-frame moveTo calls, so on
    // origin/dev the rendered camera stays put while the commanded heading climbs 4 deg/s; either moving is a FAIL.
    parts: [{
      scenarios: [sc(["S04"], ["D"])],
      mutates: true,
      async run(ctx) {
        const expected = `off-centre chip tap: camera heading change <= ${CAMERA_STILL_MAX_DEG} deg and position change <= ${CAMERA_STILL_MAX_M} m between 1500 and 3500 ms (rendered and commanded)`;
        const { region, chip } = await offCentreChip(ctx);
        if (!region) return hookMissing("canvas", expected);
        if (!chip) return verdict(false, { measured: "no off-centre chip in the map area", region }, expected);
        let result;
        try {
          if (!(await recordMoveTo(ctx)) && ctx.entry === "vworld") return hookMissing("window.__scnuVWorldMapInstance.lookat.moveTo", expected, { chip: chip.name });
          await ctx.b.view.click(chip.x, chip.y);
          const t0 = Date.now();
          await sleepMs(1500 - (Date.now() - t0));
          const from = await cameraPoses(ctx);
          const fromMs = Date.now() - t0;
          await sleepMs(3500 - (Date.now() - t0));
          const to = await cameraPoses(ctx);
          const toMs = Date.now() - t0;
          if (!from.rendered || !to.rendered) return hookMissing(cameraHook(ctx), expected, { chip: chip.name });
          result = cameraReport(chip, from, to, [1500, 3500], { 1500: fromMs, 3500: toMs }, expected);
        } finally {
          const stopped = await stopOrbitAndReplayS04(ctx);
          if (result?.measured && typeof result.measured === "object") result.measured.orbitStoppedByCleanup = stopped;
        }
        return result;
      },
    }],
  }),
  defineIdeal("IS-32", {
    ...actingOnly,
    // The part focuses the camera on the off-centre chip (as IS-31 does), drags the map away and waits until the camera
    // is at rest (pose within the still limits for CAMERA_REST_HOLD_MS, CAMERA_REST_TIMEOUT_MS = FAIL). Only then is the
    // baseline taken, so post-drag inertia is not read as a panel effect. Opening and closing the panel must move neither
    // the map (dHash) nor the commanded VWorld camera (no map.lookat.moveTo call; headless SwiftShader does not apply
    // them, so origin/dev's resize re-centre in cameraFocus.mjs shows only as commanded calls).
    parts: [{
      scenarios: [sc(["S04"], ["D"])],
      mutates: true,
      async run(ctx) {
        const expected = `camera at rest after the drag, then map dHash distance before opening and after closing the panel <= ${STILL_MAX_BITS} bits and no commanded camera move`;
        // 100 ms마다 자세를 읽어 정지할 때까지 기다린다. 반환: { restAt (정지가 시작된 ms, 못 멈추면 null), steps (읽기 사이 이동량) }.
        const waitForRest = async () => {
          const started = Date.now();
          const samples = [];
          while (Date.now() - started < CAMERA_REST_TIMEOUT_MS) {
            samples.push({ t: Date.now() - started, pose: await ctx.b.run(readCameraPose) });
            const restAt = cameraRestAt(samples);
            if (restAt !== null) break;
            await sleepMs(100);
          }
          const steps = samples.slice(1).map((s, i) => ({ t: s.t, ...cameraMotion(samples[i].pose, s.pose) }))
            .map(({ t, headingDeltaDeg, positionDeltaM }) => ({ t, headingDeltaDeg, positionDeltaM }));
          return { restAt: cameraRestAt(samples), steps };
        };
        let result;
        const saved = await saveCamera(ctx);
        try {
          // VWorld: 칩 선택이 카메라를 그 건물에 맞추게 한다(origin/dev는 여기서 재정렬 대상이 생긴다). Legacy 칩 선택은
          // 카메라를 움직이지 않고, 근접 자동 진입(D4 실내 패인)이 HUD 배치를 바꾸므로 S04 선택 그대로 시작한다.
          let chip = null;
          if (ctx.entry === "vworld") {
            const focus = await offCentreChip(ctx);
            if (!focus.region) return hookMissing("canvas", expected);
            if (!focus.chip) return verdict(false, { measured: "no off-centre chip in the map area", region: focus.region }, expected);
            chip = focus.chip;
            await ctx.b.view.click(chip.x, chip.y);
            if ((await waitForRest()).restAt === null) return verdict(false, { measured: `camera not at rest within ${CAMERA_REST_TIMEOUT_MS} ms of the chip tap`, chip: chip.name }, expected);
          }
          const { x, y } = ctx.map;
          await ctx.b.mouse("mouseMoved", x, y, 0);
          await ctx.b.mouse("mousePressed", x, y, 1);
          for (let i = 1; i <= 10; i += 1) {
            await ctx.b.mouse("mouseMoved", x - i * 16, y, 1);
            await sleepMs(40);
          }
          await ctx.b.mouse("mouseReleased", x - 160, y, 0);
          const settle = await waitForRest();
          const settleMs = settle.restAt;
          if (settleMs === null) return verdict(false, { measured: `camera not at rest within ${CAMERA_REST_TIMEOUT_MS} ms of the drag`, chip: chip?.name ?? null, inertia: settle.steps }, expected);
          await ctx.b.cameraSettle();
          const region = await mapRegion(ctx);
          if (!region) return hookMissing("canvas", expected);
          await recordMoveTo(ctx);
          const poseBefore = await ctx.b.run(readCameraPose);
          const before = decode(await ctx.b.screenshot());
          const opened = await openPanel(ctx);
          await sleepMs(1000);
          const closed = await tapVisible(ctx, PANEL_CLOSE);
          await sleepMs(1500);
          await ctx.b.cameraSettle();
          const after = decode(await ctx.b.screenshot());
          const poseAfter = await ctx.b.run(readCameraPose);
          const { calls } = await cameraPoses(ctx);
          // VWorld가 패널 여닫기 동안 지시한 마지막 방위(origin/dev는 마지막 건물을 방위 0으로 다시 겨눈다).
          const commandedHeading = await ctx.b.run(() => window.__qaMoveTo?.at(-1)?.arg?.direction?.heading ?? null);
          const rendered = cameraMotion(poseBefore, poseAfter);
          const turn = Number.isFinite(commandedHeading) && Number.isFinite(poseBefore?.heading) ? Math.abs(commandedHeading - poseBefore.heading) % 360 : null;
          const distance = regionDistance(before, after, region, ctx.scale);
          result = verdict(distance <= STILL_MAX_BITS && calls === 0 && closed, {
            distance, moveToCalls: calls,
            poseDelta: { rendered: { headingDeltaDeg: rendered.headingDeltaDeg, positionDeltaM: rendered.positionDeltaM },
              commanded: turn === null ? null : { heading: Math.round(commandedHeading * 1000) / 1000, headingDeltaDeg: Math.round(Math.min(turn, 360 - turn) * 1000) / 1000 } },
            settleMs, inertia: settle.steps, chip: chip?.name ?? null, region, opened, closed,
          }, expected);
        } finally {
          if (ctx.entry === "vworld") await stopOrbitAndReplayS04(ctx);
          else await restoreCamera(ctx, saved);
        }
        return result;
      },
    }],
  }),
  defineIdeal("IS-33", {
    scenarios: [sc(["S01"], ["D", "P", "T"]), sc(["S09"], ["D", "T"])],
    async run(ctx) {
      const candidates = await ip(ctx, () => {
        const out = [];
        for (const el of document.querySelectorAll("*")) {
          const s = getComputedStyle(el);
          if (!s.transitionDuration.split(",").some((d) => parseFloat(d) > 0.01)) continue;
          out.push({ who: el.getAttribute("data-qa") ?? `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 2).join(".")}`, property: s.transitionProperty, duration: s.transitionDuration });
        }
        return out;
      });
      const hits = candidates.filter((c) => isLayoutTransition(c.property, c.duration));
      return countAtMost(hits.length, 0, { elements: hits.length, sample: hits.slice(0, 8) });
    },
  }),
  defineIdeal("IS-34", {
    ...actingOnly,
    parts: [{
      scenarios: [sc(["S01", "S09"], ["D"])],
      mutates: true,
      async run(ctx) {
        const expected = "HUD right <= panel left at every 50 ms sample in 0..400 ms after the click";
        const offsets = [0, 50, 100, 150, 200, 250, 300, 350, 400];
        let selector;
        if (ctx.state === "S01") {
          const value = pickTabValue("home", (await panelState(ctx.b)).values);
          if (!value) return hookMissing("[data-qa=dashboard-rail] 현황 tab", expected);
          selector = `[data-qa=dashboard-rail] ${tabSelector(value)}`;
        } else selector = PANEL_CLOSE;
        const m = await actAndSample(ctx, { selector, kind: "hudPanel", offsets });
        await sleepMs(700);
        if (ctx.state === "S01") { if (await tapVisible(ctx, PANEL_CLOSE)) await sleepMs(800); } else await openPanel(ctx);
        if (m.missing) return verdict(false, { measured: "control not found", selector: m.missing }, expected);
        const violations = hudPanelViolations(m.samples);
        return verdict(violations.length === 0, { action: ctx.state === "S01" ? "rail 현황" : "패널 닫기", handlerMs: m.handlerMs, violations, samples: m.samples }, expected);
      },
    }],
  }),
  defineIdeal("IS-35", {
    ...actingOnly,
    parts: [{
      scenarios: [sc(["S09"], ["D"])],
      mutates: true,
      async run(ctx) {
        const expected = "100 ms after 패널 닫기: the panel tablist is visible and the rail is not";
        const m = await actAndSample(ctx, { selector: PANEL_CLOSE, kind: "closeContent", offsets: [0, 50, 100, 150, 200] });
        await sleepMs(700);
        await openPanel(ctx);
        if (m.missing) return verdict(false, { measured: "control not found", selector: m.missing }, expected);
        const at = nearestSample(m.samples, 100);
        return verdict(at.tablistVisible && !at.railVisible, { at100: at, handlerMs: m.handlerMs, samples: m.samples }, expected);
      },
    }],
  }),
  defineIdeal("IS-36", {
    ...actingOnly,
    parts: [{
      scenarios: [sc(["S01"], ["D", "P"])],
      mutates: true,
      async run(ctx) {
        const expected = "0 [data-updated=true] and the time card border unchanged at 500 and 1500 ms after 재생";
        const minutes = await sliderMinutes(ctx);
        const expanded = ctx.viewport === "P" && await tapVisible(ctx, "[data-qa=time-chip]");
        if (expanded) await sleepMs(600);
        const m = await actAndSample(ctx, { selector: PLAY, kind: "updated", offsets: [500, 1500] });
        if (await tapVisible(ctx, PAUSE)) await sleepMs(300);
        if (minutes != null) await ctx.b.setTimeMinutes(minutes);
        if (expanded) await tapVisible(ctx, '[aria-label="시간 조작 접기"]');
        await sleepMs(400);
        if (m.missing) return verdict(false, { measured: "control not found", selector: m.missing }, expected);
        const ok = m.samples.every((s) => s.updated === 0 && s.border === m.before.border);
        return verdict(ok, { before: m.before, handlerMs: m.handlerMs, samples: m.samples }, expected);
      },
    }],
  }),
  defineIdeal("IS-37", {
    ...actingOnly,
    parts: [{
      scenarios: [sc(["S01"], ["D"])],
      mutates: true,
      async run(ctx) {
        const expected = "label layer opacity 1 at 50 and 150 ms after 확대 and after one ArrowLeft";
        if (!(await ctx.b.run(() => Boolean(document.querySelector("[data-qa=campus-label-layer]"))))) return hookMissing("[data-qa=campus-label-layer]", expected);
        const saved = await saveCamera(ctx);
        try {
          await ctx.b.cameraSettle();
          const zoom = await actAndSample(ctx, { selector: '[data-qa=camera-controls] button[aria-label="확대"]', kind: "labelOpacity", offsets: [50, 150] });
          await ctx.b.cameraSettle();
          const arrow = await actAndSample(ctx, { key: "ArrowLeft", kind: "labelOpacity", offsets: [50, 150] });
          await ctx.b.cameraSettle();
          if (zoom.missing) return verdict(false, { measured: "control not found", selector: zoom.missing }, expected);
          const opaque = (s) => s.opacity != null && s.opacity >= 0.999;
          return verdict(zoom.samples.every(opaque) && arrow.samples.every(opaque), { zoom: zoom.samples, zoomHandlerMs: zoom.handlerMs, arrowLeft: arrow.samples }, expected);
        } finally {
          await restoreCamera(ctx, saved);
        }
      },
    }],
  }),
  defineIdeal("IS-38", {
    ...actingOnly,
    parts: [{
      scenarios: [sc(["S04"], ["D", "P"])],
      mutates: true,
      async run(ctx) {
        const media = ctx.b.media ?? { reducedMotion: false, colorScheme: "dark" };
        await ctx.b.setMedia({ ...media, reducedMotion: true });
        try {
          await sleepMs(300);
          if (ctx.viewport === "P") {
            const expected = "sheet opacity > 0.05 at every 16 ms sample while the detent changes (prefers-reduced-motion: reduce)";
            const focused = await ctx.b.run(() => { const h = document.querySelector("[data-qa=sheet-handle]"); h?.focus(); return Boolean(h); });
            if (!focused) return hookMissing("[data-qa=sheet-handle]", expected);
            const m = await actAndSample(ctx, { key: "ArrowUp", kind: "sheetOpacity", every: 16, duration: 700 });
            await sleepMs(300);
            await ctx.b.run(() => { const h = document.querySelector("[data-qa=sheet-handle]"); h?.focus(); h?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); return true; });
            await sleepMs(800);
            const low = minimum(m.samples.map((s) => s.opacity));
            return verdict(low != null && low > 0.05, { minOpacity: low, samples: m.samples.length, handlerMs: m.handlerMs }, expected);
          }
          // D: the reduced-motion selection flight. The chip must actually focus the camera (an off-centre chip from the 전체
          // preset; S04's central 도서관 chip never calls focus()), and the pose ~100 ms after the tap must already be the
          // pose at 1500 ms: no animated flight and no orbit, on the rendered camera or in the commanded moveTo stream.
          const expected = `off-centre chip tap under prefers-reduced-motion: reduce: pose at ~100 ms equals the pose at 1500 ms within ${CAMERA_STILL_MAX_DEG} deg / ${CAMERA_STILL_MAX_M} m (rendered and commanded)`;
          await ctx.b.key("Escape");
          await sleepMs(500);
          const { region, chip } = await offCentreChip(ctx);
          if (!region) return hookMissing("canvas", expected);
          if (!chip) return verdict(false, { measured: "no off-centre chip in the map area", region }, expected);
          let result;
          try {
            if (!(await recordMoveTo(ctx)) && ctx.entry === "vworld") return hookMissing("window.__scnuVWorldMapInstance.lookat.moveTo", expected, { chip: chip.name });
            await ctx.b.view.click(chip.x, chip.y);
            const t0 = Date.now();
            await sleepMs(100 - (Date.now() - t0));
            const early = await cameraPoses(ctx);
            const earlyMs = Date.now() - t0;
            await sleepMs(1500 - (Date.now() - t0));
            const late = await cameraPoses(ctx);
            const lateMs = Date.now() - t0;
            if (!early.rendered || !late.rendered) return hookMissing(cameraHook(ctx), expected, { chip: chip.name });
            result = cameraReport(chip, early, late, [100, 1500], { 100: earlyMs, 1500: lateMs }, expected);
          } finally {
            const stopped = await stopOrbitAndReplayS04(ctx);
            if (result?.measured && typeof result.measured === "object") result.measured.orbitStoppedByCleanup = stopped;
          }
          return result;
        } finally {
          await ctx.b.setMedia(media);
          await sleepMs(300);
        }
      },
    }],
  }),
  defineIdeal("IS-39", {
    ...actingOnly,
    parts: [{
      // Runs its own delayed request (fixtures up, every answer 3000 ms late), so it does not need a --delay-ms run.
      scenarios: [sc(["S04", "S09E"], ["D"], "any")],
      mutates: true,
      async run(ctx) {
        const expected = "with a 3000 ms delay: 0 spinners at 500 ms, <= 1 per card at 1500 ms, never a spinner and a skeleton in the same card";
        const count = async () => { const r = await readFixtureRequests(ctx.baseUrl); return (Array.isArray(r) ? r : r?.requests ?? []).length; };
        const since = Date.now();
        await ctx.setFixtures({ mode: "up", delayMs: 3000 });
        try {
          const requestsBefore = await count();
          let trigger;
          if (ctx.state === "S04") {
            await ctx.b.key("Escape");
            await sleepMs(800);
            trigger = (await ctx.b.tap(CHIP, "도서관", { timeoutMs: 4000 })).action;
          } else {
            await openTab(ctx, "home");
            await sleepMs(500);
            trigger = (await openTab(ctx, "energy")).action;
          }
          const m = await actAndSample(ctx, { kind: "loading", offsets: [500, 1500] });
          const requests = (await count()) - requestsBefore;
          const problems = loadingProblems(m.samples);
          if (requests <= 0) problems.push("no request was made after the trigger");
          return verdict(problems.length === 0, { trigger, requests, problems, samples: m.samples }, expected);
        } finally {
          await waitFixturesAnswered(ctx.baseUrl, since, 9000).catch(() => null);
          await ctx.restoreFixtures();
          await sleepMs(500);
        }
      },
    }],
  }),
  defineIdeal("IS-40", {
    ...actingOnly,
    parts: [{
      scenarios: [sc(["S01"], ["D"])],
      mutates: true,
      async run(ctx) {
        const expected = "after D4 실내 보기 the slider stays still for 1 s and the tour toggle has aria-pressed=false";
        const minutes = await sliderMinutes(ctx);
        const saved = await saveCamera(ctx);
        try {
          const played = await tapVisible(ctx, PLAY);
          const toured = await tapVisible(ctx, "[data-qa=camera-tour-toggle]");
          await sleepMs(800);
          const via = await enterD4(ctx);
          const open = await waitD4Open(ctx);
          if (!open) return verdict(false, { played, toured, via, measured: "D4 window did not open" }, expected);
          const before = await sliderMinutes(ctx);
          const tourPressed = await ctx.b.run(() => document.querySelector("[data-qa=camera-tour-toggle]")?.getAttribute("aria-pressed") ?? null);
          await sleepMs(1000);
          const after = await sliderMinutes(ctx);
          return verdict(played && toured && stoppedAfterD4({ before, after, tourPressed }), { played, toured, via, before, after, tourPressed }, expected);
        } finally {
          if (await tapVisible(ctx, BACK_TO_CAMPUS)) await sleepMs(2500);
          if (await tapVisible(ctx, PAUSE)) await sleepMs(300);
          const touring = await ctx.b.run(() => document.querySelector("[data-qa=camera-tour-toggle]")?.getAttribute("aria-pressed") === "true");
          if (touring) await tapVisible(ctx, "[data-qa=camera-tour-toggle]");
          if (minutes != null) await ctx.b.setTimeMinutes(minutes);
          await restoreCamera(ctx, saved);
          await sleepMs(500);
        }
      },
    }],
  }),
];

// IS-25: every visible estimate value carries 추정 itself or in its nearest section/[role=group] heading.
async function estimateLabels(ctx, extra = {}) {
  const values = await ip(ctx, (I) => [...document.querySelectorAll("[data-qa=estimate-value]")].filter(I.isVisible).map((el) => {
    const group = el.parentElement?.closest("section, [role=group]");
    const head = group?.querySelector("h1, h2, h3, h4, h5, h6, header, legend, [role=heading]");
    return { text: el.textContent.trim().slice(0, 30), labelled: el.textContent.includes("추정") || Boolean(head && head.textContent.includes("추정")) };
  }));
  const unlabelled = values.filter((v) => !v.labelled).map((v) => v.text);
  return verdict(unlabelled.length === 0, { estimateValues: values.length, unlabelled, ...extra }, "every visible [data-qa=estimate-value] has 추정 on itself or its section/group heading");
}

export const IDEAL_CHECKS = new Map(IDEAL_CHECKS_LIST.map((check) => [check.id, check]));

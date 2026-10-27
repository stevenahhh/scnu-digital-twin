// Shared helpers for the audit checks. Every check returns { pass, measured, expected }; a missing
// product hook is a FAIL with the hook named in `measured`, never a skip.
import { contrastAgainst, pixelDiff, parseCssColor, hueOf, hueDistance, luminanceStep, meanLuminance } from "../lib/probe.mjs";
import { ROWS } from "./rows.mjs";

export { contrastAgainst, pixelDiff, parseCssColor, hueOf, hueDistance, luminanceStep, meanLuminance };

export const result = (pass, measured, expected) => ({ pass: Boolean(pass), measured, expected });
export const missingHook = (selector, expected, extra = {}) => ({ pass: false, measured: { missingHook: selector, ...extra }, expected });

// Builds a check object carrying its literal audit row as `doc`.
export function defineCheck(id, spec) {
  const row = ROWS[id];
  if (!row) throw new Error(`no audit row for ${id}`);
  return Object.freeze({ id, doc: `${row.verify} PASS: ${row.pass}`, expectedText: row.pass, ...spec });
}

export async function exists(ctx, selector) {
  return ctx.inPage((qa, a) => Boolean(qa.one(a.sel)), { sel: selector });
}

export async function rectOf(ctx, selector) {
  return ctx.inPage((qa, a) => qa.r(qa.one(a.sel)), { sel: selector });
}

export async function chips(ctx) {
  return ctx.inPage((qa) => qa.chips().map((el) => {
    const s = getComputedStyle(el);
    return {
      text: qa.txt(el),
      // The building name without the code badge (qa.chipName); `text` still includes the code ("C1 도서관").
      name: qa.chipName(el),
      badge: Boolean(el.querySelector("[data-qa$=badge]")),
      rect: qa.r(el),
      px: qa.eff(el),
      weight: Number(s.fontWeight),
      pressed: el.getAttribute("aria-pressed"),
      tier: el.getAttribute("data-tier") ?? el.closest("[data-tier]")?.getAttribute("data-tier") ?? null,
      whiteSpace: s.whiteSpace,
      leader: Boolean(qa.leaderOf(el)),
      children: [...el.children].map((child) => child.getAttribute("data-qa") ?? child.tagName.toLowerCase()),
    };
  }));
}

export async function hudRects(ctx) {
  return ctx.inPage((qa) => ["[data-qa=camera-preset-bar]", "[data-qa=time-slider]", "[data-qa=campus-hud] > *"]
    .flatMap((sel) => qa.all(sel).filter(qa.visible).map((el) => ({ sel, rect: qa.r(el) }))));
}

export async function panelInfo(ctx) {
  return ctx.inPage((qa) => {
    const panel = qa.one("[data-qa=dashboard-panel]");
    if (!panel) return null;
    const rect = qa.r(panel);
    const visibleWidth = Math.max(0, Math.min(rect.r, innerWidth) - Math.max(rect.l, 0));
    const visibleHeight = Math.max(0, Math.min(rect.b, innerHeight) - Math.max(rect.t, 0));
    const toggle = qa.one('[aria-label="패널 닫기"],[aria-label="패널 열기"]');
    return { rect, visibleWidth, visibleHeight, toggle: toggle ? { label: toggle.getAttribute("aria-label"), rect: qa.r(toggle) } : null, vw: innerWidth, vh: innerHeight };
  });
}

// Text items (box from a Range over the element's text) for contrast probes.
export async function textItems(ctx, selector, { maxPx = null, within = null, limit = 400, match = null, color = null } = {}) {
  return ctx.inPage((qa, a) => {
    const scope = a.within ? qa.one(a.within) : document;
    if (!scope) return [];
    const re = a.match ? new RegExp(a.match) : null;
    const out = [];
    for (const el of qa.all(a.sel, scope)) {
      if (!qa.visible(el)) continue;
      const own = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
      if (!own) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (a.maxPx != null && px > a.maxPx) continue;
      if (re && !re.test(qa.txt(el))) continue;
      if (a.color && getComputedStyle(el).color !== a.color) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const b = range.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      out.push({ text: qa.txt(el).slice(0, 40), px, color: getComputedStyle(el).color, box: { x: b.x, y: b.y, w: b.width, h: b.height } });
      if (out.length >= a.limit) break;
    }
    return out;
  }, { sel: selector, maxPx, within, limit, match, color });
}

export function contrasts(ctx, items) {
  return items.map((item) => ({ text: item.text, px: item.px, ratio: contrastAgainst(ctx.image(), item.box, ctx.scale, item.color) }));
}

export function worstContrast(rows) {
  const valid = rows.filter((row) => row.ratio != null);
  return valid.length ? valid.reduce((a, b) => (a.ratio <= b.ratio ? a : b)) : null;
}

export function intersection(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.round(w * h) : 0;
}

export function gapBetween(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

export async function selectedTab(ctx) {
  return ctx.inPage((qa) => qa.activeTab());
}

export async function panelAlpha(ctx) {
  return ctx.inPage((qa) => qa.surfaceAlpha("[data-qa=dashboard-panel]"));
}

export async function canvasRect(ctx) {
  return ctx.inPage((qa) => {
    const canvases = qa.all("canvas").filter(qa.shown).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    return canvases[0] ? qa.r(canvases[0]) : null;
  });
}

// Region of the canvas that is not covered by the panel (where the scene is actually visible).
export async function sceneRegion(ctx) {
  const canvas = await canvasRect(ctx);
  const panel = await panelInfo(ctx);
  if (!canvas) return null;
  const right = panel && panel.visibleWidth > 0 && panel.rect.l > 0 ? Math.min(canvas.x + canvas.w, panel.rect.l) : canvas.x + canvas.w;
  return { x: canvas.x, y: canvas.y, w: Math.max(0, right - canvas.x), h: canvas.h };
}

export async function chipByText(ctx, text) {
  return (await chips(ctx)).find((chip) => chip.text === text || chip.name === text) ?? null;
}

export function roofBox(chip) {
  if (!chip) return null;
  const r = chip.rect;
  return { x: r.x + r.w / 2 - 20, y: r.y + r.h + 6, w: 40, h: 30 };
}

export const HOOKS = Object.freeze({
  inspector: "[data-qa=selection-inspector]",
  estimate: "[data-qa=estimate-value]",
  freshness: "[data-qa=freshness-stamp]",
  sample: "[data-qa=sample-badge]",
  labelLayer: "[data-qa=campus-label-layer]",
  search: "[data-qa=search-field]",
  legend: "[data-qa=legend]",
  breadcrumb: "[data-qa=breadcrumb]",
  cameraControls: "[data-qa=camera-controls]",
  presentation: "[data-qa=presentation-toggle]",
  sheetHandle: "[data-qa=sheet-handle]",
  roomGrid: "[data-qa=d4-room-grid]",
});

export const REQUIRED_HOOKS = Object.freeze(Object.values(HOOKS));

// Samples a page expression on consecutive animation frames.
export async function sampleFrames(ctx, fn, frames = 5, args = {}) {
  return ctx.inPage(async (qa, a) => {
    const sampler = new Function("qa", "args", `return (${a.fn})(qa, args);`);
    const out = [];
    for (let i = 0; i < a.frames; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      out.push(sampler(qa, a.args));
    }
    return out;
  }, { fn: fn.toString(), frames, args });
}

// Uppercase English eyebrows/headings: a line that starts with >= 4 uppercase Latin characters
// (spaces, hyphens and digits allowed), e.g. "MICROCLIMATE", "SOLAR STATUS · ...", "SINGLE-BUILDING ANALYSIS".
export function hasUpperEyebrow(texts) {
  return texts.filter((value) => /^[A-Z][A-Z0-9 -]{3,}(\s|·|$)/.test(value));
}

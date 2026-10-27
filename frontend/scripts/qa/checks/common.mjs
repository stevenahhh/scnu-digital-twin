// Shared helpers for the audit checks. Every check returns { pass, measured, expected }; a missing
// product hook is a FAIL with the hook named in `measured`, never a skip.
import { contrastAgainst, pixelDiff, parseCssColor, hueOf, hueDistance, luminanceStep, meanLuminance } from "../lib/probe.mjs";
import { ROWS } from "./rows.mjs";

export { contrastAgainst, pixelDiff, parseCssColor, hueOf, hueDistance, luminanceStep, meanLuminance };

export const result = (pass, measured, expected) => ({ pass: Boolean(pass), measured, expected });
export const missingHook = (selector, expected, extra = {}) => ({ pass: false, measured: { missingHook: selector, ...extra }, expected });

// Rail-first shell: the panel starts collapsed (desktop rail, phone sheet peek), so a row that measures panel content
// opens the panel section it measures first, the way a user would (패널 열기, then the tab). Only for checks marked
// `mutates: true` (they run in the probe replay, never in the captured frames). Returns the actions taken.
export async function openPanelSection(ctx, tab = "dashboard") {
  const actions = [];
  if (await ctx.b.center('[aria-label="패널 열기"]')) {
    await ctx.b.tap('[aria-label="패널 열기"]');
    actions.push("패널 열기");
    await ctx.sleep(1200);
  }
  // Phone: 패널 열기 raises the sheet to half, where the section's cards sit below the fold; raise it to full with the
  // sheet handle's own keyboard step (ArrowUp), as a user would drag it.
  for (let step = 0; ctx.viewport === "P" && step < 2; step += 1) {
    const detent = await ctx.inPage((qa) => qa.one("[data-qa=dashboard-panel]")?.getAttribute("data-detent") ?? null);
    if (detent === "full" || !(await ctx.inPage((qa) => { const handle = qa.one("[data-qa=sheet-handle]"); handle?.focus(); return Boolean(handle); }))) break;
    await ctx.b.key("ArrowUp");
    actions.push("sheet handle ArrowUp");
    await ctx.sleep(800);
  }
  const selector = `[data-qa=dashboard-tab-${tab}]`;
  if (tab && await ctx.inPage((qa, a) => Boolean(qa.one(a.sel)) && qa.one(a.sel).getAttribute("aria-selected") !== "true", { sel: selector })) {
    await ctx.b.tap(selector);
    actions.push(`tab ${tab}`);
    await ctx.sleep(800);
  }
  return actions;
}

// Rail-first shell: rows that measure panel content (the audit captured them with the panel open) open the panel section
// first, the way a user would, measure on a fresh screenshot, and then put the page back (패널 닫기, previous tab) so the
// probe replay's later states and checks see the page as their own steps left it. tab: dashboard tab id, or null for the
// state's own tab. Checks using it are `mutates: true`.
export async function withPanelOpen(ctx, tab, measure) {
  const before = await ctx.inPage((qa) => qa.all("[data-qa^=dashboard-tab-]").find((el) => el.getAttribute("aria-selected") === "true")?.getAttribute("data-qa")?.replace("dashboard-tab-", "") ?? null);
  const actions = await openPanelSection(ctx, tab);
  if (actions.length > 0 && ctx.refreshImage) await ctx.refreshImage();
  try {
    return await measure(actions);
  } finally {
    if (tab && before && before !== tab && actions.includes(`tab ${tab}`)) {
      await ctx.b.tap(`[data-qa=dashboard-tab-${before}]`);
      await ctx.sleep(600);
    }
    if (actions.includes("패널 열기") && await ctx.b.center('[aria-label="패널 닫기"]')) {
      await ctx.b.tap('[aria-label="패널 닫기"]');
      await ctx.sleep(900);
    }
  }
}

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
      // The building anchor the layer projected for this chip (data-anchor-left/top on its slot), or null.
      anchor: (() => { const slot = el.closest("[data-label-slot]"); const x = Number(slot?.dataset.anchorLeft); const y = Number(slot?.dataset.anchorTop);
        return slot?.dataset.anchorLeft && slot?.dataset.anchorTop && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null; })(),
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

// Luminance step across the model's bounding edge (AUDIT GAP-25/V-S-102: "sample ground luminance along the model's bounding
// rectangle and 20 px outward"). The app writes the ground rectangle's four screen corners as data-model-edge (Legacy: the GLB
// ground meshes; VWorld: the campus overlay footprint). Every 40 px along each edge, compare 20 px inside with 20 px outside;
// samples off the scene region or under a HUD rect are skipped. Returns { step, samples, edge } or { edge: null }.
export async function modelEdgeStep(ctx) {
  const raw = await ctx.inPage((qa) => qa.all("[data-model-edge]").map((el) => el.getAttribute("data-model-edge")).find(Boolean) ?? null);
  if (!raw) return { edge: null, step: null, samples: 0 };
  const corners = raw.split(";").map((p) => p.split(",").map(Number));
  const region = await sceneRegion(ctx);
  const huds = (await hudRects(ctx)).map((h) => h.rect);
  // Label overlays (chips, anchor dots, leader lines) are DOM drawn over the scene, not the scene's model edge: a sample
  // that lands on a white anchor dot reads a ~0.9 step on any base. They are skipped like the HUD.
  const overlays = await ctx.inPage((qa) => qa.all("[data-qa=campus-label-layer] button, [data-qa=campus-label-layer] svg, [data-qa=zone-label], [data-qa=label-anchor-dot]")
    .filter(qa.visible).map((el) => { const r = el.getBoundingClientRect(); return { l: r.left - 4, t: r.top - 4, r: r.right + 4, b: r.bottom + 4 }; }));
  huds.push(...overlays);
  const img = ctx.image();
  const cx = corners.reduce((a, p) => a + p[0], 0) / corners.length;
  const cy = corners.reduce((a, p) => a + p[1], 0) / corners.length;
  const usable = ([x, y]) => region && x >= region.x + 8 && y >= region.y + 8 && x <= region.x + region.w - 8 && y <= region.y + region.h - 8
    && !huds.some((r) => x >= r.l && x <= r.r && y >= r.t && y <= r.b);
  let worst = 0;
  let samples = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % corners.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) continue;
    let nx = -(by - ay) / len;
    let ny = (bx - ax) / len;
    // Outward = away from the rectangle's centre.
    const mx = (ax + bx) / 2 - cx;
    const my = (ay + by) / 2 - cy;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
    for (let d = 20; d < len - 20; d += 40) {
      const q = [ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len];
      const inside = [q[0] - nx * 20, q[1] - ny * 20];
      const outside = [q[0] + nx * 20, q[1] + ny * 20];
      if (!usable(inside) || !usable(outside)) continue;
      const step = luminanceStep(img, [inside, outside], ctx.scale, 4);
      worst = Math.max(worst, step);
      samples += 1;
    }
  }
  // No usable sample: either the edge is not on screen at all (the scene region lies inside the model rectangle - the ground
  // reaches every side of the view, so no bounding edge is visible) or it is hidden by HUD/panel.
  const inside = ([x, y]) => {
    let hit = false;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
      const [xi, yi] = corners[i]; const [xj, yj] = corners[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const edgeOffScreen = Boolean(region) && samples === 0
    && [[region.x, region.y], [region.x + region.w, region.y], [region.x, region.y + region.h], [region.x + region.w, region.y + region.h]].every(inside);
  return { edge: corners, step: Math.round(worst * 1000) / 1000, samples, edgeOffScreen };
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

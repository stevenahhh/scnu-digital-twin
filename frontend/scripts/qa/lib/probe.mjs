// Measurement primitives (AUDIT section 7 "Primitives"): rect, count, text, style, effective text
// size, contrast against rendered pixels, pixel diff and luminance step.
import { decodePng } from "../../campus-model/lib/png.mjs";

// Installed into the page as window.__qa before checks run. Must stay self-contained.
export function pageProbeSource() {
  return `(() => {
  if (window.__qa) return true;
  const all = (sel, root = document) => { try { return [...root.querySelectorAll(sel)]; } catch { return []; } };
  const one = (sel, root = document) => { try { return root.querySelector(sel); } catch { return null; } };
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10,
      l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const shown = (el) => { if (!el || !el.isConnected) return false; const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return false; const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    let node = el; while (node && node.nodeType === 1) { if (Number(getComputedStyle(node).opacity) === 0) return false; node = node.parentElement; }
    return true; };
  const inView = (el) => { const b = el.getBoundingClientRect(); return b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight; };
  const visible = (el) => shown(el) && inView(el);
  const txt = (el) => (el?.innerText ?? el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  const scaleOf = (el) => { let scale = 1; let node = el;
    while (node && node.nodeType === 1) { const s = getComputedStyle(node);
      if (s.transform && s.transform !== 'none') { const m = new DOMMatrixReadOnly(s.transform); scale *= Math.hypot(m.a, m.b); }
      if (s.scale && s.scale !== 'none') scale *= Number(s.scale.split(' ')[0]) || 1;
      const zoom = Number(s.zoom); if (zoom && zoom !== 1) scale *= zoom;
      node = node.parentElement; }
    return scale; };
  const eff = (el) => Math.round(parseFloat(getComputedStyle(el).fontSize) * scaleOf(el) * 100) / 100;
  const inter = (a, b) => { if (!a || !b) return 0; const w = Math.min(a.r, b.r) - Math.max(a.l, b.l); const h = Math.min(a.b, b.b) - Math.max(a.t, b.t); return w > 0 && h > 0 ? Math.round(w * h) : 0; };
  const gap = (a, b) => { const dx = Math.max(0, Math.max(a.l, b.l) - Math.min(a.r, b.r)); const dy = Math.max(0, Math.max(a.t, b.t) - Math.min(a.b, b.b)); return Math.hypot(dx, dy); };
  const chips = () => all('button[data-qa=campus-label]').filter(visible);
  // A chip's building name: the label-chip text without the code badge, the hover value and the estimated glyph
  // (SceneLabel renders the code as a StatusBadge child, so the chip's own text reads "C1 도서관").
  const chipName = (el) => { const root = el.querySelector('[data-qa=label-chip]') || el; const copy = root.cloneNode(true);
    copy.querySelectorAll('[data-qa$=badge],[data-qa=label-value],[data-qa=label-estimated-glyph],[data-qa=label-dot]').forEach((node) => node.remove());
    return (copy.textContent || '').replace(/\\s+/g, ' ').trim(); };
  // The leader drawn for a chip: inside it (SceneLabel) or the sibling svg CampusLabelLayer draws before each slot; only a shown one counts.
  const leaderOf = (el) => { const slot = el.closest('[data-label-slot]'); const prev = slot && slot.previousElementSibling;
    const candidates = [el.querySelector('[data-qa=label-leader]'), prev && prev.matches('[data-qa=label-leader]') ? prev : null].filter(Boolean);
    return candidates.find((node) => getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none') || null; };
  const color = (el, prop = 'color') => getComputedStyle(el)[prop];
  const textNodesShown = (root = document.body) => { const out = []; const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { const node = walker.currentNode; const value = node.textContent.trim(); if (!value) continue;
      const el = node.parentElement; if (el && visible(el)) out.push({ el, value }); } return out; };
  // Active dashboard tab: aria-selected/pressed, else the one tab whose filled background differs.
  const activeTab = () => {
    const tabs = all("[data-qa^=dashboard-tab-]");
    const aria = tabs.find((el) => el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true");
    if (aria) return txt(aria);
    const filled = tabs.filter((el) => !/rgba\\(0, 0, 0, 0\\)|transparent/.test(getComputedStyle(el).backgroundColor));
    return filled.length === 1 ? txt(filled[0]) : null;
  };
  const alphaOf = (value) => { const m = String(value).match(/\\/\\s*([\\d.]+)\\)|rgba\\([^)]*,\\s*([\\d.]+)\\)/); if (m) return Number(m[1] ?? m[2]); return /^(rgb|color)\\(/.test(String(value)) ? 1 : 0; };
  // Alpha of the panel's visible surface: the largest non-transparent box among it and its first descendants.
  const surfaceAlpha = (sel) => {
    const root = one(sel);
    if (!root) return null;
    const candidates = [root, ...root.querySelectorAll(":scope > *, :scope > * > *")].filter((el) => alphaOf(getComputedStyle(el).backgroundColor) > 0);
    const area = (el) => { const b = el.getBoundingClientRect(); return b.width * b.height; };
    const best = candidates.sort((a, b) => area(b) - area(a))[0];
    return best ? Math.round(alphaOf(getComputedStyle(best).backgroundColor) * 100) / 100 : 0;
  };
  const button = (label) => all('button,[role=button],a').find((el) => visible(el) && (el.getAttribute('aria-label') === label || txt(el) === label));
  window.__qa = { all, one, r, shown, inView, visible, txt, eff, scaleOf, inter, gap, chips, chipName, leaderOf, color, textNodesShown, button, activeTab, alphaOf, surfaceAlpha };
  return true;
})()`;
}

export async function installProbe(browser) {
  return browser.evaluate(pageProbeSource());
}

// Runs fn(qa, args) in the page with window.__qa available.
export async function inPage(browser, fn, args = {}) {
  await installProbe(browser);
  return browser.evaluate(`(${fn.toString()})(window.__qa, ${JSON.stringify(args)})`);
}

export const rect = (browser, sel) => inPage(browser, (qa, a) => qa.r(qa.one(a.sel)), { sel });
export const count = (browser, sel, { visibleOnly = true } = {}) =>
  inPage(browser, (qa, a) => qa.all(a.sel).filter((el) => !a.visibleOnly || qa.visible(el)).length, { sel, visibleOnly });
export const text = (browser, sel) => inPage(browser, (qa, a) => qa.txt(qa.one(a.sel)), { sel });
export const style = (browser, sel, prop) => inPage(browser, (qa, a) => { const el = qa.one(a.sel); return el ? getComputedStyle(el)[a.prop] : null; }, { sel, prop });
export const effectiveTextSizes = (browser, sel) =>
  inPage(browser, (qa, a) => qa.all(a.sel).filter(qa.visible).map((el) => ({ text: qa.txt(el).slice(0, 40), px: qa.eff(el) })), { sel });

export function decode(pngBytes) {
  return decodePng(pngBytes);
}

export function parseCssColor(value) {
  const match = String(value).match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  const srgb = String(value).match(/color\(srgb ([^)]+)\)/);
  if (srgb) {
    const parts = srgb[1].split(/[ /]+/).filter(Boolean).map(Number);
    return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts[3] ?? 1 };
  }
  return null;
}

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function pixel(image, x, y) {
  const i = (y * image.width + x) * image.channels;
  return { r: image.pixels[i], g: image.pixels[i + 1], b: image.pixels[i + 2] };
}

// Mean colour of the screenshot inside a CSS-px box, skipping pixels close to the text colour
// so the glyphs themselves do not count as "behind" the text.
export function backdropColor(image, box, scale, ink) {
  const x0 = Math.max(0, Math.floor(box.x * scale));
  const y0 = Math.max(0, Math.floor(box.y * scale));
  const x1 = Math.min(image.width, Math.ceil((box.x + box.w) * scale));
  const y1 = Math.min(image.height, Math.ceil((box.y + box.h) * scale));
  // The backdrop is the box's dominant non-ink colour: anti-aliased glyph edges (blends of ink and backdrop) are not
  // backdrop, and averaging them in pulls the "backdrop" toward the ink (white 12 px text on #5e6ad2 read 4.18:1 instead
  // of 4.69:1). Pixels are bucketed by 4 bits per channel; the most frequent bucket's mean is returned.
  const buckets = new Map();
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const p = pixel(image, x, y);
      if (ink && Math.abs(p.r - ink.r) + Math.abs(p.g - ink.g) + Math.abs(p.b - ink.b) < 90) continue;
      const key = ((p.r >> 4) << 8) | ((p.g >> 4) << 4) | (p.b >> 4);
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      bucket.r += p.r; bucket.g += p.g; bucket.b += p.b; bucket.n += 1;
      buckets.set(key, bucket);
    }
  }
  if (buckets.size === 0) return null;
  // Without an ink colour (meanLuminance) the caller wants the plain mean of the box.
  if (!ink) {
    const all = [...buckets.values()].reduce((a, b) => ({ r: a.r + b.r, g: a.g + b.g, b: a.b + b.b, n: a.n + b.n }), { r: 0, g: 0, b: 0, n: 0 });
    return { r: all.r / all.n, g: all.g / all.n, b: all.b / all.n };
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
  return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n };
}

// WCAG ratio of a text colour against the rendered pixels behind its box.
export function contrastAgainst(image, box, scale, cssColor) {
  const ink = parseCssColor(cssColor);
  if (!ink || !box || box.w <= 0 || box.h <= 0) return null;
  const back = backdropColor(image, box, scale, ink);
  if (!back) return null;
  const composed = { r: ink.r * ink.a + back.r * (1 - ink.a), g: ink.g * ink.a + back.g * (1 - ink.a), b: ink.b * ink.a + back.b * (1 - ink.a) };
  return Math.round(contrastRatio(composed, back) * 100) / 100;
}

// Mean absolute per-channel difference (0..1) inside a CSS-px region (whole image when omitted).
export function pixelDiff(a, b, region, scale = 1) {
  const box = region ?? { x: 0, y: 0, w: a.width / scale, h: a.height / scale };
  const x0 = Math.max(0, Math.floor(box.x * scale));
  const y0 = Math.max(0, Math.floor(box.y * scale));
  const x1 = Math.min(a.width, b.width, Math.ceil((box.x + box.w) * scale));
  const y1 = Math.min(a.height, b.height, Math.ceil((box.y + box.h) * scale));
  let total = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const p = pixel(a, x, y);
      const q = pixel(b, x, y);
      total += (Math.abs(p.r - q.r) + Math.abs(p.g - q.g) + Math.abs(p.b - q.b)) / 765;
      n += 1;
    }
  }
  return n ? total / n : 0;
}

export function meanLuminance(image, box, scale = 1) {
  const back = backdropColor(image, box, scale, null);
  return back ? luminance(back) : null;
}

// Largest relative luminance step between consecutive sample points (CSS px).
export function luminanceStep(image, points, scale = 1, radius = 3) {
  const values = points.map(([x, y]) => meanLuminance(image, { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 }, scale));
  let worst = 0;
  for (let i = 1; i < values.length; i += 1) {
    const a = values[i - 1];
    const b = values[i];
    if (a == null || b == null) continue;
    const step = Math.abs(a - b) / Math.max(a, b, 1e-6);
    worst = Math.max(worst, step);
  }
  return Math.round(worst * 1000) / 1000;
}

export function hueOf({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return null;
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}

export function hueDistance(a, b) {
  if (a == null || b == null) return null;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

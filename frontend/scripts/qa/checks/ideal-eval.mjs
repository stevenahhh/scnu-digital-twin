// Pure evaluation functions of the IS-01..IS-40 checks (checks/ideal.mjs). The browser side only collects facts
// (counts, rects, texts, samples); every PASS/FAIL decision is made here so it can be unit tested without a page.
import { dHashDistance, dHashImage } from "../lib/baseline.mjs";

export const IS_IDS = Object.freeze(Array.from({ length: 40 }, (_, index) => `IS-${String(index + 1).padStart(2, "0")}`));

export const verdict = (pass, measured, expected) => ({ pass: Boolean(pass), measured, expected });

// A product hook the row needs does not exist yet: FAIL, naming the hook (never a vacuous pass).
export const hookMissing = (hook, expected, extra = {}) => verdict(false, { measured: "hook missing", hook, ...extra }, expected);

export function countAtMost(count, limit, extra = {}) {
  return verdict(count <= limit, { count, limit, ...extra }, `<= ${limit}`);
}

export function countExactly(count, want, extra = {}) {
  return verdict(count === want, { count, want, ...extra }, `exactly ${want}`);
}

// IS-01/IS-02: the first-screen budget; the S17 (fixtures up) frame has one control fewer than the feeds-down frame.
export function controlBudgetLimit(viewport, fixtures) {
  const up = fixtures === "up";
  return viewport === "P" ? (up ? 7 : 8) : (up ? 15 : 16);
}

// IS-03: two sorted name lists are equal.
export function compareNameSets(legacy, vworld) {
  const a = [...legacy].sort();
  const b = [...vworld].sort();
  const onlyLegacy = a.filter((name) => !b.includes(name));
  const onlyVworld = b.filter((name) => !a.includes(name));
  const same = a.length === b.length && a.every((name, index) => name === b[index]);
  return { same, onlyLegacy, onlyVworld, legacyCount: a.length, vworldCount: b.length };
}

// IS-10: data-source values that occur more than once.
export function duplicateValues(values) {
  const seen = new Map();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([value, n]) => ({ value, n }));
}

// IS-11: exact tab names in order.
export const IDEAL_TABS = Object.freeze(["건물", "현황", "에너지", "시뮬레이션"]);
export function tabsMatch(texts, expected = IDEAL_TABS) {
  return texts.length === expected.length && texts.every((text, index) => text === expected[index]);
}

// IS-12: number of text lines of a tab label: client-rect tops more than `tolerance` px apart start a new line (spans on
// one line differ by subpixels; a wrapped line sits a full line height lower).
export function lineCount(tops, tolerance = 4) {
  const sorted = [...tops].sort((a, b) => a - b);
  let lines = 0;
  let last = -Infinity;
  for (const top of sorted) {
    if (top - last > tolerance) lines += 1;
    last = top;
  }
  return lines;
}

// Rect overlap on { l, t, r, b } (strict: touching edges do not overlap), as section 6.1 `overlaps`.
export function rectsOverlap(p, q) {
  return p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;
}

// IS-17: every pair of controls that overlaps, skipping pairs where one contains the other (ancestor/descendant).
// items: [{ name, rect: {l,t,r,b}, ancestors: [index...] }] where `ancestors` lists the indices of items it lies inside.
export function overlappingPairs(items) {
  const pairs = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const related = (items[i].ancestors ?? []).includes(j) || (items[j].ancestors ?? []).includes(i);
      if (!related && rectsOverlap(items[i].rect, items[j].rect)) pairs.push([items[i].name, items[j].name]);
    }
  }
  return pairs;
}

// IS-18/IS-19: controls smaller than `min` CSS px. A slider counts by the height of its hit area only.
export function undersized(items, min) {
  return items.filter((item) => (item.slider ? item.h < min : item.w < min || item.h < min));
}

// IS-33: a computed transition animates a layout or background property for more than 10 ms (section 6.2 regex).
const LAYOUT_PROPERTY = /(^|,\s*)(right|left|top|bottom|width|height|background-color|all)(\s*,|$)/;
export function isLayoutTransition(property, duration) {
  return LAYOUT_PROPERTY.test(property) && String(duration).split(",").some((d) => parseFloat(d) > 0.01);
}

// IS-31/IS-32/IS-38: crop a decoded image to a CSS-px region (scale = device pixel ratio).
export function cropImage(image, region, scale = 1) {
  const x0 = Math.max(0, Math.floor(region.x * scale));
  const y0 = Math.max(0, Math.floor(region.y * scale));
  const x1 = Math.min(image.width, Math.ceil((region.x + region.w) * scale));
  const y1 = Math.min(image.height, Math.ceil((region.y + region.h) * scale));
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const pixels = new Uint8Array(width * height * image.channels);
  for (let y = 0; y < height; y += 1) {
    const from = ((y0 + y) * image.width + x0) * image.channels;
    pixels.set(image.pixels.subarray(from, from + width * image.channels), y * width * image.channels);
  }
  return { width, height, channels: image.channels, pixels };
}

// dHash distance (bits) between the same region of two decoded images.
export function regionDistance(a, b, region, scale = 1) {
  return dHashDistance(dHashImage(cropImage(a, region, scale)), dHashImage(cropImage(b, region, scale)));
}

export const STILL_MAX_BITS = 2;

// IS-34: samples [{ t, hudRight, panelLeft }]; the HUD's right edge never passes the panel's left edge.
export function hudPanelViolations(samples) {
  return samples.filter((sample) => sample.hudRight == null || sample.panelLeft == null || sample.hudRight > sample.panelLeft + 0.5);
}

// The sample nearest to an offset (ms).
export function nearestSample(samples, offset) {
  return samples.reduce((best, sample) => (best == null || Math.abs(sample.t - offset) < Math.abs(best.t - offset) ? sample : best), null);
}

// IS-29: presentation mode shows exactly 발표 모드 끝내기 and 투어 시작 (tour position dots allowed while touring).
export const PRESENTATION_NAMES = Object.freeze(["발표 모드 끝내기", "투어 시작"]);
export function presentationExtras(names, { touring = false } = {}) {
  const allowed = new Set([...PRESENTATION_NAMES, ...(touring ? ["투어 멈춤"] : [])]);
  const extras = names.filter((name) => !allowed.has(name) && !(touring && /^투어 \d+\/\d+$/.test(name)));
  const missing = PRESENTATION_NAMES.filter((name) => !names.includes(name) && !(touring && name === "투어 시작" && names.includes("투어 멈춤")));
  return { extras, missing };
}

// IS-39: samples [{ t, spinners, cards: [{ card, spinners, skeletons }] }] at 500 and 1500 ms after the request.
export function loadingProblems(samples) {
  const problems = [];
  const early = nearestSample(samples, 500);
  if (early && early.spinners > 0) problems.push(`${early.spinners} spinner(s) at ${early.t} ms (expected 0 at 500 ms)`);
  const late = nearestSample(samples, 1500);
  for (const card of late?.cards ?? []) if (card.spinners > 1) problems.push(`${card.spinners} spinners in ${card.card} at ${late.t} ms`);
  for (const sample of samples) {
    for (const card of sample.cards ?? []) if (card.spinners > 0 && card.skeletons > 0) problems.push(`spinner + skeleton together in ${card.card} at ${sample.t} ms`);
  }
  return problems;
}

// IS-38 (P): smallest sheet opacity sampled while the detent changes.
export function minimum(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  return numbers.length ? Math.min(...numbers) : null;
}

// IS-40: the scene-time slider did not move and the tour is off once the D4 window is open.
export function stoppedAfterD4({ before, after, tourPressed }) {
  return before != null && before === after && tourPressed === "false";
}

// IS-23: YYYY-MM-DD of an ISO instant in KST (+09:00), the scene date when no date input carries one.
export function kstDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

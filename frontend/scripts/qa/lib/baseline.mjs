// Baseline fingerprints: a 64-bit difference hash (16 hex chars) of each screenshot plus the
// rects of the key layout regions. A scenario regresses when the hash moves more than
// DHASH_MAX_BITS bits or any key rect moves more than RECT_MAX_PX CSS px.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { decodePng } from "../../campus-model/lib/png.mjs";

export const DHASH_MAX_BITS = 8;
export const RECT_MAX_PX = 4;

export const KEY_RECTS = Object.freeze({
  panel: "[data-qa=dashboard-panel]",
  hud: "[data-qa=campus-hud]",
  timeSlider: "[data-qa=time-slider]",
  presetBar: "[data-qa=camera-preset-bar]",
  selectedChip: "button[data-qa=campus-label][aria-pressed=true]",
});

function gray(image, x, y) {
  const i = (y * image.width + x) * image.channels;
  if (image.channels < 3) return image.pixels[i];
  return 0.299 * image.pixels[i] + 0.587 * image.pixels[i + 1] + 0.114 * image.pixels[i + 2];
}

// Area-averaged 9x8 grayscale grid; bit = left cell brighter than its right neighbour.
export function dHashImage(image) {
  const cols = 9;
  const rows = 8;
  const grid = [];
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor((row * image.height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * image.height) / rows));
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((col * image.width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * image.width) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          sum += gray(image, x, y);
          n += 1;
        }
      }
      grid.push(sum / n);
    }
  }
  let bits = 0n;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      bits = (bits << 1n) | (grid[row * cols + col] > grid[row * cols + col + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function dHashPng(pngBytes) {
  return dHashImage(decodePng(pngBytes));
}

export function dHashDistance(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

// Largest edge movement between two rects (null = element absent).
export function rectShift(a, b) {
  if (!a && !b) return 0;
  if (!a || !b) return Infinity;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - (b.x + b.w)), Math.abs(a.y + a.h - (b.y + b.h)));
}

export function roundRect(rect) {
  if (!rect || rect.w <= 0 || rect.h <= 0) return null;
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
}

export function scenarioKey({ entry, state, viewport, theme }) {
  return `${entry}/${state}-${viewport}-${theme}`;
}

// Compares one captured scenario with its baseline. Returns { pass, problems: [..] }.
// States whose pixels depend on frame timing (S11 is captured mid-drag: the held orbit ends at a pose
// that varies with the frame rate). Their dHash is reported but only the key rects gate.
export const PIXEL_VOLATILE_STATES = Object.freeze(["S11"]);

export function isPixelVolatile(key) {
  const state = String(key).split("/")[1]?.split("-")[0];
  return PIXEL_VOLATILE_STATES.includes(state);
}

export function compareScenario(current, baseline) {
  if (!baseline) return { pass: false, problems: [{ kind: "missing-baseline", detail: "scenario missing from baselines.json" }] };
  const problems = [];
  const distance = dHashDistance(current.dhash, baseline.dhash);
  const volatile = isPixelVolatile(current.key);
  if (distance > DHASH_MAX_BITS && !volatile) problems.push({ kind: "dhash", detail: `dHash distance ${distance} bits > ${DHASH_MAX_BITS}`, distance });
  const rectShifts = {};
  for (const name of Object.keys(KEY_RECTS)) {
    const shift = rectShift(current.rects?.[name] ?? null, baseline.rects?.[name] ?? null);
    rectShifts[name] = shift === Infinity ? "appeared/disappeared" : shift;
    if (shift > RECT_MAX_PX) {
      problems.push({
        kind: "rect",
        detail: `rect ${name} moved ${shift === Infinity ? "(appeared/disappeared)" : `${shift} px`} > ${RECT_MAX_PX} px: baseline ${JSON.stringify(baseline.rects?.[name] ?? null)} now ${JSON.stringify(current.rects?.[name] ?? null)}`,
        rect: name,
        shift,
      });
    }
  }
  return { pass: problems.length === 0, distance, dhashGating: !volatile, rectShifts, problems };
}

export function loadBaselines(file) {
  if (!existsSync(file)) return { version: 1, hash: "dhash-64", scenarios: {} };
  return JSON.parse(readFileSync(file, "utf8"));
}

export function saveBaselines(file, data) {
  const scenarios = Object.fromEntries(Object.entries(data.scenarios).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, `${JSON.stringify({ ...data, scenarios }, null, 2)}\n`);
}

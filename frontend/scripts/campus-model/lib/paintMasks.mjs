// Paint masks of an NGII orthophoto window: white, yellow and blue road paint, by the top-hat method documented in
// bake/markings-gate.mjs (which owns the thresholds' rationale). Shared by the paint gate and qa/mapCompare's
// overhead-blend --objects pass. Pure: the caller reads the sheet; nothing is written.
export const PAINT_OPEN_M = 1.5;
export const WHITE_TOPHAT = 20;
export const WHITE_SPREAD = 60;
export const YELLOW_TOPHAT = 12;
export const YELLOW_MIN = 14;
export const YELLOW_CHROMA = 0.12;
export const YELLOW_RB = 14;
export const YELLOW_GR = 0.72;
export const BLUE_TOPHAT = 15;
export const BLUE_AREA = 30;
export const BLUE_BR = 45;
export const BLUE_GREY = 80;
export const WHITE_TOPHAT_RAW = 8;
export const SHADOW_SURFACE = 68;
export const SHADOW_RED = 30;
export const SHADOW_REFERENCE = 105;
export const SHADOW_GAIN = 2;
export const HALF_MAX = 0.5;
export const PEAK_REACH_M = 0.5;

// Running minimum or maximum over 2r + 1 samples along `count` lines of `length` samples (van Herk / Gil-Werman).
function runningExtreme(src, dst, length, count, stride, lineStep, r, min) {
  const span = 2 * r + 1;
  const padded = length + 2 * r;
  const ext = new Float32Array(padded);
  const forward = new Float32Array(padded);
  const backward = new Float32Array(padded);
  const pick = min ? Math.min : Math.max;
  for (let line = 0; line < count; line += 1) {
    const base = line * lineStep;
    for (let i = 0; i < padded; i += 1) {
      const j = i - r;
      ext[i] = j < 0 || j >= length ? (min ? Infinity : -Infinity) : src[base + j * stride];
    }
    for (let i = 0; i < padded; i += 1) forward[i] = i % span === 0 ? ext[i] : pick(forward[i - 1], ext[i]);
    for (let i = padded - 1; i >= 0; i -= 1) backward[i] = i % span === span - 1 || i === padded - 1 ? ext[i] : pick(backward[i + 1], ext[i]);
    for (let j = 0; j < length; j += 1) dst[base + j * stride] = pick(backward[j], forward[j + 2 * r]);
  }
}

// Grey opening (erosion, then dilation) with a square of half size r.
function opening(values, width, height, r) {
  const a = new Float32Array(values.length);
  const b = new Float32Array(values.length);
  runningExtreme(values, a, width, height, 1, width, r, true);
  runningExtreme(a, b, height, width, width, 1, r, true);
  runningExtreme(b, a, width, height, 1, width, r, false);
  runningExtreme(a, b, height, width, width, 1, r, false);
  return b;
}

export function paintMasks({ rgb, width, height, metresPerPixel }) {
  const size = width * height;
  const grey = new Float32Array(size);
  const red = new Float32Array(size);
  const yellowness = new Float32Array(size);
  const blueness = new Float32Array(size);
  for (let p = 0; p < size; p += 1) {
    const r = rgb[p * 3];
    const g = rgb[p * 3 + 1];
    const b = rgb[p * 3 + 2];
    grey[p] = (r + g + b) / 3;
    red[p] = r;
    yellowness[p] = (r + g) / 2 - b;
    blueness[p] = b - (r + g) / 2;
  }
  const radius = Math.round(PAINT_OPEN_M / metresPerPixel);
  const surface = opening(grey, width, height, radius);
  const surfaceRed = opening(red, width, height, radius);
  const surfaceYellow = opening(yellowness, width, height, radius);
  const surfaceBlue = opening(blueness, width, height, radius);
  const masks = { white: new Uint8Array(size), yellow: new Uint8Array(size), blue: new Uint8Array(size) };
  // colour strengths (0 where the colour's conditions fail) and their local peaks
  const strength = { white: new Float32Array(size), yellow: new Float32Array(size), blue: new Float32Array(size) };
  for (let p = 0; p < size; p += 1) {
    const r = rgb[p * 3];
    const g = rgb[p * 3 + 1];
    const b = rgb[p * 3 + 2];
    const shadow = surface[p] < SHADOW_SURFACE && surfaceRed[p] < SHADOW_RED;
    const scale = shadow ? Math.min(SHADOW_GAIN, SHADOW_REFERENCE / Math.max(surface[p], 30)) : 1;
    const white = (grey[p] - surface[p]) * scale;
    const blueTop = blueness[p] - surfaceBlue[p];
    const isBlue = b - r >= BLUE_BR && grey[p] >= BLUE_GREY && (blueTop >= BLUE_TOPHAT || blueness[p] >= BLUE_AREA);
    const yellowTop = (yellowness[p] - surfaceYellow[p]) * scale;
    const isYellow = !isBlue && yellowness[p] >= Math.max(YELLOW_MIN, YELLOW_CHROMA * grey[p]) && yellowTop >= YELLOW_TOPHAT && r - b >= YELLOW_RB && g >= YELLOW_GR * r && white >= 0;
    const isWhite = !isBlue && !isYellow && white >= WHITE_TOPHAT && grey[p] - surface[p] >= WHITE_TOPHAT_RAW && Math.max(r, g, b) - Math.min(r, g, b) <= WHITE_SPREAD;
    strength.blue[p] = isBlue ? Math.max(blueTop, blueness[p]) : 0;
    strength.yellow[p] = isYellow ? yellowTop : 0;
    strength.white[p] = isWhite ? white : 0;
  }
  const reach = Math.max(1, Math.round(PEAK_REACH_M / metresPerPixel));
  for (const colour of ["white", "yellow", "blue"]) {
    const peak = new Float32Array(size);
    const tmp = new Float32Array(size);
    runningExtreme(strength[colour], tmp, width, height, 1, width, reach, false);
    runningExtreme(tmp, peak, height, width, width, 1, reach, false);
    const s = strength[colour];
    const mask = masks[colour];
    for (let p = 0; p < size; p += 1) mask[p] = s[p] > 0 && s[p] >= HALF_MAX * peak[p] ? 1 : 0;
  }
  return masks;
}

#!/usr/bin/env bun
// Paint gate bake for the road markings (stages/markings.mjs).
//
// For every marking candidate the stage would draw (markingCandidates(): markings.geojson with the corrections of
// markings-extra.geojson applied, plus markings-extra.geojson), this measures the share of its drawn area that the
// NGII 2025 orthophoto shows as white, yellow and blue paint, and writes data/photo/markings-gate.json:
// `supports: { id: [white, yellow, blue, fingerprint] }`, followed for a `double` line by the three shares of its single-line
// reading. The stage draws a candidate in its own colour when that
// share reaches GATE_SUPPORT, in the colour the photo shows when only that one does, and refuses to build when an
// entry is missing or its fingerprint no longer matches the geometry it draws. The file's `review` section (ids judged
// by eye on chip sheets, with the reason and the fingerprint they were judged at) is kept across bakes.
//
// Why the NGII sheet and not the VWorld z19 mosaic the ground texture uses: they are the same photograph (registered
// within 5 mm), but the VWorld rendition washes yellow paint out to pale grey, so only the NGII pixels tell a yellow
// kerb line from the light kerb stone beside it.
//
// Input: .cache/ngii-ortho/(B060)정사영상_2025_34702020.tif and .tfw (sheet 34702020, 0.25 m, EPSG:5186, uncompressed
// 8-bit RGB). The sheet is not committed (licence decision D2, docs/data-licences.md); this script is the only reader.
//
// Paint, per sheet pixel over EXTENT: top-hats over a grey opening with a square of PAINT_OPEN_M half size (paint
// marks are narrower, so the opening is the road surface around them). Inside cast shadows (surface darker than
// SHADOW_SURFACE with its red channel below SHADOW_RED: shadows drop the red channel, dark new asphalt does not) the
// top-hats are scaled by SHADOW_REFERENCE / surface, at most SHADOW_GAIN, as the detections did. The colours exclude
// each other (blue, then yellow, then white), since pale yellow paint is also bright:
//   blue:   B - R >= BLUE_BR, grey >= BLUE_GREY (cast shadows are blue-grey too, but darker: grey 33-49, B - R 19-43,
//           against blue bays at grey 60-185, B - R 45-190), and blueness (B - (R + G) / 2) top-hat >= BLUE_TOPHAT, or
//           blueness >= BLUE_AREA (bays painted blue all over are wider than the opening)
//   yellow: yellowness ((R + G) / 2 - B) at least YELLOW_MIN, YELLOW_CHROMA of the grey level and YELLOW_TOPHAT above
//           the surface, R - B >= YELLOW_RB, G >= YELLOW_GR x R (red pavement is yellow-ish by this measure but not
//           green enough), and not darker than the surface (sampled lines: yellow paint has yellowness / grey
//           0.14-0.30; white bars, dashes and text 0.08 or less)
//   white:  brightness top-hat >= WHITE_TOPHAT (scaled) and >= WHITE_TOPHAT_RAW (unscaled), channel spread <= WHITE_SPREAD
// Each mask keeps only pixels at HALF_MAX or more of their colour's strongest response within PEAK_REACH_M (the
// paint's extent at half maximum): at 0.25 m the 0.4 m gaps of a zebra blur to half the bars' top-hat, and a bar
// drawn half a period off must not score as paint. A candidate's support for a colour is the mean of that mask,
// read bilinearly at SUPPORT_STEP_M steps over the core of its pieces: the points at least CORE_M inside a piece's
// outline (or half its largest inner distance, for strokes thinner than 2 x CORE_M). Paint edges blur over one pixel
// at 0.25 m, so a correctly drawn piece's rim would score as half paint; its core does not, while a piece drawn off
// its paint or around it (a loose outline) still loses its core.
// These are estimates from imagery, not survey data.
//
// Run from frontend/ after editing either markings file:
//   bun scripts/campus-model/bake/markings-gate.mjs [--masks out.png]
// `--masks` also writes the three masks over the sheet window (red white, green yellow, blue blue) for inspection.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT, metres, modelToGeo } from "../lib/frame.mjs";
import { segmentDistance } from "../lib/geometry.mjs";
import { openSheet } from "../lib/ngiiSheet.mjs";
import { encodePng } from "../lib/png.mjs";
import { SUPPORT_STEP_M, gridPoints, markingCandidates } from "../stages/markings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(HERE, "..", "data", "photo", "markings-gate.json");
const MARGIN_M = 10;

const PAINT_OPEN_M = 1.5;
const WHITE_TOPHAT = 20;
const WHITE_SPREAD = 60;
const YELLOW_TOPHAT = 12;
const YELLOW_MIN = 14;
const YELLOW_CHROMA = 0.12;
const YELLOW_RB = 14;
const YELLOW_GR = 0.72;
const BLUE_TOPHAT = 15;
const BLUE_AREA = 30;
const BLUE_BR = 45;
const BLUE_GREY = 80;
const WHITE_TOPHAT_RAW = 8;
const SHADOW_SURFACE = 68;
const SHADOW_RED = 30;
const SHADOW_REFERENCE = 105;
const SHADOW_GAIN = 2;
const HALF_MAX = 0.5;
const PEAK_REACH_M = 0.5;
const CORE_M = 0.1;

// ---------------------------------------------------------------- EPSG:5186 (Korea 2000 / Central Belt 2010)
// Transverse Mercator on GRS80, origin 38 N 127 E, scale 1, false easting 200 000 m, false northing 600 000 m
// (Snyder 1987, eq. 8-9 to 8-10; well under a millimetre this close to the central meridian).
const A_AXIS = 6378137;
const FLATTENING = 1 / 298.257222101;
const E2 = FLATTENING * (2 - FLATTENING);
const EP2 = E2 / (1 - E2);
const LAT0 = (38 * Math.PI) / 180;
const LON0 = (127 * Math.PI) / 180;
const meridian = (phi) => A_AXIS * (
  (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi
  - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi)
  + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi)
  - ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
const M0 = meridian(LAT0);
function toKorea2000(lon, lat) {
  const phi = (lat * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const n = A_AXIS / Math.sqrt(1 - E2 * sin * sin);
  const t = (sin / cos) ** 2;
  const c = EP2 * cos * cos;
  const a = ((lon * Math.PI) / 180 - LON0) * cos;
  const east = 200000 + n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120);
  const north = 600000 + meridian(phi) - M0 + n * (sin / cos) * (a * a / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24
    + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720);
  return [east, north];
}

// ---------------------------------------------------------------- the sheet
// Window of the sheet over EXTENT + MARGIN_M: RGB bytes, and the sheet pixel (integer = pixel centre) of a model point.
async function readSheet() {
  const sheet = openSheet();
  const { width, height } = sheet;
  const { a, d: e, c, f } = sheet.tfw;
  const toPixel = (x, z) => {
    const [east, north] = toKorea2000(...modelToGeo(x, z));
    return [(east - c) / a, (north - f) / e];
  };
  const corners = [[EXTENT.minX, EXTENT.minZ], [EXTENT.maxX, EXTENT.minZ], [EXTENT.minX, EXTENT.maxZ], [EXTENT.maxX, EXTENT.maxZ]].map(([x, z]) => toPixel(x, z));
  const margin = MARGIN_M / a;
  const col0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0])) - margin));
  const row0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1])) - margin));
  const col1 = Math.min(width - 1, Math.ceil(Math.max(...corners.map((p) => p[0])) + margin));
  const row1 = Math.min(height - 1, Math.ceil(Math.max(...corners.map((p) => p[1])) + margin));
  const w = col1 - col0 + 1;
  const h = row1 - row0 + 1;
  const rgb = sheet.readWindow(col0, row0, w, h);
  sheet.close();
  return { rgb, width: w, height: h, toPixel: (x, z) => { const [u, v] = toPixel(x, z); return [u - col0, v - row0]; }, metresPerPixel: a };
}

// ---------------------------------------------------------------- paint masks
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

function paintMasks({ rgb, width, height, metresPerPixel }) {
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

// ---------------------------------------------------------------- bake
const started = performance.now();
const sheet = await readSheet();
const masks = paintMasks(sheet);
const { candidates } = await markingCandidates();
const at = (mask, u, v) => {
  const { width, height } = sheet;
  const fx = Math.min(width - 1.001, Math.max(0, u));
  const fy = Math.min(height - 1.001, Math.max(0, v));
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const k = iy * width + ix;
  return (mask[k] * (1 - tx) + mask[k + 1] * tx) * (1 - ty) + (mask[k + width] * (1 - tx) + mask[k + width + 1] * tx) * ty;
};
// Grid points of a piece at least CORE_M inside its outline (or half the piece's largest inner distance).
function corePoints(rings) {
  const points = gridPoints(rings, metres(SUPPORT_STEP_M));
  const depth = points.map((p) => Math.min(...rings.flatMap((ring) => ring.map((q, i) => segmentDistance(p, q, ring[(i + 1) % ring.length])))));
  const floor = Math.min(metres(CORE_M), Math.max(...depth) / 2);
  return points.filter((_, i) => depth[i] >= floor);
}

const COLOURS = ["white", "yellow", "blue"];
const supports = {};
for (const c of candidates) {
  const sums = [0, 0, 0];
  let n = 0;
  for (const rings of c.shapes) {
    for (const [x, z] of corePoints(rings)) {
      const [u, v] = sheet.toPixel(x, z);
      n += 1;
      COLOURS.forEach((colour, k) => { sums[k] += at(masks[colour], u, v); });
    }
  }
  supports[c.id] = [...sums.map((sum) => Math.round((sum / n) * 1000) / 1000), c.fingerprint];
  if (c.single) {
    const single = [0, 0, 0];
    let m = 0;
    for (const rings of c.single) {
      for (const [x, z] of corePoints(rings)) {
        const [u, v] = sheet.toPixel(x, z);
        m += 1;
        COLOURS.forEach((colour, k) => { single[k] += at(masks[colour], u, v); });
      }
    }
    supports[c.id].push(...single.map((sum) => Math.round((sum / m) * 1000) / 1000));
  }
}
const previous = await Bun.file(OUTPUT).exists() ? JSON.parse(await Bun.file(OUTPUT).text()) : {};
const gate = {
  source: "NGII 2025 orthophoto sheet 34702020 (0.25 m GSD, EPSG:5186), 국토지리정보원; bake/markings-gate.mjs",
  generated: new Date().toISOString().slice(0, 10),
  method: "share of each candidate's drawn area on white, yellow and blue photo paint (top-hat masks): [white, yellow, blue, geometry fingerprint(, single-line white, yellow, blue)]",
  thresholds: { PAINT_OPEN_M, WHITE_TOPHAT, WHITE_TOPHAT_RAW, WHITE_SPREAD, YELLOW_TOPHAT, YELLOW_MIN, YELLOW_CHROMA, YELLOW_RB, YELLOW_GR, BLUE_TOPHAT, BLUE_AREA, BLUE_BR, BLUE_GREY, SHADOW_SURFACE, SHADOW_RED, SHADOW_REFERENCE, SHADOW_GAIN, HALF_MAX, PEAK_REACH_M, CORE_M, SUPPORT_STEP_M },
  review: previous.review ?? {},
  supports,
};
await Bun.write(OUTPUT, `${JSON.stringify(gate, null, 0).replace(/\],"/g, '],\n"')}\n`);
const maskPath = process.argv.includes("--masks") ? process.argv[process.argv.indexOf("--masks") + 1] : null;
if (maskPath) {
  const image = new Uint8Array(sheet.width * sheet.height * 3);
  for (let p = 0; p < sheet.width * sheet.height; p += 1) {
    image[p * 3] = masks.white[p] * 255;
    image[p * 3 + 1] = masks.yellow[p] * 255;
    image[p * 3 + 2] = masks.blue[p] * 255;
  }
  await Bun.write(maskPath, encodePng(sheet.width, sheet.height, 3, image));
}
console.log(`markings gate: ${candidates.length} candidates measured on a ${sheet.width}x${sheet.height} sheet window in ` +
  `${((performance.now() - started) / 1000).toFixed(1)} s; written ${path.relative(process.cwd(), OUTPUT)}${maskPath ? `, masks ${maskPath}` : ""}`);

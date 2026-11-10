#!/usr/bin/env bun
// Paint gate bake for the road markings (stages/markings.mjs).
//
// For every marking candidate the stage would draw (markingCandidates(): markings.geojson with the corrections of
// markings-extra.geojson applied, plus markings-extra.geojson), this measures the share of its drawn area that the
// NGII 2025 orthophoto shows as white, yellow and blue paint, and writes data/photo/evidence/markings-gate.json:
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
// `--rebase-review <old-candidates.json>` (a JSON array of [id, fingerprint, colour, shapes] from markingCandidates()
// before a frame move) re-stamps a review entry with the current fingerprint only when its candidate is the one it
// was judged at (old fingerprint equal) and every vertex moved by one and the same vector (a pure frame translation,
// e.g. Frame v2); any other change keeps the old fingerprint, so the stage still asks for a new review.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT, metres, modelToGeo } from "../lib/frame.mjs";
import { segmentDistance } from "../lib/geometry.mjs";
import { openSheet } from "../lib/ngiiSheet.mjs";
import { encodePng } from "../lib/png.mjs";
import { BLUE_AREA, BLUE_BR, BLUE_GREY, BLUE_TOPHAT, HALF_MAX, PAINT_OPEN_M, PEAK_REACH_M, SHADOW_GAIN, SHADOW_RED, SHADOW_REFERENCE, SHADOW_SURFACE, WHITE_SPREAD, WHITE_TOPHAT, WHITE_TOPHAT_RAW, YELLOW_CHROMA, YELLOW_GR, YELLOW_MIN, YELLOW_RB, YELLOW_TOPHAT, paintMasks } from "../lib/paintMasks.mjs";
import { PAINT_BEYOND_EXTENT, SUPPORT_STEP_M, gridPoints, markingCandidates } from "../fit/markingEvidence.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(HERE, "..", "data", "photo", "evidence", "markings-gate.json");
const MARGIN_M = 10;

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
  // EXTENT and the traced paint beyond it (stages/markings.mjs PAINT_BEYOND_EXTENT)
  const [minX, minZ] = [Math.min(EXTENT.minX, PAINT_BEYOND_EXTENT.minX), Math.min(EXTENT.minZ, PAINT_BEYOND_EXTENT.minZ)];
  const [maxX, maxZ] = [Math.max(EXTENT.maxX, PAINT_BEYOND_EXTENT.maxX), Math.max(EXTENT.maxZ, PAINT_BEYOND_EXTENT.maxZ)];
  const corners = [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ]].map(([x, z]) => toPixel(x, z));
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
function rebaseReview(review) {
  const at = process.argv.indexOf("--rebase-review");
  if (at < 0) return review;
  const old = new Map(JSON.parse(readFileSync(process.argv[at + 1], "utf8")).map((c) => [c[0], c]));
  const now = new Map(candidates.map((c) => [c.id, c]));
  let moved = 0;
  let shift = null;
  const out = {};
  for (const [id, entry] of Object.entries(review)) {
    out[id] = entry;
    const before = old.get(id);
    const after = now.get(id);
    if (!before || !after || before[1] !== entry.fingerprint || before[2] !== after.colour) continue;
    const a = before[3].flat(2);
    const b = after.shapes.flat(2);
    if (a.length !== b.length || !a.length) continue;
    const d = [b[0][0] - a[0][0], b[0][1] - a[0][1]];
    if (!a.every((p, i) => Math.abs(b[i][0] - p[0] - d[0]) < 1e-6 && Math.abs(b[i][1] - p[1] - d[1]) < 1e-6)) continue;
    if (shift && (Math.abs(shift[0] - d[0]) > 1e-6 || Math.abs(shift[1] - d[1]) > 1e-6)) throw new Error(`--rebase-review: ${id} moved by ${d}, not the common shift ${shift}`);
    shift = d;
    out[id] = { ...entry, fingerprint: after.fingerprint };
    moved += 1;
  }
  console.log(`markings gate: ${moved} of ${Object.keys(review).length} review entries re-stamped after a pure translation by ${shift ? shift.map((v) => v.toFixed(3)).join(", ") : "-"} model units`);
  return out;
}
const previous = await Bun.file(OUTPUT).exists() ? JSON.parse(await Bun.file(OUTPUT).text()) : {};
const gate = {
  source: "NGII 2025 orthophoto sheet 34702020 (0.25 m GSD, EPSG:5186), 국토지리정보원; bake/markings-gate.mjs",
  generated: new Date().toISOString().slice(0, 10),
  method: "share of each candidate's drawn area on white, yellow and blue photo paint (top-hat masks): [white, yellow, blue, geometry fingerprint(, single-line white, yellow, blue)]",
  thresholds: { PAINT_OPEN_M, WHITE_TOPHAT, WHITE_TOPHAT_RAW, WHITE_SPREAD, YELLOW_TOPHAT, YELLOW_MIN, YELLOW_CHROMA, YELLOW_RB, YELLOW_GR, BLUE_TOPHAT, BLUE_AREA, BLUE_BR, BLUE_GREY, SHADOW_SURFACE, SHADOW_RED, SHADOW_REFERENCE, SHADOW_GAIN, HALF_MAX, PEAK_REACH_M, CORE_M, SUPPORT_STEP_M },
  review: rebaseReview(previous.review ?? {}),
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

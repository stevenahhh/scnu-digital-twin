// VWorld Satellite orthophoto for the roof colours and the road-marking photo checks (the ground no longer bakes it:
// plan uhf-ground-roads-routing todo 10, the ground is modelled surfaces).
//
// data/ortho/vworld-satellite-z19.jpg is the z19 WMTS tile mosaic (Web Mercator, 256 px tiles) as fetched by
// fetch/ortho.mjs, and vworld-satellite-z19.json its tile range. The tiles are stored and baked with the
// project owner's consent of 2026-10-24 (docs/data-licences.md, D1); the API key is never written anywhere.
//
// modelToGeo is affine per axis (longitude from x only, latitude from z only), so a model point maps to a
// mosaic column through x alone and to a mosaic row through z alone; samplers precompute both per raster.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT, SCENE_UNITS_PER_METRE, modelToGeo } from "./frame.mjs";
import { decodePng } from "./png.mjs";

export const ORTHO_ZOOM = 19;
export const ORTHO_TILE = 256;
export const ORTHO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "ortho");
export const ORTHO_IMAGE = path.join(ORTHO_DIR, "vworld-satellite-z19.jpg");
export const ORTHO_META = path.join(ORTHO_DIR, "vworld-satellite-z19.json");

const worldSize = (zoom) => ORTHO_TILE * 2 ** zoom;
export const lonToWorldPixel = (lon, zoom = ORTHO_ZOOM) => ((lon + 180) / 360) * worldSize(zoom);
export const latToWorldPixel = (lat, zoom = ORTHO_ZOOM) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * worldSize(zoom);
};

// Tiles covering EXTENT at `zoom`: inclusive tile indices.
export function orthoTileRange(zoom = ORTHO_ZOOM) {
  const [west, north] = modelToGeo(EXTENT.minX, EXTENT.minZ);
  const [east, south] = modelToGeo(EXTENT.maxX, EXTENT.maxZ);
  return {
    zoom,
    x0: Math.floor(lonToWorldPixel(west, zoom) / ORTHO_TILE),
    x1: Math.floor(lonToWorldPixel(east, zoom) / ORTHO_TILE),
    y0: Math.floor(latToWorldPixel(north, zoom) / ORTHO_TILE),
    y1: Math.floor(latToWorldPixel(south, zoom) / ORTHO_TILE),
  };
}

// The committed mosaic as RGB bytes plus its frame: col(x) / row(z) give fractional mosaic pixel coordinates
// (pixel centres at .5) of a model point, metresPerPixel the ground size of one mosaic pixel at the campus.
export async function loadOrtho() {
  const meta = JSON.parse(await Bun.file(ORTHO_META).text());
  const png = decodePng(await Bun.file(ORTHO_IMAGE).image().png().toBuffer());
  const { width, height, channels } = png;
  if (width !== (meta.x1 - meta.x0 + 1) * ORTHO_TILE || height !== (meta.y1 - meta.y0 + 1) * ORTHO_TILE) {
    throw new Error(`ortho mosaic is ${width}x${height}, its tile range ${JSON.stringify(meta)} needs another size`);
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0, q = 0; p < width * height; p += 1, q += channels) {
    rgb[p * 3] = png.pixels[q];
    rgb[p * 3 + 1] = png.pixels[q + 1];
    rgb[p * 3 + 2] = png.pixels[q + 2];
  }
  const originX = meta.x0 * ORTHO_TILE;
  const originY = meta.y0 * ORTHO_TILE;
  const col = (x) => lonToWorldPixel(modelToGeo(x, 0)[0], meta.zoom) - originX;
  const row = (z) => latToWorldPixel(modelToGeo(0, z)[1], meta.zoom) - originY;
  const metresPerPixel = 1 / ((col(EXTENT.minX + SCENE_UNITS_PER_METRE * 100) - col(EXTENT.minX)) / 100);
  return { width, height, rgb, meta, col, row, metresPerPixel };
}

// Bilinear RGB sample at fractional mosaic coordinates (u, v), pixel centres at .5; clamped at the border.
export function sampleOrtho(ortho, u, v, out = [0, 0, 0]) {
  const fx = Math.min(ortho.width - 1.001, Math.max(0, u - 0.5));
  const fy = Math.min(ortho.height - 1.001, Math.max(0, v - 0.5));
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const a = (iy * ortho.width + ix) * 3;
  const b = a + 3;
  const c = a + ortho.width * 3;
  const d = c + 3;
  const { rgb } = ortho;
  for (let ch = 0; ch < 3; ch += 1) {
    out[ch] = (rgb[a + ch] * (1 - tx) + rgb[b + ch] * tx) * (1 - ty) + (rgb[c + ch] * (1 - tx) + rgb[d + ch] * tx) * ty;
  }
  return out;
}

// ---------------------------------------------------------------- colour calibration and photo classes
// (moved here with the removal of the photo ground composite; used by the roof colours, stages/sources.mjs and the
// markings checks)
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const LINEAR_STEPS = 4095;
const LINEAR_TO_SRGB = Uint8Array.from({ length: LINEAR_STEPS + 1 }, (_, i) => {
  const v = i / LINEAR_STEPS;
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
});
const toLinear = (c) => SRGB_TO_LINEAR[Math.max(0, Math.min(255, Math.round(c)))];
const toSrgb = (v) => LINEAR_TO_SRGB[Math.round((v <= 0 ? 0 : v >= 1 ? 1 : v) * LINEAR_STEPS)];
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---------------------------------------------------------------- colour calibration
// White-balance reference: photo pixels at least WB_MIN_LUMA bright whose channels differ by at most
// WB_MAX_SPREAD (sRGB) and are not clipped. Albedo: the mosaic's tone curve keeps white membranes near their
// albedo (linear about 0.7) but crushes mid-tones (lawn 0.07, asphalt 0.09, concrete paving 0.14 in linear
// light, against typical albedos of about 0.2, 0.15 and 0.3), so after the white balance the linear value is
// lifted by the power 1 / ALBEDO_GAMMA (ASSUMED 1.5: lawn 0.17, asphalt 0.20, paving 0.27, membranes 0.77; checked
// with scripts/perf/compare-satellite.mjs at noon). These are estimates, not measured albedos.
const WB_MIN_LUMA = 170;
const WB_MAX_SPREAD = 36;
const ALBEDO_GAMMA = 1.5;

export function photoCalibration(ortho) {
  const picks = [[], [], []];
  const { rgb } = ortho;
  for (let i = 0; i < rgb.length; i += 3 * 7) {
    const r = rgb[i];
    const g = rgb[i + 1];
    const b = rgb[i + 2];
    if (luma(r, g, b) >= WB_MIN_LUMA && Math.max(r, g, b) - Math.min(r, g, b) <= WB_MAX_SPREAD && Math.max(r, g, b) < 250) {
      picks[0].push(r);
      picks[1].push(g);
      picks[2].push(b);
    }
  }
  if (picks[0].length < 1000) throw new Error(`ortho white balance: only ${picks[0].length} bright neutral pixels`);
  const reference = picks.map((values) => values.sort((a, b) => a - b)[values.length >> 1]);
  const linear = reference.map(toLinear);
  const mean = (linear[0] + linear[1] + linear[2]) / 3;
  const gains = linear.map((v) => mean / v);
  // Linear photo value -> linear albedo estimate, and raw photo sRGB -> albedo sRGB, per channel.
  const albedo = (value, channel) => Math.min(1, Math.max(0, value * gains[channel])) ** (1 / ALBEDO_GAMMA);
  const lut = gains.map((_, channel) => Uint8Array.from({ length: 256 }, (__, c) => toSrgb(albedo(SRGB_TO_LINEAR[c], channel))));
  return { reference, gains, gamma: ALBEDO_GAMMA, samples: picks[0].length, lut, albedo, calibrate: (c, channel) => lut[channel][Math.max(0, Math.min(255, Math.round(c)))] };
}

// ---------------------------------------------------------------- photo classes (raw mosaic values)
// Vegetation: normalised excess green (2G - R - B) / (R + G + B) above VEG_EXG (lawn about 0.26, crowns 0.32,
// pavers 0.10, asphalt 0.09, roofs 0.03 in this mosaic). Cast shadow: the mosaic's red channel drops to
// almost 0 in shadow (asphalt 64 lit, 7 in shadow) while haze keeps green and blue up, so the shadow weight
// ramps from 0 at SHADOW_RED[1] / SHADOW_LUMA[1] to 1 at SHADOW_RED[0] / SHADOW_LUMA[0].
export const VEG_EXG = 0.15;
const SHADOW_RED = [14, 30];
const SHADOW_LUMA = [48, 72];
export const excessGreen = (r, g, b) => (2 * g - r - b) / (r + g + b + 1);
export function shadowWeight(r, g, b) {
  const red = (SHADOW_RED[1] - r) / (SHADOW_RED[1] - SHADOW_RED[0]);
  const dark = (SHADOW_LUMA[1] - luma(r, g, b)) / (SHADOW_LUMA[1] - SHADOW_LUMA[0]);
  return Math.max(0, Math.min(1, red)) * Math.max(0, Math.min(1, dark));
}

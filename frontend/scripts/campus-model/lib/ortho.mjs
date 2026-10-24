// VWorld Satellite orthophoto for the ground albedo and the roof colours.
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

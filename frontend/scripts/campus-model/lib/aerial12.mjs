// Reader for the 순천시 airmap 12 cm aerial tiles (gis.suncheon.go.kr/gs-gate/airmap WMS, keyless, EPSG:5186), the
// cross-check source of design §9. Used with the owner's consent of 2026-11-02 (docs/data-licences.md, D3): the
// tiles stay under .cache/suncheon-12cm/<epoch>/ (gitignored); only derived numbers are committed.
//
// Tile layout (as fetched): 1000 x 1000 px JPEG, 0.125 m/px, tile (i, j) covers E0 = 243575 + 125 i,
// N1 = 264090 - 125 j. The WMS BBOX edges are pixel corners, so pixel (col, row) has its centre at
// (E0 + (col + 0.5) * 0.125, N1 - (row + 0.5) * 0.125). tileOf() returns corner-based fractional coordinates.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const AERIAL12_DIR = process.env.SUNCHEON_12CM_DIR ?? path.join(HERE, "..", ".cache", "suncheon-12cm");
export const AERIAL12_EPOCH = "2024_12cm";
export const AERIAL12_GRID = Object.freeze({ E0: 243575, N1: 264090, tileM: 125, tilePx: 1000, mpp: 0.125, cols: 6, rows: 6 });

export function tileBounds(i, j, grid = AERIAL12_GRID) {
  const E0 = grid.E0 + grid.tileM * i;
  const N1 = grid.N1 - grid.tileM * j;
  return { E0, N1, E1: E0 + grid.tileM, N0: N1 - grid.tileM };
}

// Tile indices and corner-based fractional pixel coordinates of an EPSG:5186 point (null outside the grid).
export function tileOf(E, N, grid = AERIAL12_GRID) {
  const i = Math.floor((E - grid.E0) / grid.tileM);
  const j = Math.floor((grid.N1 - N) / grid.tileM);
  if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return null;
  const { E0, N1 } = tileBounds(i, j, grid);
  return { i, j, col: (E - E0) / grid.mpp, row: (N1 - N) / grid.mpp };
}

// Opens one epoch. Returns null (no throw) when the directory or its tiles are absent, so callers can record the
// source as available:false. Tiles are decoded lazily to luminance and kept in memory.
export function openAerial12({ dir = AERIAL12_DIR, epoch = AERIAL12_EPOCH, grid = AERIAL12_GRID } = {}) {
  const folder = path.join(dir, epoch);
  if (!existsSync(folder)) return null;
  const present = new Set(readdirSync(folder).filter((f) => /^t-\d+-\d+\.jpg$/.test(f)));
  if (present.size === 0) return null;
  const tiles = new Map();
  async function tile(i, j) {
    const key = `${i}-${j}`;
    if (tiles.has(key)) return tiles.get(key);
    let lum = null;
    if (present.has(`t-${key}.jpg`)) {
      const { decodePng } = await import("./png.mjs");
      const png = decodePng(await Bun.file(path.join(folder, `t-${key}.jpg`)).image().png().toBuffer());
      if (png.width !== grid.tilePx || png.height !== grid.tilePx) throw new Error(`${folder}/t-${key}.jpg is ${png.width}x${png.height}, expected ${grid.tilePx}`);
      lum = new Float32Array(png.width * png.height);
      for (let p = 0, q = 0; p < lum.length; p += 1, q += png.channels) lum[p] = 0.299 * png.pixels[q] + 0.587 * png.pixels[q + 1] + 0.114 * png.pixels[q + 2];
    }
    tiles.set(key, lum);
    return lum;
  }
  // Bilinear luminance at an EPSG:5186 point; NaN outside the grid or on a missing tile.
  async function lumAt(E, N) {
    const t = tileOf(E, N, grid);
    if (!t) return NaN;
    const lum = await tile(t.i, t.j);
    if (!lum) return NaN;
    const n = grid.tilePx;
    const fx = Math.min(n - 1.001, Math.max(0, t.col - 0.5));
    const fy = Math.min(n - 1.001, Math.max(0, t.row - 0.5));
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const at = (x, y) => lum[y * n + x];
    return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
  }
  return { dir: folder, epoch, grid, tileCount: present.size, lumAt };
}

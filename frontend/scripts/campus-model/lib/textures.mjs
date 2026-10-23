// Procedural facade and roof textures. Facade atlases are 4 bays x 4 floors so the lit-window
// pattern does not visibly repeat every bay; UVs in the build script count atlas repeats.
import { encodePng } from "./png.mjs";
import { Raster, hashNoise, mulberry32, smoothNoise } from "./raster.mjs";

export const FACADE_BAYS = 4;
export const FACADE_FLOORS = 4;
const TILE = 128;
const SIZE = TILE * FACADE_BAYS;

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const tint = ([r, g, b], k) => [clamp(r * k), clamp(g * k), clamp(b * k)];

function rect(raster, x0, y0, x1, y1, shade) {
  for (let y = Math.max(0, y0); y < Math.min(raster.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(raster.width, x1); x += 1) raster.set(x, y, shade(x, y));
  }
}

function glassShade(seedX, seedY, base) {
  return (x, y) => {
    const sky = 1.08 - (y % TILE) / TILE * 0.25;
    const n = 0.94 + hashNoise(seedX, seedY, 7) * 0.12;
    return tint(base, sky * n);
  };
}

// windows: (raster, emissive, bx, by, rng) draws one bay; wall: (x, y) -> colour.
function facadeAtlas({ wall, windows, seed }) {
  const color = new Raster(SIZE, SIZE);
  const emissive = new Raster(SIZE, SIZE);
  rect(color, 0, 0, SIZE, SIZE, wall);
  const rng = mulberry32(seed);
  for (let by = 0; by < FACADE_FLOORS; by += 1) {
    for (let bx = 0; bx < FACADE_BAYS; bx += 1) windows(color, emissive, bx * TILE, by * TILE, rng, bx, by);
  }
  return {
    color: encodePng(SIZE, SIZE, 3, color.data),
    emissive: encodePng(SIZE, SIZE, 3, emissive.data),
  };
}

const LIT = [255, 214, 150];
const LIT_COOL = [210, 228, 255];

function litRect(emissive, x0, y0, x1, y1, rng, chance = 0.45) {
  if (rng() > chance) return;
  const colour = rng() < 0.75 ? LIT : LIT_COOL;
  const k = 0.65 + rng() * 0.35;
  rect(emissive, x0, y0, x1, y1, () => tint(colour, k));
}

export function concreteRibbonFacade() {
  const base = [214, 210, 202];
  return facadeAtlas({
    seed: 11,
    wall: (x, y) => tint(base, 0.95 + smoothNoise(x, y, 24, 3) * 0.08),
    windows(color, emissive, x0, y0, rng, bx, by) {
      // continuous ribbon window with mullions; slab band below
      const top = y0 + 30;
      const bottom = y0 + 92;
      rect(color, x0, top, x0 + TILE, bottom, glassShade(bx, by, [92, 112, 128]));
      for (let m = 0; m <= 4; m += 1) rect(color, x0 + m * 32 - 2, top, x0 + m * 32 + 2, bottom, () => [168, 170, 172]);
      rect(color, x0, bottom, x0 + TILE, bottom + 6, () => [190, 186, 178]);
      for (let m = 0; m < 4; m += 1) litRect(emissive, x0 + m * 32 + 3, top + 2, x0 + m * 32 + 30, bottom - 2, rng, 0.4);
    },
  });
}

export function brickPunchedFacade() {
  const brick = [150, 88, 64];
  return facadeAtlas({
    seed: 23,
    wall: (x, y) => {
      const row = Math.floor(y / 8);
      const offset = row % 2 ? 12 : 0;
      const mortar = y % 8 === 0 || (x + offset) % 24 === 0;
      if (mortar) return [196, 188, 174];
      const k = 0.86 + hashNoise(Math.floor((x + offset) / 24), row, 5) * 0.24;
      return tint(brick, k);
    },
    windows(color, emissive, x0, y0, rng, bx, by) {
      for (const wx of [14, 70]) {
        rect(color, x0 + wx - 4, y0 + 30, x0 + wx + 48, y0 + 98, () => [232, 230, 222]);
        rect(color, x0 + wx, y0 + 34, x0 + wx + 44, y0 + 94, glassShade(bx * 2 + wx, by, [70, 92, 110]));
        rect(color, x0 + wx + 20, y0 + 34, x0 + wx + 24, y0 + 94, () => [225, 225, 220]);
        rect(color, x0 + wx - 6, y0 + 98, x0 + wx + 50, y0 + 103, () => [205, 200, 190]);
        litRect(emissive, x0 + wx, y0 + 34, x0 + wx + 44, y0 + 94, rng);
      }
    },
  });
}

export function beigePunchedFacade() {
  const base = [222, 206, 176];
  return facadeAtlas({
    seed: 37,
    wall: (x, y) => tint(base, 0.94 + smoothNoise(x, y, 30, 9) * 0.1),
    windows(color, emissive, x0, y0, rng, bx, by) {
      rect(color, x0 + 10, y0 + 28, x0 + 118, y0 + 96, () => [120, 112, 100]);
      rect(color, x0 + 13, y0 + 31, x0 + 115, y0 + 93, glassShade(bx, by, [84, 104, 120]));
      for (const m of [47, 81]) rect(color, x0 + m, y0 + 31, x0 + m + 3, y0 + 93, () => [200, 196, 188]);
      rect(color, x0, y0 + 112, x0 + TILE, y0 + 118, () => [196, 182, 156]);
      litRect(emissive, x0 + 13, y0 + 31, x0 + 115, y0 + 93, rng);
    },
  });
}

export function glassCurtainFacade() {
  return facadeAtlas({
    seed: 41,
    wall: () => [150, 158, 166],
    windows(color, emissive, x0, y0, rng, bx, by) {
      rect(color, x0, y0 + 4, x0 + TILE, y0 + 124, glassShade(bx, by, [74, 108, 136]));
      for (let m = 0; m <= 2; m += 1) rect(color, x0 + m * 64 - 2, y0, x0 + m * 64 + 2, y0 + TILE, () => [176, 182, 188]);
      rect(color, x0, y0 + 120, x0 + TILE, y0 + TILE, () => [120, 128, 136]);
      for (let m = 0; m < 2; m += 1) litRect(emissive, x0 + m * 64 + 3, y0 + 6, x0 + m * 64 + 62, y0 + 118, rng, 0.5);
    },
  });
}

export function greenhouseFacade() {
  return facadeAtlas({
    seed: 53,
    wall: () => [226, 234, 232],
    windows(color, emissive, x0, y0, rng, bx, by) {
      rect(color, x0 + 3, y0 + 3, x0 + TILE - 3, y0 + TILE - 3, glassShade(bx, by, [196, 220, 216]));
      rect(color, x0 + 62, y0, x0 + 66, y0 + TILE, () => [238, 240, 238]);
      rect(color, x0, y0 + 62, x0 + TILE, y0 + 66, () => [238, 240, 238]);
    },
  });
}

export function roofTexture() {
  const size = 256;
  const raster = new Raster(size, size);
  rect(raster, 0, 0, size, size, (x, y) => {
    const seam = x % 64 === 0 || y % 64 === 0;
    const k = 0.92 + smoothNoise(x, y, 18, 4) * 0.12 + (seam ? -0.12 : 0);
    return tint([168, 170, 168], k);
  });
  return encodePng(size, size, 3, raster.data);
}

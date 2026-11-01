// Procedural roof and rooftop-equipment textures, and the detail-map builder the facade atlas (lib/facadeAtlas.mjs)
// shares with them.
//
// Every painted texture gets detail maps on the same UVs: a tangent-space normal map (glTF/OpenGL
// convention, +Y up the image) and a packed metallic-roughness map (G = roughness, B = metal,
// R unused because the occlusionTexture slot belongs to the baked AO atlas). They combine the
// painted layout (glass recessed behind frames, sills proud of the wall, membrane seams) with
// CC0 surface relief and roughness from data/materials (Poly Haven, see data/materials/LICENSES.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.mjs";
import { Raster, hashNoise, mulberry32, smoothNoise } from "./raster.mjs";

// The roof texture covers 20 m x 20 m (uvScale 1 / metres(ROOF_METRES) in stages/buildings.mjs) at
// 3.9 cm/px, 8 x 8 membrane sheets of 2.5 m.
export const ROOF_METRES = 20;
const ROOF_SIZE = 512;
const ROOF_SHEETS = 8;

const MATERIALS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "materials");

// Surface kinds painted alongside the colour atlas; detailMaps turns them into relief and roughness.
export const KIND = Object.freeze({ WALL: 0, GLASS: 1, FRAME: 2, SILL: 3, MORTAR: 4, SEAM: 5 });
const { WALL, GLASS, FRAME, SILL, MORTAR, SEAM } = KIND;

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const tint = ([r, g, b], k) => [clamp(r * k), clamp(g * k), clamp(b * k)];

// shade(x, y) -> colour; kind (optional) is recorded in raster.kinds when the raster has one.
function rect(raster, x0, y0, x1, y1, shade, kind) {
  for (let y = Math.max(0, y0); y < Math.min(raster.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(raster.width, x1); x += 1) {
      raster.set(x, y, shade(x, y));
      if (kind !== undefined && raster.kinds) raster.kinds[y * raster.width + x] = kind;
    }
  }
}

// ---------------------------------------------------------------- detail maps
// A CC0 tile from data/materials resampled to `width` x `height` px (one tile repeat), RGBA.
async function loadTile(name, map, width, height) {
  const bytes = readFileSync(path.join(MATERIALS, `${name}-${map}.webp`));
  const decoded = decodePng(await new Bun.Image(bytes).resize(width, height, { fit: "fill" }).png().toBuffer());
  return decoded;
}

// kinds: Uint8Array(width*height) of surface kinds; classes[kind] = { height (m, + towards the
// viewer), roughness, metal, detail (CC0 relief applies) }; tile = { name, metres, strength,
// roughness?, shuffle? } or null. roughness (default 1) scales the tile's roughness contrast.
// shuffle (a seed) gives every tile cell its own rotation/flip and wrap offset of the CC0 tile, so
// the tile no longer repeats in a grid; cells are square and their edges should sit under painted
// joints, where the slope field is discontinuous.
// Returns PNG-encoded { normal, arm }, or the RGB arrays themselves when `encoded` is false.
export async function detailMaps({ width, height, metresX, metresY, kinds, classes, tile, encoded = true }) {
  const dx = metresX / width;
  const dy = metresY / height;
  const at = (x, y) => ((y + height) % height) * width + ((x + width) % width);

  // Painted relief: kind heights, box-blurred once so 1 px steps become 3 px bevels.
  const raw = new Float32Array(width * height);
  for (let i = 0; i < raw.length; i += 1) raw[i] = classes[kinds[i]].height;
  const relief = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let j = -1; j <= 1; j += 1) for (let i = -1; i <= 1; i += 1) sum += raw[at(x + i, y + j)];
      relief[y * width + x] = sum / 9;
    }
  }

  // CC0 relief: the tile repeats a whole number of times across the atlas so the atlas still tiles.
  let detail = null;
  if (tile) {
    const repeatsX = Math.max(1, Math.round(metresX / tile.metres));
    const repeatsY = Math.max(1, Math.round(metresY / tile.metres));
    const tw = Math.round(width / repeatsX);
    const th = Math.round(height / repeatsY);
    const [nor, arm] = await Promise.all([loadTile(tile.name, "nor", tw, th), loadTile(tile.name, "arm", tw, th)]);
    const n = tw * th;
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const rough = new Float32Array(n);
    let meanX = 0;
    let meanY = 0;
    let meanRough = 0;
    for (let k = 0; k < n; k += 1) {
      const o = k * nor.channels;
      const z = Math.max(0.2, nor.pixels[o + 2] / 255 * 2 - 1);
      sx[k] = (nor.pixels[o] / 255 * 2 - 1) / z;
      sy[k] = (nor.pixels[o + 1] / 255 * 2 - 1) / z;
      rough[k] = arm.pixels[k * arm.channels + 1] / 255;
      meanX += sx[k];
      meanY += sy[k];
      meanRough += rough[k];
    }
    meanX /= n;
    meanY /= n;
    meanRough /= n;
    const roughAmount = tile.roughness ?? 1;
    // Tile-mean slope is removed so a tile scanned at a slant does not tilt the whole wall.
    detail = (x, y) => {
      let a = Math.min(tw - 1, Math.floor(x * repeatsX * tw / width) % tw);
      let b = Math.min(th - 1, Math.floor(y * repeatsY * th / height) % th);
      let fx = 1;
      let fy = 1;
      let swap = false;
      if (tile.shuffle !== undefined) {
        // Image-space gradient of the sampled tile is (-sx, sy); flipping an axis negates that
        // component and swapping the axes swaps them, which the slope remap below mirrors.
        const cx = Math.floor(x * repeatsX / width);
        const cy = Math.floor(y * repeatsY / height);
        const t = Math.floor(hashNoise(cx, cy, tile.shuffle) * 8);
        if (t & 1) { a = tw - 1 - a; fx = -1; }
        if (t & 2) { b = th - 1 - b; fy = -1; }
        if (t & 4) { [a, b] = [b, a]; swap = true; }
        a = (a + Math.floor(hashNoise(cx, cy, tile.shuffle + 1) * tw)) % tw;
        b = (b + Math.floor(hashNoise(cx, cy, tile.shuffle + 2) * th)) % th;
      }
      const k = b * tw + a;
      const ux = (sx[k] - meanX) * tile.strength;
      const uy = (sy[k] - meanY) * tile.strength;
      const roughScale = 1 + (rough[k] / meanRough - 1) * roughAmount;
      return swap ? [-fx * uy, -fy * ux, roughScale] : [fx * ux, fy * uy, roughScale];
    };
  }

  const normal = new Uint8Array(width * height * 3);
  const arm = new Uint8Array(width * height * 3);
  const MAX_SLOPE = 2.5;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const surface = classes[kinds[i]];
      // Image rows run down the facade, so "up" (+Y in the normal map) is y - 1.
      let gx = (relief[at(x + 1, y)] - relief[at(x - 1, y)]) / (2 * dx);
      let gy = (relief[at(x, y - 1)] - relief[at(x, y + 1)]) / (2 * dy);
      const g = Math.hypot(gx, gy);
      if (g > MAX_SLOPE) {
        gx *= MAX_SLOPE / g;
        gy *= MAX_SLOPE / g;
      }
      let nx = -gx;
      let ny = -gy;
      let roughness = surface.roughness;
      if (detail && surface.detail) {
        const [ddx, ddy, roughScale] = detail(x, y);
        nx += ddx;
        ny += ddy;
        roughness *= roughScale;
      }
      const length = Math.hypot(nx, ny, 1);
      normal[i * 3] = clamp((nx / length * 0.5 + 0.5) * 255);
      normal[i * 3 + 1] = clamp((ny / length * 0.5 + 0.5) * 255);
      normal[i * 3 + 2] = clamp((1 / length * 0.5 + 0.5) * 255);
      arm[i * 3] = 255;
      arm[i * 3 + 1] = clamp(Math.min(1, Math.max(0.05, roughness)) * 255);
      arm[i * 3 + 2] = clamp(surface.metal * 255);
    }
  }
  if (!encoded) return { normal, arm };
  return { normal: encodePng(width, height, 3, normal), arm: encodePng(width, height, 3, arm) };
}

// Per-kind surface parameters (ASSUMED starting values, BUILD-PLAN U42): glass 0.1 roughness and
// recessed 9 cm behind the wall face, aluminium frames 3 cm behind it, sills and slab bands 3 cm proud.
export function facadeClasses(wallRoughness, wallKind) {
  const wall = { height: 0, roughness: wallRoughness, metal: 0, detail: true };
  const frame = { height: -0.03, roughness: 0.4, metal: 0.6, detail: false };
  return {
    [WALL]: wallKind === FRAME ? { ...frame, height: 0 } : wall,
    [GLASS]: { height: -0.09, roughness: 0.1, metal: 0, detail: false },
    [FRAME]: frame,
    [SILL]: { ...wall, height: 0.03 },
    [MORTAR]: { height: -0.012, roughness: 0.95, metal: 0, detail: true },
  };
}

// Value noise that tiles with period `size` px (size / scale cells per side; scale divides size).
function periodicNoise(x, y, scale, size, seed) {
  const cells = size / scale;
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const sx = (fx - ix) ** 2 * (3 - 2 * (fx - ix));
  const sy = (fy - iy) ** 2 * (3 - 2 * (fy - iy));
  const h = (i, j) => hashNoise(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Rooftop plant and photovoltaic modules share the Roof_Equipment material (stages/buildings.mjs), so a roof with
// panels keeps its draw count. The left half of this atlas is the plant's plain grey-blue metal (the former
// Roof_Equipment factors: linear 0.60 / 0.63 / 0.66, roughness 0.6, metal 0.4), the right half one 60-cell module
// (6 x 10 dark blue cells, light cell gaps, an aluminium frame; ASSUMED look). The packed metallic-roughness map
// (G = roughness, B = metal) gives the cells a glass-like 0.2 / 0 and the frame 0.35 / 0.9. UVs:
// EQUIPMENT_PLAIN_UV for plant, EQUIPMENT_MODULE_UV for a module's top face.
export const EQUIPMENT_PLAIN_UV = [0.25, 0.5];
export const EQUIPMENT_MODULE_UV = [[0.505, 0.99], [0.995, 0.99], [0.995, 0.01], [0.505, 0.01]];
export function equipmentAtlas() {
  const width = 256;
  const height = 128;
  const color = new Raster(width, height);
  const metalRough = new Raster(width, height);
  const frac = (v) => v - Math.floor(v);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < width / 2) {
        color.set(x, y, [203, 207, 211]);
        metalRough.set(x, y, [0, 153, 102]);
        continue;
      }
      const u = x - width / 2;
      const frame = u < 4 || u > 123 || y < 4 || y > 123;
      const cu = ((u - 4) / 120) * 6;
      const cv = ((y - 4) / 120) * 10;
      const gap = frac(cu) < 0.06 || frac(cu) > 0.94 || frac(cv) < 0.05 || frac(cv) > 0.95;
      if (frame) {
        color.set(x, y, [176, 180, 186]);
        metalRough.set(x, y, [0, 89, 230]);
      } else if (gap) {
        color.set(x, y, [118, 126, 138]);
        metalRough.set(x, y, [0, 90, 60]);
      } else {
        color.set(x, y, tint([26, 36, 64], 0.94 + hashNoise(Math.floor(cu), Math.floor(cv), 41) * 0.12));
        metalRough.set(x, y, [0, 51, 0]);
      }
    }
  }
  return { color: encodePng(width, height, 3, color.data), metalRough: encodePng(width, height, 3, metalRough.data) };
}

// Light grey single-ply membrane with raised lap seams every 2.5 m. The satellite comparison
// (qa/compare-G1) shows SCNU roofs light grey to white, so the base is near white; the baked AO
// atlas and the lighting darken it on screen. Against visible tiling from above: the texture spans
// 20 m, every 2.5 m sheet has its own slight tint and its own rotation/offset of the CC0 relief and
// roughness (cut along the seams), a 5 m-scale weathering variation runs across the sheets, and
// stages/buildings.mjs rotates and offsets the roof UVs per building.
export async function roofTexture() {
  const size = ROOF_SIZE;
  const sheet = size / ROOF_SHEETS;
  const raster = new Raster(size, size);
  const kinds = new Uint8Array(size * size);
  rect(raster, 0, 0, size, size, (x, y) => {
    const seam = x % sheet === 0 || y % sheet === 0;
    if (seam) kinds[y * size + x] = SEAM;
    const sheetTint = (hashNoise(Math.floor(x / sheet), Math.floor(y / sheet), 12) - 0.5) * 0.05;
    const k = 0.93 + periodicNoise(x, y, 16, size, 4) * 0.06 + periodicNoise(x, y, 128, size, 5) * 0.07 +
      sheetTint + (seam ? -0.08 : 0);
    return tint([222, 224, 220], k);
  });
  const maps = await detailMaps({
    width: size,
    height: size,
    metresX: ROOF_METRES,
    metresY: ROOF_METRES,
    kinds,
    classes: {
      [WALL]: { height: 0, roughness: 0.95, metal: 0, detail: true },
      [SEAM]: { height: 0.008, roughness: 0.9, metal: 0, detail: false },
    },
    tile: { name: "roof", metres: ROOF_METRES / ROOF_SHEETS, strength: 0.8, roughness: 0.5, shuffle: 31 },
  });
  return { color: encodePng(size, size, 3, raster.data), ...maps };
}

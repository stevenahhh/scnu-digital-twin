#!/usr/bin/env bun
// Generates the tactile paving tile (점형블록) for the Ground_Tactile bands of stages/tactile.mjs:
// data/materials/ground-tactile-col.webp and ground-tactile-nor.webp, one 0.30 m module per tile.
//
// Statute (장애인·노인·임산부 등의 편의증진 보장에 관한 법률 시행규칙 별표 1 제16호): 0.3 x 0.3 m module, 36 domes
// (6 x 6), 6 +- 1 mm high, yellow. The dome pitch (50 mm = 0.30 m / 6) is derived; the dome base diameter DOME_BASE_M
// (35 mm) and the colour #e8c33a with 4 % noise are estimates. The 6 mm relief is encoded in an OpenGL tangent-space
// normal map (+Y up the image). Generated, never downloaded.
//
//   bun scripts/campus-model/bake/tactile-tile.mjs [--size 512]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../lib/png.mjs";
import { hashNoise, smoothNoise } from "../lib/raster.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "data", "materials");
export const MODULE_M = 0.3;
export const DOMES = 6;
export const DOME_HEIGHT_M = 0.006;
export const DOME_BASE_M = 0.035;
const BASE = [0xe8, 0xc3, 0x3a];
const QUALITY = 95;

// Height (metres) of the module surface at local (x, y) metres in [0, MODULE_M).
export function domeHeight(x, y) {
  const pitch = MODULE_M / DOMES;
  const dx = (((x % pitch) + pitch) % pitch) - pitch / 2;
  const dy = (((y % pitch) + pitch) % pitch) - pitch / 2;
  const r = Math.hypot(dx, dy) / (DOME_BASE_M / 2);
  return r >= 1 ? 0 : DOME_HEIGHT_M * Math.sqrt(1 - r * r);
}

export function tactileTile(size) {
  if (!(size >= 64)) throw new Error(`size must be >= 64 (got ${size})`);
  const texel = MODULE_M / size;
  const col = new Uint8Array(size * size * 3);
  const nor = new Uint8Array(size * size * 3);
  const at = (i, j) => domeHeight((i + 0.5) * texel, (j + 0.5) * texel);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const k = (j * size + i) * 3;
      const shade = 0.98 + (hashNoise(i, j, 51) - 0.5) * 0.04 + (smoothNoise(i, j, 24, 52) - 0.5) * 0.04;
      for (let c = 0; c < 3; c += 1) col[k + c] = Math.max(0, Math.min(255, Math.round(BASE[c] * shade)));
      // image rows run down the tile, so "up" (+Y) is j - 1
      const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * texel);
      const gy = (at(i, j - 1) - at(i, j + 1)) / (2 * texel);
      const length = Math.hypot(gx, gy, 1);
      nor[k] = Math.round((-gx / length * 0.5 + 0.5) * 255);
      nor[k + 1] = Math.round((-gy / length * 0.5 + 0.5) * 255);
      nor[k + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
    }
  }
  return { col, nor };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const size = args.includes("--size") ? Number(args[args.indexOf("--size") + 1]) : 512;
  try {
    const { col, nor } = tactileTile(size);
    for (const [map, rgb] of [["col", col], ["nor", nor]]) {
      const file = path.join(OUT, `ground-tactile-${map}.webp`);
      await Bun.write(file, await new Bun.Image(encodePng(size, size, 3, rgb)).webp({ quality: QUALITY }).bytes());
      console.log(`tactile tile: ${path.relative(process.cwd(), file)} ${size}x${size} (${MODULE_M} m module, ${DOMES}x${DOMES} domes, ${DOME_HEIGHT_M * 1000} mm)`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

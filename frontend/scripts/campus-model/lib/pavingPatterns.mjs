// Paving pattern tiles (data/paving-patterns.json): each pattern is drawn as one seamless repeating colour tile and a
// relief (normal) tile from its joints, at PAVING_PX_PER_M. Module colours are picked per module by a hash that wraps at
// the repeat, so the tile tiles without seams; accents replace a module's colour with the given share, `grid` puts a
// small square at every pitch (offset half a pitch), `stripes` paint whole bands across the tile at a pitch. Bonds:
// stack (a grid), running (rows of height moduleM[1], every other row shifted half a module), herringbone (90 degree,
// bricks moduleM[0] = 2 x moduleM[1]). No photo pixel is used; every colour and size is a VR estimate (추정).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PAVING_PATTERNS_FILE = path.join(HERE, "..", "data", "paving-patterns.json");
export const PAVING_PX_PER_M = 80;

let catalogue = null;
export function pavingPattern(id) {
  catalogue ??= JSON.parse(readFileSync(PAVING_PATTERNS_FILE, "utf8")).patterns;
  const pattern = catalogue[id];
  if (!pattern) throw new Error(`data/paving-patterns.json has no pattern ${id}`);
  return pattern;
}

const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const whole = (value, step, what) => {
  const n = value / step;
  if (Math.abs(n - Math.round(n)) > 1e-6) throw new Error(`paving pattern: repeatM ${value} is not a whole number of ${what} ${step}`);
  return Math.round(n);
};
// Deterministic hash of integer cell coordinates -> [0, 1).
function hash(i, j, seed) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pick = (weighted, r) => {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [colour, w] of weighted) {
    acc += w / total;
    if (r < acc) return colour;
  }
  return weighted.at(-1)[0];
};

// Module of a point (metres in the tile): { key: [i, j] wrapped, edge: distance (m) to the module's outline }.
function moduleAt(p, x, y, cols, rows) {
  const [a, b] = p.moduleM;
  const wrap = (v, n) => ((v % n) + n) % n;
  if (p.bond === "herringbone") {
    const w = b;
    const i = Math.floor(x / w);
    const j = Math.floor(y / w);
    const k = wrap(i + j, 4);
    // horizontal brick over cells k = 0, 1 (pairs to the right), vertical over k = 2, 3 (pairs upward)
    const horizontal = k < 2;
    const i0 = horizontal && k === 1 ? i - 1 : i;
    const j0 = !horizontal && k === 3 ? j - 1 : j;
    const [x0, y0, x1, y1] = horizontal ? [i0 * w, j0 * w, (i0 + 2) * w, (j0 + 1) * w] : [i0 * w, j0 * w, (i0 + 1) * w, (j0 + 2) * w];
    return { key: [wrap(i0, cols), wrap(j0, rows) + (horizontal ? 0 : 1000)], edge: Math.min(x - x0, x1 - x, y - y0, y1 - y) };
  }
  const j = Math.floor(y / b);
  const shift = p.bond === "running" && wrap(j, 2) === 1 ? a / 2 : 0;
  const i = Math.floor((x - shift) / a);
  const x0 = i * a + shift;
  return { key: [wrap(i, cols), wrap(j, rows)], edge: Math.min(x - x0, x0 + a - x, y - j * b, (j + 1) * b - y) };
}

// { colour: PNG, normal: PNG, repeatM, size } for a catalogue pattern.
export function pavingTile(id) {
  const p = pavingPattern(id);
  const [a, b] = p.moduleM;
  // cell counts across the tile (herringbone cells are w x w), and the bond's own period
  const cols = whole(p.repeatM, p.bond === "herringbone" ? b : a, "module");
  const rows = whole(p.repeatM, b, "row");
  if (p.bond === "herringbone") whole(p.repeatM, 4 * b, "herringbone period");
  if (p.bond === "running") whole(p.repeatM, 2 * b, "running-bond period");
  if (p.bond === "herringbone" && Math.abs(a - 2 * b) > 1e-9) throw new Error(`paving pattern ${id}: herringbone bricks need moduleM [2w, w]`);
  if (p.grid) whole(p.repeatM, p.grid.pitchM, "grid pitch");
  if (p.stripes) whole(p.repeatM, p.stripes.pitchM, "stripe pitch");
  const size = Math.round(p.repeatM * PAVING_PX_PER_M);
  const base = p.base.map(([c, w]) => [hex(c), w]);
  const accents = (p.accents ?? []).map(([c, share]) => [hex(c), share]);
  const joint = hex(p.joint);
  const half = (p.jointM ?? 0.008) / 2;
  const rgb = new Uint8Array(size * size * 3);
  const height = new Float32Array(size * size);
  const seed = [...id].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) | 0;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = (px + 0.5) / PAVING_PX_PER_M;
      const y = (py + 0.5) / PAVING_PX_PER_M;
      const m = moduleAt(p, x, y, cols, rows);
      let colour;
      let h = 0;
      if (m.edge < half) {
        colour = joint;
        h = -1;
      } else {
        const r = hash(m.key[0], m.key[1], seed);
        let acc = 0;
        colour = null;
        for (const [c, share] of accents) {
          acc += share;
          if (r < acc) { colour = c; break; }
        }
        colour ??= pick(base, (r - acc) / Math.max(1e-9, 1 - acc));
        if (p.stripes && ((y % p.stripes.pitchM) + p.stripes.pitchM) % p.stripes.pitchM < p.stripes.widthM) colour = hex(p.stripes.colour);
        if (p.grid) {
          const g = p.grid.pitchM;
          const dx = Math.abs(((x % g) + g) % g - g / 2);
          const dy = Math.abs(((y % g) + g) % g - g / 2);
          if (dx < p.grid.sizeM / 2 && dy < p.grid.sizeM / 2) colour = hex(p.grid.colour);
        }
        // a little per-texel grain so large modules do not read as flat paint
        const grain = 0.96 + hash(px, py, seed + 1) * 0.08;
        colour = colour.map((c) => c * grain);
        h = (hash(px >> 2, py >> 2, seed + 2) - 0.5) * 0.15;
      }
      const k = (py * size + px) * 3;
      rgb[k] = Math.min(255, colour[0]);
      rgb[k + 1] = Math.min(255, colour[1]);
      rgb[k + 2] = Math.min(255, colour[2]);
      height[py * size + px] = h;
    }
  }
  const normal = new Uint8Array(size * size * 3);
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * 0.5;
      const ny = (at(x, y + 1) - at(x, y - 1)) * 0.5;
      const l = Math.hypot(nx, ny, 1);
      normal.set([Math.round((nx / l * 0.5 + 0.5) * 255), Math.round((ny / l * 0.5 + 0.5) * 255), Math.round((1 / l * 0.5 + 0.5) * 255)], (y * size + x) * 3);
    }
  }
  return { colour: encodePng(size, size, 3, rgb), normal: encodePng(size, size, 3, normal), repeatM: p.repeatM, size, rgb };
}

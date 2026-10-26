// Facade atlas: every building wall in campus-v2.glb is drawn with one material, Facade_Atlas, whose textures hold
// one tile per facade look (data/scnu-facades.json, plus the generic looks for buildings without a curated one).
//
// A tile is TILE_BAYS bays wide and four storey rows tall:
//   row 0, 1  upper storeys (same colours; different lit windows at night)
//   row 2     ground storey; its lowest PLINTH_PX are the plinth band
//   row 3     ground storey with the entrance in its middle two bays (doors, canopy fascia, optional sign plate)
// stages/buildings.mjs cuts every wall into cells of whole bays and whole storeys and maps each cell into one row of
// its look's tile, so the texture never has to wrap. The gutter around a tile repeats the tile's own content (rows
// wrap horizontally; above row 0 lies upper-storey content, below row 3 the plinth), so bilinear filtering and the
// first mip levels never read a neighbouring look.
//
// Texel size: a bay of 3-4 m and a storey of 3-5 m on 56 px, about 6-9 cm per texel. The colour atlas is 2048 px
// wide and as tall as its rows of tiles need; emissive, normal and metallic-roughness maps are half that (window
// glow and relief are soft anyway).
// Colours are sRGB estimates: the SCNU 360 VR tour panoramas (visual reference only) and the VWorld LOD4 facade
// photos (data/lod4-facades.json). They are not measurements.
import { encodePng } from "./png.mjs";
import { Raster, hashNoise, mulberry32, smoothNoise } from "./raster.mjs";
import { KIND, detailMaps, facadeClasses } from "./textures.mjs";

export const ATLAS_SIZE = 2048;
export const TILE_BAYS = 4;
export const BAY_PX = 56;
export const ROW_PX = 56;
export const PLINTH_PX = 5;
export const ROWS = Object.freeze({ UPPER_A: 0, UPPER_B: 1, GROUND: 2, ENTRANCE: 3 });
const TILE_W = TILE_BAYS * BAY_PX;
const TILE_H = 4 * ROW_PX;
const GUTTER = 8;
const SLOT = TILE_W + 2 * GUTTER;
const SLOTS_PER_SIDE = Math.floor(ATLAS_SIZE / SLOT);
export const MAX_LOOKS = SLOTS_PER_SIDE * SLOTS_PER_SIDE;
const NOMINAL_STOREY_METRES = 4.0;

// CC0 relief per wall texture (data/materials, Poly Haven); at 6-9 cm per texel it only adds a soft grain.
const DETAIL = {
  brick: { name: "brick", metres: 1.0, strength: 0.35 },
  render: { name: "beige", metres: 1.5, strength: 0.6 },
  concrete: { name: "concrete", metres: 2.0, strength: 0.7 },
  panel: { name: "concrete", metres: 2.0, strength: 0.35 },
  stone: { name: "concrete", metres: 2.0, strength: 0.5 },
  metal: null,
  glass: null,
};
const ROUGHNESS = { brick: 0.9, render: 0.82, concrete: 0.85, panel: 0.6, stone: 0.7, metal: 0.45, glass: 0.4 };

const LIT = [255, 214, 150];
const LIT_COOL = [210, 228, 255];

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const tint = ([r, g, b], k) => [clamp(r * k), clamp(g * k), clamp(b * k)];
export function hex(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? ""));
  if (!match) throw new Error(`facade colour ${value} is not #rrggbb`);
  return match[1].match(/../g).map((d) => Number.parseInt(d, 16));
}

// Look defaults; data/scnu-facades.json documents every field.
function normalise(look) {
  const wall = hex(look.wall);
  return {
    id: look.id,
    pattern: look.pattern ?? "punched",
    texture: look.texture ?? "render",
    wall,
    trim: look.trim ? hex(look.trim) : tint(wall, 0.85),
    glass: look.glass ? hex(look.glass) : [66, 92, 108],
    frame: look.frame ? hex(look.frame) : [214, 216, 214],
    plinth: look.plinth ? hex(look.plinth) : tint(wall, 0.7),
    spandrel: look.spandrel ? hex(look.spandrel) : null,
    windows: look.windows ?? 1,
    windowsEvery: look.windowsEvery ?? 1,
    windowWidth: look.windowWidth ?? 0.5,
    windowHeight: look.windowHeight ?? 0.45,
    sill: look.sill ?? 0.3,
    mullions: look.mullions ?? 2,
    // punched windows (facades-r4): `panes` vertical panes per window (default 1, 2 when wide), `transom` a horizontal
    // bar at that fraction of the window height from its top, `framePx` frame and mullion width in atlas pixels (1)
    panes: look.panes ?? null,
    transom: look.transom ?? null,
    framePx: look.framePx ?? 1,
    // `lintel` { colour, height }: a band at window-head level across the storey (stone or render heads), like `band` at the floor
    lintel: look.lintel ? { height: look.lintel.height ?? 0.05, colour: hex(look.lintel.colour) } : null,
    spandrelHeight: look.spandrelHeight ?? 0.22,
    piers: look.piers ? { every: look.piers.every ?? 1, width: look.piers.width ?? 0.15, colour: hex(look.piers.colour ?? look.wall) } : null,
    band: look.band ? { height: look.band.height ?? 0.1, colour: hex(look.band.colour) } : null,
    accent: look.accent ? { colour: hex(look.accent.colour), bays: look.accent.bays ?? [1, 2], kind: look.accent.kind ?? "spandrel" } : null,
    ground: look.ground ?? "same",
    entrance: {
      doors: look.entrance?.doors ? hex(look.entrance.doors) : null,
      canopy: hex(look.entrance?.canopy ?? look.trim ?? look.wall),
      sign: look.entrance?.sign ? hex(look.entrance.sign) : null,
    },
    lit: look.lit ?? 0.45,
    seed: [...String(look.id)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7),
  };
}

// ---------------------------------------------------------------- painting
class TileCanvas {
  constructor(color, emissive, kinds, ox, oy) {
    Object.assign(this, { color, emissive, kinds, ox, oy });
  }


  // Tile-local pixel; x wraps around the tile width (rows repeat along a wall), y is clipped to the tile.
  set(x, y, colour, kind) {
    if (y < 0 || y >= TILE_H) return;
    const px = this.ox + (((Math.round(x) % TILE_W) + TILE_W) % TILE_W);
    const py = this.oy + Math.round(y);
    this.color.set(px, py, colour);
    if (kind !== undefined) this.kinds[py * ATLAS_SIZE + px] = kind;
  }

  rect(x0, y0, x1, y1, shade, kind) {
    for (let y = Math.round(y0); y < Math.round(y1); y += 1) {
      for (let x = Math.round(x0); x < Math.round(x1); x += 1) this.set(x, y, shade(x, y), kind);
    }
  }

  glow(x0, y0, x1, y1, colour) {
    for (let y = Math.round(y0); y < Math.round(y1); y += 1) {
      for (let x = Math.round(x0); x < Math.round(x1); x += 1) {
        if (y < 0 || y >= TILE_H) continue;
        this.emissive.set(this.ox + (((x % TILE_W) + TILE_W) % TILE_W), this.oy + y, colour);
      }
    }
  }
}

function wallShade(look) {
  const { wall, texture, seed } = look;
  return (x, y) => {
    let k = 0.97 + smoothNoise(x, y, 14, seed) * 0.05 + (hashNoise(x, y, seed + 1) - 0.5) * 0.025;
    if (texture === "brick") {
      // running-bond courses are about one texel tall here: a soft course stripe and per-brick variation
      k *= (y % 2 ? 0.975 : 1.01) * (0.95 + hashNoise(Math.floor((x + (y % 4 < 2 ? 0 : 1)) / 2), y >> 1, seed + 2) * 0.1);
    } else if (texture === "panel") {
      if (x % (BAY_PX / 2) === 0 || y % (ROW_PX / 2) === 0) k *= 0.9;
    } else if (texture === "stone") {
      const bx = Math.floor(x / (BAY_PX / 3));
      const by = Math.floor(y / (ROW_PX / 3));
      k *= 0.96 + hashNoise(bx, by, seed + 3) * 0.08;
      if (x % (BAY_PX / 3) === 0 || y % (ROW_PX / 3) === 0) k *= 0.92;
    } else if (texture === "metal") {
      k *= x % 3 === 0 ? 0.94 : 1.02;
    } else if (texture === "concrete") {
      k *= 0.95 + smoothNoise(x, y, 5, seed + 4) * 0.08;
    }
    return tint(wall, k);
  };
}

const solid = (colour, seed, amount = 0.03) => (x, y) => tint(colour, 1 - amount / 2 + hashNoise(x, y, seed) * amount);

function glassShade(look, salt) {
  const k0 = 0.94 + hashNoise(salt, 3, look.seed) * 0.12;
  return (_, y) => {
    const sky = 1.12 - ((y % ROW_PX) / ROW_PX) * 0.3;
    return tint(look.glass, sky * k0);
  };
}

// One window: frame border, glass, vertical mullions; lit at night with probability `lit`.
function windowAt(canvas, look, x0, y0, x1, y1, rng, { mullions = 1, lit = look.lit, salt = 0 } = {}) {
  const f = look.framePx ?? 1;
  canvas.rect(x0, y0, x1, y1, solid(look.frame, look.seed + 5), KIND.FRAME);
  canvas.rect(x0 + f, y0 + f, x1 - f, y1 - f, glassShade(look, salt), KIND.GLASS);
  for (let m = 1; m < mullions; m += 1) {
    const mx = x0 + ((x1 - x0) * m) / mullions;
    canvas.rect(mx - f / 2, y0, mx + f / 2 + 0.5, y1, solid(look.frame, look.seed + 6), KIND.FRAME);
  }
  if (look.transom) {
    const ty = y0 + (y1 - y0) * look.transom;
    canvas.rect(x0, ty - f / 2, x1, ty + f / 2 + 0.5, solid(look.frame, look.seed + 6), KIND.FRAME);
  }
  if (rng() < lit) canvas.glow(x0 + f, y0 + f, x1 - f, y1 - f, tint(rng() < 0.75 ? LIT : LIT_COOL, 0.65 + rng() * 0.35));
}

function piers(canvas, look, y0, y1) {
  if (!look.piers) return;
  const width = Math.max(2, look.piers.width * BAY_PX);
  for (let b = 0; b < TILE_BAYS; b += look.piers.every) {
    canvas.rect(b * BAY_PX - width / 2, y0, b * BAY_PX + width / 2, y1, solid(look.piers.colour, look.seed + 7, 0.04), KIND.SILL);
  }
}

// Storey row content in tile-local rows [top, top + ROW_PX); `ground` adds the plinth band and the ground variant.
function paintStorey(canvas, look, top, rng, { ground = false } = {}) {
  const bottom = top + ROW_PX;
  canvas.rect(0, top, TILE_W, bottom, (x, y) => wallShade(look)(x, y - top), KIND.WALL);
  const glazedGround = ground && look.ground === "glazed";
  const winTop = top + (1 - look.sill - look.windowHeight) * ROW_PX;
  const winBottom = top + (1 - look.sill) * ROW_PX;
  if (glazedGround || look.pattern === "curtain") {
    const glassTop = glazedGround ? top + 0.14 * ROW_PX : top;
    const glassBottom = glazedGround ? bottom - PLINTH_PX - 1 : bottom - look.spandrelHeight * ROW_PX;
    canvas.rect(0, glassTop, TILE_W, glassBottom, glassShade(look, top), KIND.GLASS);
    const step = BAY_PX / look.mullions;
    for (let x = 0; x < TILE_W; x += step) canvas.rect(x - 1, glassTop, x + 1, glassBottom, solid(look.frame, look.seed + 8), KIND.FRAME);
    canvas.rect(0, glassBottom, TILE_W, glassBottom + 1, solid(look.frame, look.seed + 8), KIND.FRAME);
    if (!glazedGround) canvas.rect(0, glassBottom + 1, TILE_W, bottom, solid(look.spandrel ?? look.trim, look.seed + 9), KIND.WALL);
    for (let b = 0; b < TILE_BAYS * look.mullions; b += 1) {
      if (rng() < (ground ? 0.6 : look.lit)) canvas.glow(b * step + 1, glassTop + 1, (b + 1) * step - 1, glassBottom - 1, tint(rng() < 0.75 ? LIT : LIT_COOL, 0.6 + rng() * 0.35));
    }
  } else if (look.pattern === "ribbon") {
    if (look.spandrel) {
      // brick ribbons (E7: red brick spandrel bands between white-framed window bands) keep the brick coursing
      const brick = look.texture === "brick" ? wallShade({ ...look, wall: look.spandrel }) : null;
      const spandrel = brick ? (x, y) => brick(x, y - top) : solid(look.spandrel, look.seed + 10);
      canvas.rect(0, top, TILE_W, winTop - 1, spandrel, KIND.WALL);
      canvas.rect(0, winBottom + 1, TILE_W, bottom, spandrel, KIND.WALL);
    }
    canvas.rect(0, winTop - 1, TILE_W, winBottom + 1, solid(look.frame, look.seed + 11), KIND.FRAME);
    canvas.rect(0, winTop, TILE_W, winBottom, glassShade(look, top), KIND.GLASS);
    const step = BAY_PX / look.mullions;
    for (let x = 0; x < TILE_W; x += step) canvas.rect(x - 1, winTop, x + 1, winBottom, solid(look.frame, look.seed + 11), KIND.FRAME);
    canvas.rect(0, winBottom + 1, TILE_W, winBottom + 3, solid(tint(look.trim, 1.05), look.seed + 12), KIND.SILL);
    for (let b = 0; b < TILE_BAYS * look.mullions; b += 1) {
      if (rng() < look.lit) canvas.glow(b * step + 1, winTop + 1, (b + 1) * step - 1, winBottom - 1, tint(rng() < 0.75 ? LIT : LIT_COOL, 0.6 + rng() * 0.35));
    }
  } else if (look.pattern === "greenhouse") {
    canvas.rect(0, top, TILE_W, bottom - 6, glassShade(look, top), KIND.GLASS);
    for (let x = 0; x < TILE_W; x += BAY_PX / 2) canvas.rect(x - 1, top, x + 1, bottom - 6, solid(look.frame, look.seed + 13), KIND.FRAME);
    canvas.rect(0, top + ROW_PX / 2 - 1, TILE_W, top + ROW_PX / 2 + 1, solid(look.frame, look.seed + 13), KIND.FRAME);
    canvas.rect(0, bottom - 6, TILE_W, bottom, solid(look.plinth, look.seed + 14), KIND.SILL);
  } else {
    // punched: `windows` openings per bay (every `windowsEvery` bays), sill below each
    for (let b = 0; b < TILE_BAYS; b += 1) {
      const bx = b * BAY_PX;
      if (look.accent?.kind === "spandrel" && look.accent.bays.includes(b)) {
        canvas.rect(bx + BAY_PX * 0.12, winBottom + 3, bx + BAY_PX * 0.88, bottom - 1, solid(look.accent.colour, look.seed + 15), KIND.SILL);
      }
      if (b % look.windowsEvery !== 0) continue;
      const total = look.windowWidth * BAY_PX;
      const gap = look.windows > 1 ? 3 : 0;
      const width = (total - gap * (look.windows - 1)) / look.windows;
      const start = bx + (BAY_PX - total) / 2;
      if (look.accent?.kind === "frame" && look.accent.bays.includes(b)) {
        canvas.rect(start - 3, winTop - 3, start + total + 3, winBottom + 3, solid(look.accent.colour, look.seed + 16), KIND.SILL);
      }
      for (let w = 0; w < look.windows; w += 1) {
        const x0 = start + w * (width + gap);
        windowAt(canvas, look, x0, winTop, x0 + width, winBottom, rng, { mullions: look.panes ?? (width > 18 ? 2 : 1), salt: b * 7 + w + top });
        canvas.rect(x0 - 1, winBottom, x0 + width + 1, winBottom + 2, solid(tint(look.trim, 1.1), look.seed + 17), KIND.SILL);
      }
    }
  }
  if (!glazedGround) piers(canvas, look, top, bottom);
  if (look.band) canvas.rect(0, bottom - look.band.height * ROW_PX, TILE_W, bottom, solid(look.band.colour, look.seed + 18), KIND.SILL);
  if (look.lintel && look.pattern === "punched") canvas.rect(0, winTop - 1 - look.lintel.height * ROW_PX, TILE_W, winTop - 1, solid(look.lintel.colour, look.seed + 21), KIND.SILL);
  if (ground) canvas.rect(0, bottom - PLINTH_PX, TILE_W, bottom, solid(look.plinth, look.seed + 19), KIND.SILL);
}

// The entrance row: the ground storey with doors, a canopy fascia and an optional sign plate in bays 1-2.
function paintEntrance(canvas, look, top, rng) {
  paintStorey(canvas, look, top, rng, { ground: true });
  const x0 = BAY_PX + 4;
  const x1 = 3 * BAY_PX - 4;
  const doorsTop = top + 0.3 * ROW_PX;
  const doors = look.entrance.doors ?? tint(look.glass, 0.75);
  canvas.rect(x0 - 2, doorsTop - 2, x1 + 2, top + ROW_PX, solid(look.frame, look.seed + 20), KIND.FRAME);
  canvas.rect(x0, doorsTop, x1, top + ROW_PX - 1, (_, y) => tint(doors, 1.05 - ((y - doorsTop) / ROW_PX) * 0.25), KIND.GLASS);
  for (let x = x0; x < x1; x += BAY_PX / 3) canvas.rect(x - 1, doorsTop, x + 1, top + ROW_PX, solid(look.frame, look.seed + 21), KIND.FRAME);
  canvas.glow(x0, doorsTop, x1, top + ROW_PX - 1, tint(LIT, 0.85));
  canvas.rect(BAY_PX - 6, top + 0.19 * ROW_PX, 3 * BAY_PX + 6, top + 0.28 * ROW_PX, solid(look.entrance.canopy, look.seed + 22, 0.02), KIND.SILL);
  if (look.entrance.sign) {
    const sy0 = top + 0.04 * ROW_PX;
    const sy1 = top + 0.16 * ROW_PX;
    canvas.rect(BAY_PX + 10, sy0, 3 * BAY_PX - 10, sy1, solid(look.entrance.sign, look.seed + 23), KIND.SILL);
    // a light strip of lettering, not readable text
    for (let x = BAY_PX + 16; x < 3 * BAY_PX - 16; x += 5) canvas.rect(x, sy0 + 2, x + 3, sy1 - 2, solid(tint([240, 240, 236], 1), look.seed + 24), KIND.SILL);
  }
}

function paintTile(canvas, look) {
  const rng = mulberry32(look.seed);
  paintStorey(canvas, look, ROWS.UPPER_A * ROW_PX, rng);
  paintStorey(canvas, look, ROWS.UPPER_B * ROW_PX, rng);
  paintStorey(canvas, look, ROWS.GROUND * ROW_PX, rng, { ground: true });
  paintEntrance(canvas, look, ROWS.ENTRANCE * ROW_PX, rng);
}

// Gutters: rows wrap horizontally; above the tile is upper-storey content (the bottom of row 1), below it the plinth.
function fillGutters(rasters, ox, oy) {
  for (const { data, channels, width } of rasters) {
    const copy = (sx, sy, dx, dy) => {
      for (let c = 0; c < channels; c += 1) data[(dy * width + dx) * channels + c] = data[(sy * width + sx) * channels + c];
    };
    for (let y = oy; y < oy + TILE_H; y += 1) {
      for (let i = 1; i <= GUTTER; i += 1) {
        copy(ox + TILE_W - i, y, ox - i, y);
        copy(ox + i - 1, y, ox + TILE_W + i - 1, y);
      }
    }
    for (let x = ox - GUTTER; x < ox + TILE_W + GUTTER; x += 1) {
      for (let j = 1; j <= GUTTER; j += 1) {
        copy(x, oy + 2 * ROW_PX - j, x, oy - j);
        copy(x, oy + TILE_H - 1, x, oy + TILE_H - 1 + j);
      }
    }
  }
}

// Box-filters an RGB raster by 2 (normal maps are renormalised).
function half(pixels, width, height, normal) {
  const out = new Uint8Array((width / 2) * (height / 2) * 3);
  for (let y = 0; y < height / 2; y += 1) {
    for (let x = 0; x < width / 2; x += 1) {
      const sum = [0, 0, 0];
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((y * 2 + dy) * width + x * 2 + dx) * 3;
        for (let c = 0; c < 3; c += 1) sum[c] += normal ? pixels[i + c] / 127.5 - 1 : pixels[i + c];
      }
      const o = (y * (width / 2) + x) * 3;
      if (normal) {
        const length = Math.hypot(...sum) || 1;
        for (let c = 0; c < 3; c += 1) out[o + c] = clamp((sum[c] / length + 1) * 127.5);
      } else {
        for (let c = 0; c < 3; c += 1) out[o + c] = clamp(sum[c] / 4);
      }
    }
  }
  return out;
}

// looks: [{ id, ... }] (data/scnu-facades.json look fields). Returns the encoded maps and each look's tile origin.
export async function buildFacadeAtlas(looks) {
  if (looks.length > MAX_LOOKS) throw new Error(`facade atlas: ${looks.length} looks, room for ${MAX_LOOKS}`);
  // Rows of tiles in use only; even so the half-resolution maps line up.
  const height = Math.ceil(Math.ceil(looks.length / SLOTS_PER_SIDE) * SLOT / 2) * 2;
  const color = new Raster(ATLAS_SIZE, height);
  const emissive = new Raster(ATLAS_SIZE, height);
  const kinds = new Uint8Array(ATLAS_SIZE * height);
  const normal = new Uint8Array(ATLAS_SIZE * height * 3).fill(128);
  const arm = new Uint8Array(ATLAS_SIZE * height * 3);
  for (let i = 0; i < ATLAS_SIZE * height; i += 1) {
    normal[i * 3 + 2] = 255;
    arm[i * 3] = 255;
    arm[i * 3 + 1] = 230;
  }
  const tiles = new Map();
  for (const [index, raw] of looks.entries()) {
    const look = normalise(raw);
    const sx = (index % SLOTS_PER_SIDE) * SLOT;
    const sy = Math.floor(index / SLOTS_PER_SIDE) * SLOT;
    const ox = sx + GUTTER;
    const oy = sy + GUTTER;
    paintTile(new TileCanvas(color, emissive, kinds, ox, oy), look);
    fillGutters([
      { data: color.data, channels: 3, width: ATLAS_SIZE },
      { data: emissive.data, channels: 3, width: ATLAS_SIZE },
      { data: kinds, channels: 1, width: ATLAS_SIZE },
    ], ox, oy);
    // Relief and roughness per slot: painted layout (recessed glass, proud sills and piers) plus the texture's CC0 grain.
    const slotKinds = new Uint8Array(SLOT * SLOT);
    for (let y = 0; y < SLOT; y += 1) slotKinds.set(kinds.subarray((sy + y) * ATLAS_SIZE + sx, (sy + y) * ATLAS_SIZE + sx + SLOT), y * SLOT);
    const metresX = (SLOT / BAY_PX) * (raw.bay ?? 3.6);
    const metresY = (SLOT / ROW_PX) * NOMINAL_STOREY_METRES;
    const wallKind = look.pattern === "curtain" || look.pattern === "greenhouse" ? KIND.FRAME : KIND.WALL;
    const maps = await detailMaps({
      width: SLOT,
      height: SLOT,
      metresX,
      metresY,
      kinds: slotKinds,
      classes: facadeClasses(ROUGHNESS[look.texture] ?? 0.85, wallKind),
      tile: DETAIL[look.texture] ?? null,
      encoded: false,
    });
    for (let y = 0; y < SLOT; y += 1) {
      normal.set(maps.normal.subarray(y * SLOT * 3, (y + 1) * SLOT * 3), ((sy + y) * ATLAS_SIZE + sx) * 3);
      arm.set(maps.arm.subarray(y * SLOT * 3, (y + 1) * SLOT * 3), ((sy + y) * ATLAS_SIZE + sx) * 3);
    }
    tiles.set(look.id, { x: ox, y: oy, slot: index, width: ATLAS_SIZE, height });
  }
  return {
    width: ATLAS_SIZE,
    height,
    tiles,
    color: encodePng(ATLAS_SIZE, height, 3, color.data),
    emissive: encodePng(ATLAS_SIZE / 2, height / 2, 3, half(emissive.data, ATLAS_SIZE, height, false)),
    normal: encodePng(ATLAS_SIZE / 2, height / 2, 3, half(normal, ATLAS_SIZE, height, true)),
    arm: encodePng(ATLAS_SIZE / 2, height / 2, 3, half(arm, ATLAS_SIZE, height, false)),
  };
}

// UV of a point in a look's tile: bay position b (0..TILE_BAYS, may be fractional), storey row, and f, the height
// fraction within the storey (0 = floor, 1 = ceiling).
export function tileUv(tile, row, b, f) {
  return [(tile.x + b * BAY_PX) / tile.width, (tile.y + (row + 1 - f) * ROW_PX) / tile.height];
}

// A point inside the plinth band (below-grade wall strips) and inside the canopy fascia (canopy slabs).
export function plinthUv(tile, b) {
  return [(tile.x + b * BAY_PX) / tile.width, (tile.y + (ROWS.GROUND + 1) * ROW_PX - PLINTH_PX / 2) / tile.height];
}
export function canopyUv(tile) {
  return [(tile.x + 2 * BAY_PX) / tile.width, (tile.y + (ROWS.ENTRANCE + 0.235) * ROW_PX) / tile.height];
}

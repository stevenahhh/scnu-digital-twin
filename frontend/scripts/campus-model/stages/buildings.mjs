// Building stage: match uni.glb's BLD_* nodes to the footprints in data/gis-buildings.json, pick
// campus/off-campus buildings, give each its facade look and storey count, build their meshes and emit the nodes.
// Facades: every wall is drawn with one Facade_Atlas material whose tiles hold the looks of data/scnu-facades.json
// (lib/facadeAtlas.mjs); walls are cut into cells of whole bays and whole storeys, so window rows follow the floor
// counts. Every facade/roof primitive also gets TEXCOORD_1 into one ambient-occlusion atlas (see aoLayout below);
// data/ao-buildings.png, baked from the raw GLB by bake/bake-ao.mjs, becomes their occlusionTexture when its layout
// hash matches this build's. Roof colours and rooftop solar panels come from the VWorld z19 orthophoto
// (lib/roofPhoto.mjs; estimates, not measurements). Buildings listed in data/building-forms.json with VWorld LOD4 or
// photo-traced masses are built from those masses (see mass forms below): wings, stepped levels, courtyards, rooftop
// cores, raised parts and pitched or curved roofs.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROWS, TILE_BAYS, buildFacadeAtlas, canopyUv, hex, plinthUv, tileUv } from "../lib/facadeAtlas.mjs";
import { geoToModel, metres } from "../lib/frame.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { mulberry32 } from "../lib/raster.mjs";
import { EQUIPMENT_MODULE_UV, EQUIPMENT_PLAIN_UV, ROOF_METRES, equipmentAtlas, roofTexture } from "../lib/textures.mjs";
import { MODULE_DEPTH_M, MODULE_TILT_DEGREES, panelModules, sampleRoofPhoto } from "../lib/roofPhoto.mjs";
import { cleanRing, pointInRing, ringArea, ringCentroid, segmentDistance } from "../lib/geometry.mjs";
import { Box3 } from "three";
import { meshFootprint, toModelRing } from "./sources.mjs";

const UNIT_AREA = metres(1) ** 2;
const PARAPET = metres(0.9);
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

const jpeg = async (png, quality = 86) => new Bun.Image(png).jpeg({ quality }).toBuffer();

// Storey heights: medians of height/floors over the building register records in the campus bbox,
// 4.39 m for SCNU buildings (n = 26) and 3.76 m for all buildings (n = 153).
const SCNU_STOREY = 4.4;
const STOREY = 3.8;
const MIN_HEIGHT = 3.5;
const SCNU_NAME = /^순천대학교/;
// A source height is used when it gives 2.5-5 m per storey. Outside that window it belongs to another register
// record (on campus the register attributes sit on the wrong footprints, see data/scnu-facades.json) or counts a
// stage tower or chimney, so floors x storey height is used instead.
const MIN_STOREY_METRES = 2.5;
const MAX_STOREY_METRES = 5;

// Roof-slab height in metres (the 0.9 m parapet is added on top as geometry, see PARAPET) and where it
// came from, or null when the record has neither a height nor a floor count. A curated height
// (data/scnu-facades.json) wins; a source height is used when it gives MIN-MAX_STOREY_METRES per storey (or when
// floors are unknown); otherwise floors x storey height. maxStorey exists so the build can log what the former
// 6.5 m limit would have given.
export function heightOf(part, isSCNU, maxStorey = MAX_STOREY_METRES) {
  if (part.heightOverride) return { heightMetres: Math.max(part.heightMetres, MIN_HEIGHT), heightSource: part.heightOverride };
  const floors = part.floors || 0;
  const height = part.heightMetres || 0;
  if (height > 0 && (!floors || (height / floors >= MIN_STOREY_METRES && height / floors <= maxStorey))) {
    return { heightMetres: Math.max(height, MIN_HEIGHT), heightSource: "source height" };
  }
  if (floors > 0) {
    const storey = isSCNU ? SCNU_STOREY : STOREY;
    return { heightMetres: Math.max(floors * storey, MIN_HEIGHT), heightSource: `estimated: ${floors} floors x ${storey} m` };
  }
  return null;
}

// Campus buildings with neither a height nor a floor count anywhere: an assumed storey count by type
// (dormitories are mid-rise, other SCNU buildings low-rise) instead of a one-storey shed.
function assumedHeight(name, isSCNU) {
  const floors = /생활관|기숙사|관사/.test(name) ? 6 : isSCNU ? 3 : 1;
  const storey = isSCNU ? SCNU_STOREY : STOREY;
  return { heightMetres: Math.max(floors * storey, MIN_HEIGHT), heightSource: `assumed: ${floors} floors x ${storey} m (no floor data)` };
}

const isGroundFeature = (part) => part.areaMetres > 8000 && part.floors <= 1;

// ---------------------------------------------------------------- facade catalogue
// data/scnu-facades.json: facade looks and per-building entries (look, floor/height corrections, LOD4 tower masses,
// entrance side). A uni.glb node takes the entry naming its id; a footprint record the entry with its exact name,
// else the one with its registry code. Annexes and estimated names (부속 시설, (추정)) never take a building's entry.
// data/lod4-facades.json (fetch/lod4Facades.mjs) supplies the roof-level outlines the tower masses use.
const CODE = /(?:^|\s)([A-F]\d{1,2})(?=\s)/;
const ANNEX = /부속 시설|\(추정\)/;
const bareName = (name) => (name ?? "").replace(/^순천대학교\s*/, "").trim();

function loadCatalogue() {
  const file = JSON.parse(readFileSync(path.join(DATA, "scnu-facades.json"), "utf8"));
  const looks = new Map(file.looks.map((look) => [look.id, look]));
  const byNode = new Map();
  const byName = new Map();
  const byCode = new Map();
  for (const entry of file.buildings) {
    if (!looks.has(entry.look)) throw new Error(`scnu-facades.json: ${entry.node ?? entry.name ?? entry.code} uses unknown look ${entry.look}`);
    if (entry.node) byNode.set(entry.node, entry);
    else if (entry.name) byName.set(entry.name, entry);
    else byCode.set(entry.code, entry);
  }
  const lod4File = path.join(DATA, "lod4-facades.json");
  const lod4 = existsSync(lod4File) ? new Map(JSON.parse(readFileSync(lod4File, "utf8")).buildings.map((b) => [b.footprintSource, b])) : new Map();
  return { looks, byNode, byName, byCode, lod4 };
}

function recordEntry(catalogue, name) {
  const label = bareName(name);
  if (catalogue.byName.has(label)) return catalogue.byName.get(label);
  if (!label || ANNEX.test(label)) return null;
  const code = CODE.exec(` ${label} `)?.[1];
  return code ? catalogue.byCode.get(code) ?? null : null;
}

// Buildings without an entry: greenhouses, service annexes, then a plain render look.
function genericLook(name, areaMetres, isSCNU) {
  const label = bareName(name);
  if (/온실/.test(label)) return "greenhouse";
  if (ANNEX.test(label) || areaMetres < 150) return "annex";
  return isSCNU || SCNU_NAME.test(name ?? "") || /^[A-F]\d/.test(label) ? "generic-scnu" : "generic";
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

// subject (any simple ring) clipped by a convex ring (Sutherland-Hodgman).
function clipConvex(subject, clip) {
  const sign = Math.sign(ringArea(clip)) || 1;
  let output = subject;
  for (let i = 0; i < clip.length && output.length >= 3; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (p) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const input = output;
    output = [];
    for (let k = 0; k < input.length; k += 1) {
      const p = input[k];
      const q = input[(k + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) output.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        output.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return output;
}

// A part's masses: the part itself and, when its entry gives a tower, the taller mass over the LOD4 roof-level
// outline clipped to the part, standing on the part's roof.
function partMasses(part) {
  const masses = [{ outer: part.outer, holes: part.holes, heightMetres: part.heightMetres, floors: part.floors, fromMetres: 0 }];
  if (part.tower) {
    const ring = clipConvex(part.outer, part.tower.hull);
    if (ring.length >= 3 && Math.abs(ringArea(ring)) / UNIT_AREA > 40 && part.tower.heightMetres > part.heightMetres + 3) {
      masses[0].under = ring;
      masses.push({ outer: ring, holes: [], heightMetres: part.tower.heightMetres, floors: part.tower.floors, fromMetres: part.heightMetres, tower: true });
    }
  }
  return masses;
}

// ---------------------------------------------------------------- roof colours
// A roof takes the median colour of its footprint in the VWorld z19 orthophoto (lib/roofPhoto.mjs: shadow,
// tree-crown and solar-panel samples left out, calibrated to an albedo estimate like the ground). Where the photo
// gives none (outside the mosaic, hidden by crowns or shadow), data/osm-roof-tags.json (fetch/roofTags.mjs)
// can still colour it from a tag on a footprint it matches: roof:colour, else a green-roof tag (roof:garden=yes
// or a vegetated roof:material), else building:colour. Everything else keeps the light membrane. Every roof, BLD_*
// nodes and the merged CampusBuildings roof alike, carries its colour as COLOR_0 on the one Roof_Membrane
// material, so no roof adds a draw call or a material and all of them take the dashboard's tints the same way.
const ROOF_TAGS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "osm-roof-tags.json");
const NAMED_COLOURS = {
  white: [255, 255, 255], whitesmoke: [245, 245, 245], silver: [192, 192, 192], lightgrey: [211, 211, 211],
  lightgray: [211, 211, 211], grey: [128, 128, 128], gray: [128, 128, 128], darkgrey: [169, 169, 169],
  darkgray: [169, 169, 169], dimgray: [105, 105, 105], dimgrey: [105, 105, 105], black: [0, 0, 0],
  red: [255, 0, 0], darkred: [139, 0, 0], maroon: [128, 0, 0], brown: [165, 42, 42], orange: [255, 165, 0],
  yellow: [255, 255, 0], beige: [245, 245, 220], tan: [210, 180, 140], green: [0, 128, 0],
  darkgreen: [0, 100, 0], olive: [128, 128, 0], blue: [0, 0, 255], navy: [0, 0, 128], lightblue: [173, 216, 230],
  teal: [0, 128, 128],
};
// Assumed display colour for a tagged green roof (the tag says "vegetated", not which green).
const GREEN_ROOF = [104, 132, 76];
const VEGETATED = /^(grass|plants|vegetation|green|sedum)$/;

export function parseColour(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d) : hex[1].match(/../g);
    return digits.map((d) => Number.parseInt(d, 16));
  }
  return NAMED_COLOURS[text.replace(/[\s_-]/g, "")] ?? null;
}

// { rgb, tag } from a tag set, or null when no tag gives a usable colour.
export function roofColourFromTags(tags) {
  const roof = parseColour(tags["roof:colour"] ?? tags["roof:color"]);
  if (roof) return { rgb: roof, tag: `roof:colour=${tags["roof:colour"] ?? tags["roof:color"]}` };
  if (tags["roof:garden"] === "yes") return { rgb: GREEN_ROOF, tag: "roof:garden=yes (assumed green)" };
  if (VEGETATED.test(tags["roof:material"] ?? "")) return { rgb: GREEN_ROOF, tag: `roof:material=${tags["roof:material"]} (assumed green)` };
  const building = parseColour(tags["building:colour"] ?? tags["building:color"]);
  if (building) return { rgb: building, tag: `building:colour=${tags["building:colour"] ?? tags["building:color"]}` };
  return null;
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
// The membrane texture is near white (222, 224, 220), so the colour factor (COLOR_0) = target / texture base, linear.
const roofFactor = (rgb) => [...rgb.map((c, i) => Math.min(1, srgbToLinear(c / 255) / srgbToLinear([222, 224, 220][i] / 255))), 1];

// ---------------------------------------------------------------- AO atlas layout (TEXCOORD_1)
// Each wall ring is unrolled into charts of (distance along the ring, depth below the wall top), cut
// at a corner once a chart passes AO_MAX_CHART; each roof/box top is a chart of its XZ bounding box.
// Charts are shelf-packed into one AO_SIZE^2 atlas with AO_GUTTER px between them at the finest
// texel size that fits. UV0 cannot be reused: it is tiled and overlaps across buildings.
const AO_ATLAS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "ao-buildings.png");
const AO_SIZE = 2048;
const AO_GUTTER = 4;
const AO_MAX_CHART = metres(80);

class AoCharts {
  constructor() {
    this.charts = [];
  }

  open() {
    this.charts.push({ w: 0, h: 0 });
    return this.charts.length - 1;
  }

  close(chart, w, h) {
    this.charts[chart].w = w;
    this.charts[chart].h = h;
  }

  // Planar chart over the XZ bounding box of mesh vertices [from, vertexCount), e.g. a roof polygon.
  addPlanar(mesh, from) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = from; k < mesh.vertexCount; k += 1) {
      const x = mesh.positions[k * 3];
      const z = mesh.positions[k * 3 + 2];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const chart = this.open();
    this.close(chart, maxX - minX, maxZ - minZ);
    for (let k = from; k < mesh.vertexCount; k += 1) mesh.ao.push(mesh.positions[k * 3] - minX, mesh.positions[k * 3 + 2] - minZ, chart);
  }

  // Shelf packing at texel size `texel` (scene units per texel); null when the charts do not fit.
  pack(texel) {
    const rects = new Array(this.charts.length);
    const order = this.charts.map((_, i) => i).sort((a, b) => this.charts[b].h - this.charts[a].h || this.charts[b].w - this.charts[a].w || a - b);
    let x = AO_GUTTER / 2;
    let y = AO_GUTTER / 2;
    let rowHeight = 0;
    for (const i of order) {
      const w = Math.ceil(this.charts[i].w / texel) + 1;
      const h = Math.ceil(this.charts[i].h / texel) + 1;
      if (w + AO_GUTTER > AO_SIZE) return null;
      if (x + w + AO_GUTTER / 2 > AO_SIZE) {
        x = AO_GUTTER / 2;
        y += rowHeight + AO_GUTTER;
        rowHeight = 0;
      }
      if (y + h + AO_GUTTER / 2 > AO_SIZE) return null;
      rects[i] = { x, y, w, h };
      x += w + AO_GUTTER;
      rowHeight = Math.max(rowHeight, h);
    }
    return rects;
  }

  // Finest texel size (bisection to 0.1 %) whose packing fits, the chart rectangles and a layout hash.
  layout() {
    let lo = metres(0.05);
    let hi = metres(0.05);
    while (!this.pack(hi)) hi *= 2;
    while (hi - lo > hi * 0.001) {
      const mid = (lo + hi) / 2;
      if (this.pack(mid)) hi = mid;
      else lo = mid;
    }
    const rects = this.pack(hi);
    let hash = 0x811c9dc5;
    const mix = (value) => {
      hash ^= value & 0xffff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
      hash ^= value >>> 16;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    };
    mix(AO_SIZE);
    mix(Math.round(hi * 1e6));
    rects.forEach((r) => [r.x, r.y, r.w, r.h].forEach(mix));
    let covered = 0;
    rects.forEach((r) => {
      covered += r.w * r.h;
    });
    return { texel: hi, rects, hash: hash.toString(16).padStart(8, "0"), fill: covered / AO_SIZE ** 2 };
  }
}

// The aoLayout hash a baked atlas was made for (its PNG tEXt chunk), or null.
function atlasLayoutHash(bytes) {
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "tEXt") {
      const [key, value] = bytes.toString("latin1", offset + 8, offset + 8 + length).split("\0");
      if (key === "aoLayout") return value;
    }
    offset += 12 + length;
  }
  return null;
}

// ---------------------------------------------------------------- geometry
// A ring ordered so that its walls face outward (or inward, for courtyard rings): a ring that is counter-clockwise
// in (x, z) has its interior on the left, and quads face right.
const orderedRing = (ring, outward) => ((ringArea(ring) > 0) === outward ? [...ring].reverse() : ring);

// Compass bearing (0 = north, 90 = east) of the outward normal of edge a -> b of an ordered ring (+x east, +z south).
const edgeBearing = (a, b) => ((Math.atan2(-(b[1] - a[1]), -(b[0] - a[0])) * 180) / Math.PI + 360) % 360;

// Stretches [t0, t1] of edge a -> b that lie outside `ring` (sampled every half metre); all of it without a ring.
function openRuns(a, b, length, ring) {
  if (!ring) return [[0, 1]];
  const steps = Math.max(1, Math.ceil(length / metres(0.5)));
  const covered = (t) => {
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return pointInRing(p, ring) || minEdgeDistance(p, [ring]) < metres(0.3);
  };
  const runs = [];
  let start = null;
  for (let k = 0; k < steps; k += 1) {
    const open = !covered((k + 0.5) / steps);
    if (open && start === null) start = k / steps;
    if (!open && start !== null) {
      runs.push([start, k / steps]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, 1]);
  return runs;
}

// Plain walls of a ring from base to top (parapets, rooftop plant, pick proxies), optionally leaving out the
// stretches covered by `skip` (a tower standing on the roof) and coloured per vertex.
function addWalls(mesh, ring, outward, base, top, charts, { skip = null, colour } = {}) {
  const ordered = orderedRing(ring, outward);
  let distance = 0;
  let chart = -1;
  let chartStart = 0;
  const depth = top - base;
  const flat = [[0, 0], [0, 0], [0, 0], [0, 0]];
  for (let i = 0; i < ordered.length; i += 1) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (charts && (chart < 0 || (distance > chartStart && distance - chartStart + length > AO_MAX_CHART))) {
      if (chart >= 0) charts.close(chart, distance - chartStart, depth);
      chart = charts.open();
      chartStart = distance;
    }
    for (const [t0, t1] of openRuns(a, b, length, skip)) {
      const p = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const [p0, p1] = [p(t0), p(t1)];
      mesh.quad([p0[0], base, p0[1]], [p1[0], base, p1[1]], [p1[0], top, p1[1]], [p0[0], top, p0[1]], flat, colour);
      if (charts) {
        const s0 = distance - chartStart + t0 * length;
        const s1 = distance - chartStart + t1 * length;
        mesh.ao.push(s0, depth, chart, s1, depth, chart, s1, 0, chart, s0, 0, chart);
      }
    }
    distance += length;
  }
  if (charts) charts.close(chart, distance - chartStart, depth);
}

// Facade of one ring as atlas cells (lib/facadeAtlas.mjs). Each edge holds a whole number of bays (its length over
// the look's bay, at least one; the bay stretches to fit, so windows never run round a corner) and the mass its
// whole number of storeys, so window rows follow the floor count. A cell is up to TILE_BAYS bays of one storey and
// maps into one row of the look's tile: the ground row for the first storey, the entrance row for the middle bays
// of the entrance edge, one of two upper rows (and either orientation) above. Walls start `bottom`; a mass standing
// on the ground also gets the strip below the ground line (down to `base`) in the plinth band. Edges shorter than
// half a bay take a sliver of plain wall. The entrance edge can carry a canopy slab over the doors.
const CANOPY_DEPTH = metres(2.2);
const CANOPY_THICKNESS = metres(0.3);
function addFacade(mesh, ordered, { base, ground, bottom, top, floors, look, tile, entranceEdge = -1, canopy = false, seed, charts }) {
  const storey = (top - ground) / floors;
  const lowest = bottom > ground + 1e-6 ? bottom : base;
  const depth = top - lowest;
  const bay = metres(look.bay ?? 3.6);
  const rng = mulberry32(seed);
  let distance = 0;
  let chart = -1;
  let chartStart = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (charts && (chart < 0 || (distance > chartStart && distance - chartStart + length > AO_MAX_CHART))) {
      if (chart >= 0) charts.close(chart, distance - chartStart, depth);
      chart = charts.open();
      chartStart = distance;
    }
    const s0 = distance - chartStart;
    const point = (t, y, out = 0) => [a[0] + (b[0] - a[0]) * t + ((a[1] - b[1]) / length) * out, y, a[1] + (b[1] - a[1]) * t + ((b[0] - a[0]) / length) * out];
    const cell = (t0, t1, y0, y1, uv) => {
      mesh.quad(point(t0, y0), point(t1, y0), point(t1, y1), point(t0, y1), uv);
      if (charts) mesh.ao.push(s0 + t0 * length, top - y0, chart, s0 + t1 * length, top - y0, chart, s0 + t1 * length, top - y1, chart, s0 + t0 * length, top - y1, chart);
    };
    if (length > 1e-6) {
      if (lowest === base) {
        const [p0, p1] = [plinthUv(tile, 0), plinthUv(tile, TILE_BAYS)];
        cell(0, 1, base, ground, [p0, p1, p1, p0]);
      }
      const bays = Math.max(1, Math.round(length / bay));
      const sliver = length < bay * 0.45;
      for (let s = 0; s < floors; s += 1) {
        const y0 = ground + s * storey;
        const y1 = y0 + storey;
        if (y1 <= bottom + 1e-6) continue;
        const from = Math.max(y0, bottom);
        const f0 = (from - y0) / storey;
        const row = s === 0 ? ROWS.GROUND : rng() < 0.5 ? ROWS.UPPER_A : ROWS.UPPER_B;
        const emit = (g0, g1, tileRow, b0, b1) => {
          cell(g0 / bays, g1 / bays, from, y1, [tileUv(tile, tileRow, b0, f0), tileUv(tile, tileRow, b1, f0), tileUv(tile, tileRow, b1, 1), tileUv(tile, tileRow, b0, 1)]);
        };
        if (sliver) {
          emit(0, bays, row, 0, Math.min(0.3, length / bay));
          continue;
        }
        const groups = [];
        const push = (from0, to) => {
          for (let g = from0; g < to; g += TILE_BAYS) groups.push([g, Math.min(to, g + TILE_BAYS), row]);
        };
        if (s === 0 && i === entranceEdge) {
          const k = Math.min(TILE_BAYS, bays);
          const e0 = Math.floor((bays - k) / 2);
          push(0, e0);
          groups.push([e0, e0 + k, ROWS.ENTRANCE]);
          push(e0 + k, bays);
          if (canopy) {
            const middle = (e0 + k / 2) / bays;
            const half = Math.min(k / 2, 1) / bays;
            addCanopy(mesh, point, middle - half, middle + half, ground + Math.min(0.72 * storey, metres(3.6)), canopyUv(tile), charts ? [s0 + middle * length, top - ground - Math.min(0.72 * storey, metres(3.6)), chart] : null);
          }
        } else {
          push(0, bays);
        }
        for (const [g0, g1, tileRow] of groups) {
          const k = g1 - g0;
          if (tileRow === ROWS.ENTRANCE) emit(g0, g1, tileRow, TILE_BAYS / 2 - k / 2, TILE_BAYS / 2 + k / 2);
          else if (tileRow !== ROWS.GROUND && rng() < 0.5) emit(g0, g1, tileRow, TILE_BAYS, TILE_BAYS - k);
          else emit(g0, g1, tileRow, 0, k);
        }
      }
    }
    distance += length;
  }
  if (charts) charts.close(chart, distance - chartStart, depth);
}

// Canopy slab over the doors: top, underside, front and both ends, all on the canopy fascia colour of the tile and
// on one AO texel of the wall behind it (zero UV1 area, so the bake leaves the wall's texels to the wall).
function addCanopy(mesh, point, t0, t1, y, uv, ao) {
  const yb = y;
  const yt = y + CANOPY_THICKNESS;
  const d = CANOPY_DEPTH;
  const uvs = [uv, uv, uv, uv];
  const faces = [
    [point(t0, yb, d), point(t1, yb, d), point(t1, yt, d), point(t0, yt, d)],
    [point(t0, yt, 0), point(t0, yt, d), point(t1, yt, d), point(t1, yt, 0)],
    [point(t0, yb, 0), point(t1, yb, 0), point(t1, yb, d), point(t0, yb, d)],
    [point(t0, yb, 0), point(t0, yb, d), point(t0, yt, d), point(t0, yt, 0)],
    [point(t1, yb, d), point(t1, yb, 0), point(t1, yt, 0), point(t1, yt, d)],
  ];
  for (const face of faces) {
    mesh.quad(...face, uvs);
    if (ao) for (let k = 0; k < 4; k += 1) mesh.ao.push(...ao);
  }
}

function addBox(mesh, cx, cz, sx, sz, y0, y1, angle, charts) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corner = (dx, dz) => [cx + dx * cos - dz * sin, cz + dx * sin + dz * cos];
  const ring = [corner(-sx / 2, -sz / 2), corner(sx / 2, -sz / 2), corner(sx / 2, sz / 2), corner(-sx / 2, sz / 2)];
  addWalls(mesh, ring, true, y0, y1, charts);
  const from = mesh.vertexCount;
  mesh.horizontalPolygon(ring, [], y1);
  charts.addPlanar(mesh, from);
}

// A MeshData whose vertices also carry AO chart coordinates: mesh.ao holds (s, t, chart) per vertex.
function aoMesh(options) {
  const mesh = new MeshData(options);
  mesh.ao = [];
  return mesh;
}

const aoPrimitive = (mesh, material) => ({ ...mesh.toPrimitive(material), ao: mesh.ao });

// Node extras of a building's form (data/building-forms.json): where it comes from, its masses and voids, the photo IoU.
function formExtras(building) {
  const form = building.form;
  if (!form) return {};
  const kinds = Object.entries(Object.groupBy(form.masses, (m) => m.kind)).map(([kind, list]) => `${kind} ${list.length}`).join(", ");
  const assumedParapets = form.masses.filter((m) => m.parapetEstimated).length;
  // What in this form is estimated, part by part (all of it is: nothing here is surveyed).
  const origin = form.source.startsWith("VWorld LOD4") ? "masses, roof heights, pitched roofs, raised parts and voids derived from the VWorld LOD4 model"
    : form.source.startsWith("Curated") ? "masses and voids traced on the NGII 2025 photo, storeys and pilotis from the SCNU VR tour, 4.4 m per storey"
      : form.source.startsWith("NGII") ? "outline traced on the NGII 2025 photo, height from the register or floor count"
        : "footprint and height from the register or floor count";
  const estimated = [origin, ...(assumedParapets ? [`parapet height assumed (0.9 m) on ${assumedParapets} of ${form.masses.length} roofs`] : []),
    ...(form.masses.some((m) => m.columns?.length) ? ["columns under raised parts"] : []), "roof colours from the VWorld z19 photo where it shows the roof"];
  return {
    formSource: `${form.source}${building.massForm ? "" : " (footprint kept)"}`,
    formMasses: form.masses.length,
    formMassKinds: kinds,
    formVoids: form.voids.map((v) => `${v.kind} ${Math.round(v.area)} m2`),
    formRoofs: [...new Set(form.masses.map((m) => m.roof))],
    formPhotoIoU: form.iou.final,
    formLean: form.lean,
    ...(form.lod4Models.length ? { lod4Models: form.lod4Models } : {}),
    formEstimated: estimated,
    formNote: "masses, heights and voids estimated from the VWorld LOD4 model and the NGII 2025 orthophoto, not surveyed",
  };
}

function dominantAngle(ring) {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > best) {
      best = length;
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  return angle;
}

function minEdgeDistance(point, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) best = Math.min(best, segmentDistance(point, ring[i], ring[(i + 1) % ring.length]));
  }
  return best;
}

// The entrance wall of a building: on its largest ground mass, the edge whose outward normal is closest to the
// entry's entranceBearing among edges at least half as long as the longest, else the longest edge.
function entranceOf(building, entry) {
  const standing = building.parts.filter((p) => p.outer?.length >= 3 && !(p.baseMetres > 0) && !PLAIN_KINDS.has(p.kind));
  const part = (standing.length ? standing : building.parts.filter((p) => p.outer?.length >= 3)).sort((p, q) => Math.abs(ringArea(q.outer)) - Math.abs(ringArea(p.outer)))[0];
  if (!part) return null;
  const ordered = orderedRing(part.outer, true);
  const edges = ordered.map((a, i) => {
    const b = ordered[(i + 1) % ordered.length];
    return { i, length: Math.hypot(b[0] - a[0], b[1] - a[1]), bearing: edgeBearing(a, b) };
  });
  const longest = Math.max(...edges.map((e) => e.length));
  const bearing = entry?.entranceBearing;
  const pick = bearing === undefined
    ? edges.reduce((best, e) => (e.length > best.length ? e : best))
    : edges.filter((e) => e.length >= longest * 0.5).reduce((best, e) => {
      const off = (x) => Math.abs(((x - bearing + 540) % 360) - 180);
      return off(e.bearing) < off(best.bearing) ? e : best;
    });
  return { part, edge: pick.i };
}

// Photovoltaic modules (lib/roofPhoto.mjs): MODULE_LIFT (0.35 m, ASSUMED rack height) above the roof slab, tilted
// towards the south; a top face on the module region of the Roof_Equipment atlas and a plain back face.
const MODULE_LIFT = metres(0.35);
const MODULE_RISE = metres(MODULE_DEPTH_M * Math.sin((MODULE_TILT_DEGREES * Math.PI) / 180));

const linearByte = (rgb) => [...rgb.map((c) => Math.round(srgbToLinear(c / 255) * 255)), 255];

function buildingPrimitives(building, seed, { heightAt, facadeMaterial, tiles, looks, roofMaterial, parapetMaterial, equipmentMaterial, charts }) {
  const look = looks.get(building.look);
  const tile = tiles.get(building.look);
  const greenhouse = look.pattern === "greenhouse";
  const walls = aoMesh();
  const roof = aoMesh(building.roofColour ? { colors: true } : undefined);
  // Parapet and equipment carry an (unused) TEXCOORD_0 so that their TEXCOORD_1 is a valid set index. The parapet
  // (coping band) takes the look's eave colour per vertex, so tiled and painted eaves cost no material.
  const parapet = aoMesh({ colors: true });
  const parapetColour = linearByte(hex(look.parapet ?? look.wall));
  const equipment = aoMesh();
  const rng = mulberry32(seed);
  const entrance = entranceOf(building, building.entry);
  for (const [partIndex, part] of building.parts.entries()) {
    if (!part.outer || part.outer.length < 3) continue;
    const samples = [...part.outer, ringCentroid(part.outer)].map(([x, z]) => heightAt(x, z));
    const ground = Math.min(...samples);
    const base = ground - metres(1.5);
    for (const [massIndex, mass] of partMasses(part).entries()) {
      const top = ground + metres(mass.heightMetres);
      const floors = Math.max(1, mass.floors || Math.round(mass.heightMetres / 3.6));
      const facade = { base, ground, bottom: ground + metres(mass.fromMetres), top, floors, look, tile, seed: seed * 31 + partIndex * 7 + massIndex, charts };
      const onEntrance = massIndex === 0 && entrance?.part === part;
      addFacade(walls, orderedRing(mass.outer, true), { ...facade, entranceEdge: onEntrance ? entrance.edge : -1, canopy: onEntrance && Boolean(building.entry) && !greenhouse });
      mass.holes.forEach((hole) => addFacade(walls, orderedRing(hole, false), facade));
      const roofFrom = roof.vertexCount;
      roof.horizontalPolygon(mass.outer, mass.holes, top, { uvScale: 1 / metres(ROOF_METRES), color: building.roofColour });
      // Per-part quarter-turn and offset of the roof texture, so neighbouring roofs do not share one
      // grid. Its own generator keeps rng (equipment layout, hence the AO layout hash) unchanged.
      const uvRng = mulberry32(seed * 7919 + roofFrom);
      const turn = Math.floor(uvRng() * 4);
      const [ou, ov] = [uvRng(), uvRng()];
      for (let k = roofFrom * 2; k < roof.uvs.length; k += 2) {
        const [u, v] = [roof.uvs[k], roof.uvs[k + 1]];
        const [ru, rv] = [[u, v], [-v, u], [-u, -v], [v, -u]][turn];
        roof.uvs[k] = ru + ou;
        roof.uvs[k + 1] = rv + ov;
      }
      charts.addPlanar(roof, roofFrom);
      const roofChart = charts.charts.length - 1;
      const roofMin = [Math.min(...mass.outer.map((p) => p[0])), Math.min(...mass.outer.map((p) => p[1]))];
      if (greenhouse) continue;
      for (const ring of [mass.outer, ...mass.holes]) {
        addWalls(parapet, ring, true, top, top + PARAPET, charts, { skip: mass.under, colour: parapetColour });
        addWalls(parapet, ring, false, top, top + PARAPET, charts, { skip: mass.under, colour: parapetColour });
      }
      const areaMetres = Math.abs(ringArea(mass.outer)) / UNIT_AREA;
      const units = areaMetres > 300 ? Math.min(6, 1 + Math.floor(areaMetres / 700)) : 0;
      const angle = dominantAngle(mass.outer);
      const xs = mass.outer.map((p) => p[0]);
      const zs = mass.outer.map((p) => p[1]);
      const boxesFrom = equipment.vertexCount;
      for (let placed = 0, tries = 0; placed < units && tries < 80; tries += 1) {
        const sx = metres(2.5 + rng() * 4);
        const sz = metres(2 + rng() * 3);
        const cx = Math.min(...xs) + rng() * (Math.max(...xs) - Math.min(...xs));
        const cz = Math.min(...zs) + rng() * (Math.max(...zs) - Math.min(...zs));
        if (!pointInRing([cx, cz], mass.outer) || mass.holes.some((h) => pointInRing([cx, cz], h))) continue;
        if (mass.under && (pointInRing([cx, cz], mass.under) || minEdgeDistance([cx, cz], [mass.under]) < Math.hypot(sx, sz) / 2)) continue;
        if (minEdgeDistance([cx, cz], [mass.outer, ...mass.holes]) < Math.hypot(sx, sz) / 2 + metres(1.2)) continue;
        addBox(equipment, cx, cz, sx, sz, top, top + metres(1.4 + rng() * 1.6), angle, charts);
        placed += 1;
      }
      // Plant samples the plain half of the Roof_Equipment atlas.
      for (let k = boxesFrom * 2; k < equipment.uvs.length; k += 2) [equipment.uvs[k], equipment.uvs[k + 1]] = EQUIPMENT_PLAIN_UV;
      // Modules reuse the roof's AO chart (they sit just above it), so the AO layout does not change. They belong to
      // the part's own roof; under a tower they are hidden inside it.
      if (massIndex > 0) continue;
      for (const corners of building.panelModules?.[partIndex] ?? []) {
        const low = top + MODULE_LIFT;
        const [lowA, lowB, highB, highA] = corners.map(([x, z], k) => [x, k < 2 ? low : low + MODULE_RISE, z]);
        const up = (lowB[0] - lowA[0]) * (highA[2] - lowA[2]) - (lowB[2] - lowA[2]) * (highA[0] - lowA[0]) < 0;
        const face = up ? [lowA, lowB, highB, highA] : [lowB, lowA, highA, highB];
        equipment.quad(...face, EQUIPMENT_MODULE_UV);
        equipment.quad(...[...face].reverse(), [EQUIPMENT_PLAIN_UV, EQUIPMENT_PLAIN_UV, EQUIPMENT_PLAIN_UV, EQUIPMENT_PLAIN_UV]);
        for (const p of [...face, ...[...face].reverse()]) equipment.ao.push(p[0] - roofMin[0], p[2] - roofMin[1], roofChart);
      }
    }
  }
  return [
    aoPrimitive(walls, facadeMaterial),
    aoPrimitive(roof, roofMaterial),
    aoPrimitive(parapet, parapetMaterial),
    aoPrimitive(equipment, equipmentMaterial),
  ];
}

// ---------------------------------------------------------------- mass forms
// data/building-forms.json (fetch/buildingForms.mjs) gives a building disjoint masses: plan rings (outer and courtyard
// rings) with a base and a roof-slab height over the building's lowest ground, a kind (main, wing, podium, tower, core,
// raised, canopy, annex), floors, a parapet and a roof (flat, or the LOD4 roof triangles of a gable, hipped, mono-pitch
// or curved roof). Neighbouring masses share walls, so a wall is drawn only where it is exposed: along each edge, the
// stretches whose outside lies in no other solid (the masses and parts of every building), and up each stretch the
// heights no such solid covers. Storeyed masses get facade cells there on the building's storey grid (courtyard walls
// too); rooftop cores, canopy fascias, gables, soffits under raised masses and columns are plain walls in the eave
// colour on the parapet primitive, so no mass adds a material or a draw call.
const FORMS = path.join(DATA, "building-forms.json");
// Low masses of a uni.glb node that lie mostly outside the node's own outline are drawn with CampusBuildings (see the
// stage below): under 6 m, or under a third of the node's tallest mass up to 10 m (B7's two-storey east wing beside its
// 31 m block, which uni.glb's outline leaves out).
const lowMassLimit = (parts) => Math.max(6, Math.min(10, Math.max(...parts.map((p) => p.heightMetres)) / 3));
const EXPOSURE_EPS = metres(0.1);
const PLAIN_KINDS = new Set(["core", "canopy"]);

function loadForms() {
  if (!existsSync(FORMS)) return new Map();
  return new Map(JSON.parse(readFileSync(FORMS, "utf8")).buildings.map((b) => [b.key, b]));
}

const formKey = (b) => b.nodeName ?? (b.nodeId && b.label ? b.nodeId : b.footprintSource);

function ringBox(rings) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const ring of rings) {
    for (const [x, z] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  return [minX, minZ, maxX, maxZ];
}

// Lowest terrain under a building's ground-standing masses (the LOD4 heights are measured from its lowest wall foot).
function formGround(building, heightAt) {
  if (building.groundScene !== undefined) return building.groundScene;
  const standing = building.parts.filter((p) => !(p.baseMetres > 0));
  return Math.min(...(standing.length ? standing : building.parts).flatMap((p) => [...p.outer, ringCentroid(p.outer)]).map(([x, z]) => heightAt(x, z)));
}

// Solids every wall checks its exposure against: plan rings with absolute bottom and top (scene units). A pitched roof
// covers its neighbours only up to its eave.
function solidsOf(building, heightAt) {
  if (building.massForm) {
    const ground = formGround(building, heightAt);
    return building.parts.map((part) => ({
      part,
      outer: part.outer,
      holes: part.holes,
      bottom: ground + metres(part.baseMetres ?? 0),
      top: ground + metres(part.triangles ? part.eaveMetres ?? part.heightMetres : part.heightMetres),
      box: ringBox([part.outer]),
    }));
  }
  return building.parts.flatMap((part) => {
    if (!part.outer || part.outer.length < 3) return [];
    const ground = Math.min(...[...part.outer, ringCentroid(part.outer)].map(([x, z]) => heightAt(x, z)));
    return partMasses(part).map((mass) => ({
      part: mass,
      outer: mass.outer,
      holes: mass.holes,
      bottom: ground + metres(mass.fromMetres),
      top: ground + metres(mass.heightMetres),
      box: ringBox([mass.outer]),
    }));
  });
}

function crossingT(p, q, a, b) {
  const rx = q[0] - p[0];
  const rz = q[1] - p[1];
  const sx = b[0] - a[0];
  const sz = b[1] - a[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a[0] - p[0]) * sz - (a[1] - p[1]) * sx) / den;
  const u = ((a[0] - p[0]) * rz - (a[1] - p[1]) * rx) / den;
  return u >= 0 && u <= 1 && t > 1e-6 && t < 1 - 1e-6 ? t : null;
}

const insideSolid = (p, s) => pointInRing(p, s.outer) && !s.holes.some((h) => pointInRing(p, h));

function subtractRanges([lo, hi], covers) {
  let pieces = [[lo, hi]];
  for (const [b, t] of covers) {
    pieces = pieces.flatMap(([p0, p1]) => {
      if (t <= p0 || b >= p1) return [[p0, p1]];
      return [[p0, Math.min(p1, b)], [Math.max(p0, t), p1]].filter(([x, y]) => y - x > 0.005);
    });
  }
  return pieces;
}

// Exposed stretches of edge a -> b of an ordered ring (outside on its right, the side its quads face): the edge offset
// EXPOSURE_EPS outwards is cut where it crosses another solid's ring, and each stretch keeps the part of [lo, hi] that
// no solid around its midpoint covers. Stretches with the same exposure are merged.
function exposureRuns(a, b, self, solids, lo, hi) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = -(b[1] - a[1]) / length;
  const nz = (b[0] - a[0]) / length;
  const p = [a[0] + nx * EXPOSURE_EPS, a[1] + nz * EXPOSURE_EPS];
  const q = [b[0] + nx * EXPOSURE_EPS, b[1] + nz * EXPOSURE_EPS];
  const box = [Math.min(p[0], q[0]) - EXPOSURE_EPS, Math.min(p[1], q[1]) - EXPOSURE_EPS, Math.max(p[0], q[0]) + EXPOSURE_EPS, Math.max(p[1], q[1]) + EXPOSURE_EPS];
  const near = solids.filter((s) => s.part !== self.part && s.box[0] <= box[2] && s.box[2] >= box[0] && s.box[1] <= box[3] && s.box[3] >= box[1] && s.top > lo && s.bottom < hi);
  const ts = [0, 1];
  for (const s of near) {
    for (const ring of [s.outer, ...s.holes]) {
      for (let i = 0; i < ring.length; i += 1) {
        const t = crossingT(p, q, ring[i], ring[(i + 1) % ring.length]);
        if (t !== null) ts.push(t);
      }
    }
  }
  ts.sort((x, y) => x - y);
  const runs = [];
  for (let k = 0; k + 1 < ts.length; k += 1) {
    const [t0, t1] = [ts[k], ts[k + 1]];
    if ((t1 - t0) * length < 1e-4) continue;
    const m = (t0 + t1) / 2;
    const point = [p[0] + (q[0] - p[0]) * m, p[1] + (q[1] - p[1]) * m];
    const ranges = subtractRanges([lo, hi], near.filter((s) => insideSolid(point, s)).map((s) => [s.bottom, s.top]));
    const last = runs.at(-1);
    if (last && JSON.stringify(last.ranges) === JSON.stringify(ranges)) last.t1 = t1;
    else runs.push({ t0, t1, ranges });
  }
  return runs.filter((run) => run.ranges.length);
}

// Roof surface of a pitched or curved mass from its triangles ([x, z, absolute y] corners): the height at a plan point
// and the parameters where an edge crosses the triangles' plan edges (the kinks of the wall-top profile there).
function roofSurface(triangles) {
  const height = ([x, z]) => {
    let best = null;
    for (const [a, b, c] of triangles) {
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
      const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
      if (best === null || y > best) best = y;
    }
    return best;
  };
  const kinks = (a, b) => {
    const ts = [0, 1];
    for (const tri of triangles) {
      for (let i = 0; i < 3; i += 1) {
        const t = crossingT(a, b, [tri[i][0], tri[i][2]], [tri[(i + 1) % 3][0], tri[(i + 1) % 3][2]]);
        if (t !== null) ts.push(t);
      }
    }
    return [...new Set(ts.map((t) => Math.round(t * 1e6) / 1e6))].sort((x, y) => x - y);
  };
  return { height, kinks };
}

// Walls of one ring of a mass over its exposed stretches. Facade masses get atlas cells (window rows on `storey` from
// `ground`, the ground row for the first storey, the entrance row and canopy on the entrance edge) and the plinth band
// below the ground line; plain masses get eave-coloured quads. Under a pitched roof the cells stop at the edge's eave
// line and a plain gable fills the wall up to the roof profile.
function addMassRing(ctx, solid, ordered, { facade, cellsOnGround = false, entranceEdge = -1, canopy = false, seed }) {
  const { walls, plain, charts, solids, look, tile, ground, plinthBase, storey, plainColour, surface } = ctx;
  const rng = mulberry32(seed);
  const bay = metres(look.bay ?? 3.6);
  const peak = solid.peak;
  const depth = peak - plinthBase;
  let distance = 0;
  let chart = -1;
  let chartStart = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (charts && (chart < 0 || (distance > chartStart && distance - chartStart + length > AO_MAX_CHART))) {
      if (chart >= 0) charts.close(chart, distance - chartStart, depth);
      chart = charts.open();
      chartStart = distance;
    }
    const s0 = distance - chartStart;
    distance += length;
    if (length < 1e-6) continue;
    const point = (t, y, out = 0) => [a[0] + (b[0] - a[0]) * t + ((a[1] - b[1]) / length) * out, y, a[1] + (b[1] - a[1]) * t + ((b[0] - a[0]) / length) * out];
    const ao = (t, y) => [s0 + t * length, peak - y, chart];
    const quad = (mesh, t0, t1, y00, y10, y11, y01, uv, colour) => {
      mesh.quad(point(t0, y00), point(t1, y10), point(t1, y11), point(t0, y01), uv, colour);
      if (charts) mesh.ao.push(...ao(t0, y00), ...ao(t1, y10), ...ao(t1, y11), ...ao(t0, y01));
    };
    // Wall-top profile: the slab height, or the roof surface along the edge (sampled just inside the mass).
    let profile = [[0, solid.top], [1, solid.top]];
    if (surface) {
      const nx = -(b[1] - a[1]) / length;
      const nz = (b[0] - a[0]) / length;
      const inset = -metres(0.05);
      profile = surface.kinks(a, b).map((t) => {
        const y = surface.height([a[0] + (b[0] - a[0]) * t + nx * inset, a[1] + (b[1] - a[1]) * t + nz * inset]);
        return [t, y ?? solid.eave];
      });
    }
    const eave = Math.min(...profile.map((p) => p[1]));
    const top = Math.max(...profile.map((p) => p[1]));
    const bays = Math.max(1, Math.round(length / bay));
    const sliver = length < bay * 0.45;
    let canopyDone = !canopy;
    for (const run of exposureRuns(a, b, solid, solids, solid.bottom, top)) {
      for (const [lo, hi] of run.ranges) {
        const cellsTop = Math.min(hi, eave);
        // A core's wall that stands on the ground is part of the facade (a stair or lift core flush with it): cells.
        const cells = facade || (cellsOnGround && lo <= ground + 1e-3 && solid.bottom <= ground + 1e-3);
        if (cellsTop > lo + 1e-3) {
          if (lo <= ground + 1e-3 && solid.bottom <= ground + 1e-3) {
            if (cells) {
              const [p0, p1] = [plinthUv(tile, 0), plinthUv(tile, TILE_BAYS)];
              quad(walls, run.t0, run.t1, plinthBase, plinthBase, ground, ground, [p0, p1, p1, p0]);
            } else {
              quad(plain, run.t0, run.t1, plinthBase, plinthBase, ground, ground, PLAIN_UV, plainColour);
            }
          }
          if (!cells) {
            quad(plain, run.t0, run.t1, lo, lo, cellsTop, cellsTop, PLAIN_UV, plainColour);
          } else {
            const k0 = Math.max(0, Math.floor((lo - ground) / storey + 1e-6));
            const k1 = Math.ceil((cellsTop - ground) / storey - 1e-6);
            for (let k = k0; k < k1; k += 1) {
              const y0 = ground + k * storey;
              const from = Math.max(y0, lo);
              const to = Math.min(y0 + storey, cellsTop);
              if (to - from < 1e-3) continue;
              const [f0, f1] = [(from - y0) / storey, (to - y0) / storey];
              const row = k === 0 ? ROWS.GROUND : rng() < 0.5 ? ROWS.UPPER_A : ROWS.UPPER_B;
              const cell = (g0, g1, tileRow, u) => {
                const c0 = Math.max(g0, run.t0 * bays);
                const c1 = Math.min(g1, run.t1 * bays);
                if (c1 - c0 < 1e-6) return;
                quad(walls, c0 / bays, c1 / bays, from, from, to, to,
                  [tileUv(tile, tileRow, u(c0), f0), tileUv(tile, tileRow, u(c1), f0), tileUv(tile, tileRow, u(c1), f1), tileUv(tile, tileRow, u(c0), f1)]);
              };
              if (sliver) {
                cell(0, bays, row, (c) => (c / bays) * Math.min(0.3, length / bay));
                continue;
              }
              const groups = [];
              const push = (g0, g1) => {
                for (let g = g0; g < g1; g += TILE_BAYS) groups.push([g, Math.min(g1, g + TILE_BAYS), row]);
              };
              if (k === 0 && i === entranceEdge) {
                const n = Math.min(TILE_BAYS, bays);
                const e0 = Math.floor((bays - n) / 2);
                push(0, e0);
                groups.push([e0, e0 + n, ROWS.ENTRANCE]);
                push(e0 + n, bays);
                const middle = (e0 + n / 2) / bays;
                if (!canopyDone && middle > run.t0 && middle < run.t1 && from <= ground + 1e-3) {
                  const half = Math.min(n / 2, 1) / bays;
                  const y = ground + Math.min(0.72 * storey, metres(3.6));
                  addCanopy(walls, point, middle - half, middle + half, y, canopyUv(tile), charts ? ao(middle, y) : null);
                  canopyDone = true;
                }
              } else {
                push(0, bays);
              }
              for (const [g0, g1, tileRow] of groups) {
                if (tileRow === ROWS.ENTRANCE) cell(g0, g1, tileRow, (c) => TILE_BAYS / 2 - (g1 - g0) / 2 + (c - g0));
                else if (tileRow !== ROWS.GROUND && rng() < 0.5) cell(g0, g1, tileRow, (c) => TILE_BAYS - (c - g0));
                else cell(g0, g1, tileRow, (c) => c - g0);
              }
            }
          }
        }
        // Gable above the eave line, up to the roof profile.
        if (surface && hi > eave + 1e-3) {
          for (let k = 0; k + 1 < profile.length; k += 1) {
            const [ta, ya] = profile[k];
            const [tb, yb] = profile[k + 1];
            const t0 = Math.max(ta, run.t0);
            const t1 = Math.min(tb, run.t1);
            if (t1 - t0 < 1e-6) continue;
            const at = (t) => Math.min(hi, ya + ((yb - ya) * (t - ta)) / (tb - ta || 1));
            const base = Math.max(eave, lo);
            if (Math.max(at(t0), at(t1)) - base < 1e-3) continue;
            quad(plain, t0, t1, base, base, Math.max(base, at(t1)), Math.max(base, at(t0)), PLAIN_UV, plainColour);
          }
        }
      }
    }
  }
  if (charts) charts.close(chart, distance - chartStart, depth);
}

// Parapet of one ring of a flat mass: both faces of the exposed stretches between the slab and the parapet top.
function addMassParapet(ctx, solid, ring, height) {
  const { plain, charts, solids, plainColour } = ctx;
  const ordered = orderedRing(ring, true);
  const lo = solid.top;
  const hi = solid.top + height;
  let distance = 0;
  let chart = -1;
  let chartStart = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (charts && (chart < 0 || (distance > chartStart && distance - chartStart + length > AO_MAX_CHART))) {
      if (chart >= 0) charts.close(chart, distance - chartStart, hi - lo);
      chart = charts.open();
      chartStart = distance;
    }
    const s0 = distance - chartStart;
    distance += length;
    if (length < 1e-6) continue;
    const p = (t, y) => [a[0] + (b[0] - a[0]) * t, y, a[1] + (b[1] - a[1]) * t];
    for (const run of exposureRuns(a, b, solid, solids, lo, hi)) {
      for (const [y0, y1] of run.ranges) {
        const [t0, t1] = [run.t0, run.t1];
        const aoOf = (t, y) => [s0 + t * length, hi - y, chart];
        plain.quad(p(t0, y0), p(t1, y0), p(t1, y1), p(t0, y1), PLAIN_UV, plainColour);
        plain.quad(p(t1, y0), p(t0, y0), p(t0, y1), p(t1, y1), PLAIN_UV, plainColour);
        if (charts) {
          plain.ao.push(...aoOf(t0, y0), ...aoOf(t1, y0), ...aoOf(t1, y1), ...aoOf(t0, y1));
          plain.ao.push(...aoOf(t1, y0), ...aoOf(t0, y0), ...aoOf(t0, y1), ...aoOf(t1, y1));
        }
      }
    }
  }
  if (charts) charts.close(chart, distance - chartStart, hi - lo);
}

const PLAIN_UV = Object.freeze([[0, 0], [0, 0], [0, 0], [0, 0]]);

// The roof of a pitched or curved mass: its LOD4 triangles, facing up, on the Roof_Membrane texture and colour.
function addRoofTriangles(roof, triangles, colour, uvScale) {
  for (const [a, b, c] of triangles) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n) || 1;
    n = n.map((x) => x / length);
    const corners = n[1] < 0 ? [a, c, b] : [a, b, c];
    if (n[1] < 0) n = n.map((x) => -x);
    const base = roof.vertexCount;
    for (const p of corners) roof.vertex(p, n, [p[0] * uvScale, p[2] * uvScale], colour);
    roof.triangle(base, base + 1, base + 2);
  }
}

// One building with a mass form: walls, roofs, parapets, soffits, columns, rooftop plant and solar modules, in the
// same four primitives as buildingPrimitives (facade atlas, roof membrane, parapet, equipment).
function massPrimitives(building, seed, { heightAt, facadeMaterial, tiles, looks, roofMaterial, parapetMaterial, equipmentMaterial, charts, solids }) {
  const look = looks.get(building.look);
  const tile = tiles.get(building.look);
  const greenhouse = look.pattern === "greenhouse";
  const walls = aoMesh();
  const roof = aoMesh({ colors: true });
  const plain = aoMesh({ colors: true });
  const equipment = aoMesh();
  const wallColour = linearByte(hex(look.parapet ?? look.wall));
  const trimColour = linearByte(hex(look.trim ?? look.parapet ?? look.wall));
  const rng = mulberry32(seed);
  const ground = formGround(building, heightAt);
  const plinthBase = ground - metres(1.5);
  const storeyMetres = building.form?.storeyMetres ?? 4.0;
  const entrance = entranceOf(building, building.entry);
  const lod4Canopy = building.parts.some((p) => p.kind === "canopy");
  const roofFallback = building.roofColour ?? [255, 255, 255, 255];
  for (const [index, part] of building.parts.entries()) {
    const solid = solids.find((s) => s.part === part);
    const top = ground + metres(part.heightMetres);
    const bottom = ground + metres(part.baseMetres ?? 0);
    const floors = Math.max(1, Math.round(part.heightMetres / storeyMetres));
    const storey = (top - ground) / floors;
    const surface = part.triangles ? roofSurface(part.triangles.map((t) => t.map(([x, z, h]) => [x, ground + metres(h), z]))) : null;
    const shape = { ...solid, top: surface ? ground + metres(part.eaveMetres ?? part.heightMetres) : top, eave: ground + metres(part.eaveMetres ?? part.heightMetres), peak: top, bottom };
    const ctx = { walls, plain, charts, solids, look, tile, ground, plinthBase, storey, plainColour: part.kind === "canopy" ? trimColour : wallColour, surface };
    const facade = !PLAIN_KINDS.has(part.kind);
    const onEntrance = entrance?.part === part;
    // Cores take the building's storey grid, so the cells of a facade-flush core line up with the walls beside it.
    const coreCtx = part.kind === "core" ? { ...ctx, storey: metres(storeyMetres) } : ctx;
    addMassRing(coreCtx, shape, orderedRing(part.outer, true), { facade, cellsOnGround: part.kind === "core", entranceEdge: onEntrance ? entrance.edge : -1, canopy: onEntrance && Boolean(building.entry) && !greenhouse && !lod4Canopy, seed: seed * 31 + index * 7 });
    part.holes.forEach((hole, k) => addMassRing(ctx, shape, orderedRing(hole, false), { facade, seed: seed * 31 + index * 7 + k + 1 }));
    const colour = part.roofColour ?? roofFallback;
    const roofFrom = roof.vertexCount;
    if (surface) {
      addRoofTriangles(roof, part.triangles.map((t) => t.map(([x, z, h]) => [x, ground + metres(h), z])), colour, 1 / metres(ROOF_METRES));
    } else {
      roof.horizontalPolygon(part.outer, part.holes, top, { uvScale: 1 / metres(ROOF_METRES), color: colour });
    }
    const uvRng = mulberry32(seed * 7919 + roofFrom);
    const turn = Math.floor(uvRng() * 4);
    const [ou, ov] = [uvRng(), uvRng()];
    for (let k = roofFrom * 2; k < roof.uvs.length; k += 2) {
      const [u, v] = [roof.uvs[k], roof.uvs[k + 1]];
      const [ru, rv] = [[u, v], [-v, u], [-u, -v], [v, -u]][turn];
      roof.uvs[k] = ru + ou;
      roof.uvs[k + 1] = rv + ov;
    }
    charts.addPlanar(roof, roofFrom);
    const roofChart = charts.charts.length - 1;
    const roofMin = [Math.min(...part.outer.map((p) => p[0])), Math.min(...part.outer.map((p) => p[1]))];
    if (bottom > ground + 1e-3) {
      const from = plain.vertexCount;
      plain.horizontalPolygon(part.outer, part.holes, bottom, { down: true, color: trimColour });
      charts.addPlanar(plain, from);
      for (const column of part.columns ?? []) addWalls(plain, column, true, ground - metres(0.3), bottom, charts, { colour: trimColour });
    }
    if (greenhouse || surface) continue;
    const parapet = metres(part.kind === "canopy" ? 0 : part.parapetMetres ?? 0.9);
    if (parapet > 0) for (const ring of [part.outer, ...part.holes]) addMassParapet(ctx, shape, ring, parapet);
    if (PLAIN_KINDS.has(part.kind) || part.kind === "annex") continue;
    const areaMetres = Math.abs(ringArea(part.outer)) / UNIT_AREA;
    const units = areaMetres > 300 ? Math.min(6, 1 + Math.floor(areaMetres / 700)) : 0;
    const angle = dominantAngle(part.outer);
    const xs = part.outer.map((p) => p[0]);
    const zs = part.outer.map((p) => p[1]);
    const boxesFrom = equipment.vertexCount;
    for (let placed = 0, tries = 0; placed < units && tries < 80; tries += 1) {
      const sx = metres(2.5 + rng() * 4);
      const sz = metres(2 + rng() * 3);
      const cx = Math.min(...xs) + rng() * (Math.max(...xs) - Math.min(...xs));
      const cz = Math.min(...zs) + rng() * (Math.max(...zs) - Math.min(...zs));
      if (!pointInRing([cx, cz], part.outer) || part.holes.some((h) => pointInRing([cx, cz], h))) continue;
      if (minEdgeDistance([cx, cz], [part.outer, ...part.holes]) < Math.hypot(sx, sz) / 2 + metres(1.2)) continue;
      addBox(equipment, cx, cz, sx, sz, top, top + metres(1.4 + rng() * 1.6), angle, charts);
      placed += 1;
    }
    for (let k = boxesFrom * 2; k < equipment.uvs.length; k += 2) [equipment.uvs[k], equipment.uvs[k + 1]] = EQUIPMENT_PLAIN_UV;
    for (const corners of building.panelModules?.[index] ?? []) {
      const low = top + MODULE_LIFT;
      const [lowA, lowB, highB, highA] = corners.map(([x, z], k) => [x, k < 2 ? low : low + MODULE_RISE, z]);
      const up = (lowB[0] - lowA[0]) * (highA[2] - lowA[2]) - (lowB[2] - lowA[2]) * (highA[0] - lowA[0]) < 0;
      const face = up ? [lowA, lowB, highB, highA] : [lowB, lowA, highA, highB];
      equipment.quad(...face, EQUIPMENT_MODULE_UV);
      equipment.quad(...[...face].reverse(), [EQUIPMENT_PLAIN_UV, EQUIPMENT_PLAIN_UV, EQUIPMENT_PLAIN_UV, EQUIPMENT_PLAIN_UV]);
      for (const p of [...face, ...[...face].reverse()]) equipment.ao.push(p[0] - roofMin[0], p[2] - roofMin[1], roofChart);
    }
  }
  // BLD_D4 anchors the traffic frame with its bounding-box centre (CityModel, campusModelAsset.test.mjs): two 1 cm
  // triangles 2 m under the terrain make the new form's box symmetric about the uni.glb centre.
  if (building.anchorCentre) {
    const [cx, cz] = building.anchorCentre;
    let hx = 0;
    let hz = 0;
    for (const mesh of [walls, roof, plain, equipment]) {
      for (let k = 0; k < mesh.positions.length; k += 3) {
        hx = Math.max(hx, Math.abs(mesh.positions[k] - cx));
        hz = Math.max(hz, Math.abs(mesh.positions[k + 2] - cz));
      }
    }
    const y = plinthBase - metres(0.5);
    const d = metres(0.01);
    for (const [x, z] of [[cx - hx, cz - hz], [cx + hx, cz + hz]]) {
      const base = walls.vertexCount;
      for (const p of [[x, y, z], [x + Math.sign(cx - x) * d, y, z], [x, y, z + Math.sign(cz - z) * d]]) walls.vertex(p, [0, 1, 0], [0, 0]);
      walls.triangle(base, base + 1, base + 2);
      walls.ao.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  }
  return [
    aoPrimitive(walls, facadeMaterial),
    aoPrimitive(roof, roofMaterial),
    aoPrimitive(plain, parapetMaterial),
    aoPrimitive(equipment, equipmentMaterial),
  ];
}

// ---------------------------------------------------------------- stage
// detailedStructures: plan rings of the structures stages/furniture.mjs models in detail (the 구령대). A campus
// footprint holding one keeps its label, pick proxy, photo mask and tree mask, but its generic mass is not drawn.
export async function buildBuildings({ glb, inputs, detailedStructures = [], selectOnly = false }) {
  const { source, footprints, roadZones, heightAt } = inputs;

  // ---- building selection
  // Records data/scnu-building-names.json marks as demolished (absent from current imagery) are not modelled.
  const demolished = footprints.filter((b) => b.status === "demolished");
  console.log(`demolished SCNU records skipped: ${demolished.length} (${demolished.map((b) => b.footprintSource.replace(/^.* record /, "record ")).join(", ")})`);
  const catalogue = loadCatalogue();
  // Floor/height corrections from data/scnu-facades.json: on campus the register attributes of GIS건물통합정보 sit on
  // the wrong footprints (VWorld LT_C_BLDGINFO dong_nm names the building each record belongs to).
  const corrections = [];
  const footprintParts = footprints.flatMap((b, index) => (b.status === "demolished" ? [] : b.polygons.map((polygon) => {
    const [outer, ...holes] = polygon.map(toModelRing);
    const entry = recordEntry(catalogue, b.label ?? b.name);
    const part = {
      index,
      name: b.name,
      nameSource: b.nameSource,
      label: b.label,
      nodeId: b.nodeId,
      floors: b.floors,
      heightMetres: b.heightMetres,
      footprintSource: b.footprintSource,
      floorsSource: b.floorsSource,
      outer,
      holes,
      centroid: ringCentroid(outer),
      areaMetres: Math.abs(ringArea(outer)) / UNIT_AREA,
      entry,
    };
    if (entry?.floors || entry?.heightMetres) {
      corrections.push(`${b.label ?? b.name} (${b.footprintSource.replace(/^.* record /, "record ")}): floors ${b.floors || "-"} -> ${entry.floors ?? b.floors}, ` +
        `height ${b.heightMetres || "-"} m -> ${entry.heightMetres ?? "rule"} m (${entry.floorsSource ?? "floors unchanged"}; ${entry.heightSource ?? "height rule"})`);
      if (entry.floors) Object.assign(part, { floors: entry.floors, floorsSource: entry.floorsSource });
      if (entry.heightMetres) Object.assign(part, { heightMetres: entry.heightMetres, heightOverride: entry.heightSource });
    }
    return part;
  })));

  const bldNodes = source.scene.children.flatMap((object, index) => {
    const rawName = source.rawNames[index];
    return object.isMesh && rawName.startsWith("BLD_") ? [{ object, index, rawName, footprint: meshFootprint(object) }] : [];
  });
  // A footprint belongs to an outline when its centroid lies inside it, or (for U- and L-shaped
  // buildings whose centroid falls outside the outline itself) within 5 m of the outline's centroid.
  const matchesIn = (outline) => {
    const [cx, cz] = ringCentroid(outline);
    return footprintParts.filter((part) => !isGroundFeature(part) &&
      (pointInRing(part.centroid, outline) || Math.hypot(part.centroid[0] - cx, part.centroid[1] - cz) < metres(5)));
  };
  const areaOf = (ring) => Math.abs(ringArea(ring)) / UNIT_AREA;
  // An outline is replaced only when the source footprints cover the uni.glb outline to within 15 %.
  const areaAgrees = (matches, outline) => {
    const ratio = matches.reduce((sum, part) => sum + part.areaMetres, 0) / areaOf(outline);
    return ratio >= 0.85 && ratio <= 1.15;
  };

  // Footprints traced from imagery (OSM) sit a few metres off the cadastral frame uni.glb uses. The
  // median centroid offset over one-to-one matches of similar area moves them onto uni.glb (and onto
  // the roads); for cadastral footprints it comes out close to zero.
  let footprintShift;
  {
    const deltas = bldNodes.flatMap(({ footprint }) => {
      const matches = matchesIn(footprint.outer);
      if (matches.length !== 1 || !areaAgrees(matches, footprint.outer)) return [];
      const [cx, cz] = ringCentroid(footprint.outer);
      return [[cx - matches[0].centroid[0], cz - matches[0].centroid[1]]];
    });
    const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
    const [dx, dz] = deltas.length >= 5 ? [median(deltas.map((d) => d[0])), median(deltas.map((d) => d[1]))] : [0, 0];
    const move = (ring) => ring.map(([x, z]) => [x + dx, z + dz]);
    for (const part of footprintParts) {
      part.outer = move(part.outer);
      part.holes = part.holes.map(move);
      part.centroid = ringCentroid(part.outer);
    }
    footprintShift = [dx, dz];
    console.log(`footprint shift onto uni.glb: ${(dx / metres(1)).toFixed(2)} m east, ${(-dz / metres(1)).toFixed(2)} m north (median of ${deltas.length} matches)`);
  }

  // Tower masses (data/scnu-facades.json tower): the convex hull of the named VWorld LOD4 roof levels, shifted like
  // the footprints; partMasses clips it to the part.
  const towers = [];
  for (const part of footprintParts) {
    const tower = part.entry?.tower;
    if (!tower) continue;
    const levels = catalogue.lod4.get(tower.lod4)?.roofLevels;
    const points = (tower.levels ?? [0]).flatMap((k) => levels?.[k]?.hull ?? []);
    if (points.length < 3) {
      console.warn(`tower for ${part.label ?? part.name}: no VWorld LOD4 roof level ${tower.levels} for ${tower.lod4} in lod4-facades.json; left out`);
      continue;
    }
    const hull = convexHull(points.map(([lon, lat]) => {
      const [x, z] = geoToModel(lon, lat);
      return [x + footprintShift[0], z + footprintShift[1]];
    }));
    part.tower = { floors: tower.floors, heightMetres: tower.heightMetres, floorsSource: tower.floorsSource, hull };
    towers.push(`${part.label ?? part.name} (${part.footprintSource.replace(/^.* record /, "record ")}): ${tower.floors} floors, ${tower.heightMetres} m over LOD4 roof level ${(tower.levels ?? [0]).join("+")}`);
  }

  const used = new Set();
  const selectableBuildings = [];
  const heightLog = [];
  // Heights the former 6.5 m storey limit would have given differently (logged).
  const ratioChanges = [];
  const heightWithLog = (part, isSCNU, label) => {
    const now = heightOf(part, isSCNU);
    const before = heightOf(part, isSCNU, 6.5);
    if (now && before && Math.abs(now.heightMetres - before.heightMetres) > 0.05) {
      ratioChanges.push(`${label}: ${before.heightMetres.toFixed(1)} m (${before.heightSource}) -> ${now.heightMetres.toFixed(1)} m (${now.heightSource})`);
    }
    return now;
  };

  for (const { object, rawName, footprint } of bldNodes) {
    const materialName = [].concat(object.material)[0]?.name ?? "";
    const inside = matchesIn(footprint.outer);
    // No footprint centred inside the outline: take floors from one whose outline contains its centre.
    const outlineCentre = ringCentroid(footprint.outer);
    const matches = inside.length ? inside : footprintParts.filter((part) => !isGroundFeature(part) && pointInRing(outlineCentre, part.outer));
    matches.forEach((part) => used.add(part.index));
    const sourceHeight = (footprint.topY - footprint.minY) / metres(1);
    const kept = { heightMetres: Math.max(sourceHeight, MIN_HEIGHT), heightSource: "uni.glb outline height" };
    const name = matches.map((part) => part.name).find(Boolean) ?? "";
    // BLD_D4 anchors the traffic frame through its bounding box, so it keeps the original outline. A node whose
    // outline is only a corner of the record around it keeps that outline too, unless the record's entry asks for
    // the record's footprint (useRecordFootprint: the uni.glb outline leaves most of the building out).
    const useRecord = !inside.length && matches.length > 0 && matches.every((m) => m.entry?.useRecordFootprint);
    const keepOutline = rawName === "BLD_D4" || (!inside.length && !useRecord) || (inside.length > 0 && !areaAgrees(inside, footprint.outer));
    const heights = matches.map((part) => heightWithLog(part, true, `${rawName} ${bareName(part.label ?? part.name)}`)).filter(Boolean);
    const parts = keepOutline
      ? [{
        outer: footprint.outer,
        holes: footprint.holes,
        ...(heights.length ? heights.reduce((a, b) => (b.heightMetres > a.heightMetres ? b : a)) : kept),
        floors: Math.max(0, ...matches.map((m) => m.floors || 0)) || Math.round(sourceHeight / 3.6),
        tower: matches.find((m) => m.tower)?.tower,
      }]
      : matches.map((part) => ({ outer: part.outer, holes: part.holes, ...(heightOf(part, true) ?? kept), floors: part.floors, tower: part.tower }));
    let floorsSource = [...new Set(matches.map((m) => m.floorsSource).filter((s) => s && s !== "none"))].join(", ") || "none";
    // A node entry sets the look, and floors/height where several nodes share one record (BLD_C1, BLD_C1.001).
    const nodeEntry = catalogue.byNode.get(rawName);
    if (nodeEntry?.floors || nodeEntry?.heightMetres) {
      corrections.push(`${rawName} ${bareName(name)}: floors ${parts[0].floors} -> ${nodeEntry.floors ?? parts[0].floors}, height ${parts[0].heightMetres.toFixed(1)} m ` +
        `(${parts[0].heightSource}) -> ${nodeEntry.heightMetres ?? parts[0].heightMetres} m (${nodeEntry.floorsSource ?? "floors unchanged"}; ${nodeEntry.heightSource ?? "height unchanged"})`);
      for (const part of parts) {
        if (nodeEntry.floors) part.floors = nodeEntry.floors;
        if (nodeEntry.heightMetres) Object.assign(part, { heightMetres: nodeEntry.heightMetres, heightSource: nodeEntry.heightSource });
      }
      if (nodeEntry.floorsSource) floorsSource = nodeEntry.floorsSource;
    }
    const entry = nodeEntry ?? matches.map((m) => m.entry).find(Boolean) ?? null;
    const look = entry?.look ?? (/Glass/.test(materialName) ? "greenhouse" : genericLook(name, Math.abs(ringArea(footprint.outer)) / UNIT_AREA, true));
    const footprintSource = keepOutline ? "uni.glb outline" : [...new Set(matches.map((m) => m.footprintSource))].join(", ");
    if (useRecord) corrections.push(`${rawName}: footprint uni.glb outline -> ${footprintSource} (useRecordFootprint)`);
    heightLog.push({ label: rawName, footprintSource, floorsSource, heightSource: parts[0].heightSource, heightMetres: parts[0].heightMetres });
    selectableBuildings.push({ nodeName: rawName, displayName: name, look, entry, footprintSource, floorsSource, heightSource: parts[0].heightSource, parts });
  }

  // Campus area: inside the hull of known campus buildings and close to a campus road zone.
  const campusPoints = [
    ...selectableBuildings.flatMap((b) => b.parts.map((p) => ringCentroid(p.outer))),
    ...footprintParts.filter((p) => /순천대/.test(p.name)).map((p) => p.centroid),
  ];
  const campusHull = (() => {
    const pts = [...campusPoints].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (const p of pts.reverse()) {
      while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  })();
  const distanceToRoads = (point) => {
    let best = Infinity;
    for (const polygon of roadZones) {
      if (pointInRing(point, polygon[0])) return 0;
      const ring = polygon[0];
      for (let i = 0; i < ring.length; i += 1) best = Math.min(best, segmentDistance(point, ring[i], ring[(i + 1) % ring.length]));
    }
    return best;
  };

  const campusBuildings = [];
  // Off-campus buildings are not modelled; their lots are painted as plain ground and kept free of trees.
  const offCampusLots = [];
  for (const part of footprintParts) {
    if (used.has(part.index) || isGroundFeature(part)) continue;
    const named = /순천대/.test(part.name);
    if (part.areaMetres < 12 || (!named && !(pointInRing(part.centroid, campusHull) && distanceToRoads(part.centroid) < metres(14)))) {
      offCampusLots.push(part.outer);
      continue;
    }
    const isSCNU = SCNU_NAME.test(part.name) || bldNodes.some(({ footprint }) => part.outer.some((p) => pointInRing(p, footprint.outer)));
    const height = heightWithLog(part, isSCNU, part.label ?? (part.name || "(unnamed)")) ?? assumedHeight(part.name, isSCNU);
    heightLog.push({ label: part.name || "(unnamed)", footprintSource: part.footprintSource, floorsSource: part.floorsSource, ...height });
    campusBuildings.push({
      index: part.index,
      drawnByFurniture: detailedStructures.some((ring) => pointInRing(ringCentroid(ring), part.outer)),
      displayName: part.name,
      label: part.label,
      nodeId: part.nodeId,
      nameSource: part.nameSource,
      footprintSource: part.footprintSource,
      floorsSource: part.floorsSource,
      entry: part.entry,
      look: part.entry?.look ?? genericLook(part.label ?? part.name, part.areaMetres, isSCNU),
      parts: [{ outer: part.outer, holes: part.holes, ...height, floors: part.floors, tower: part.tower }],
    });
  }

  for (const entry of heightLog) {
    console.log(`building ${entry.label}: footprint ${entry.footprintSource}; floors ${entry.floorsSource}; height ${entry.heightMetres.toFixed(1)} m (${entry.heightSource})`);
  }
  const bySource = Object.groupBy(heightLog, (entry) => entry.heightSource.replace(/: .*/, ""));
  console.log(`height sources: ${Object.entries(bySource).map(([key, list]) => `${key} ${list.length}`).join(", ")}; ` +
    `floor rule used for ${(bySource.estimated ?? []).length} buildings: ${(bySource.estimated ?? []).map((e) => e.label).join(", ")}`);
  console.log(`floor/height corrections (data/scnu-facades.json): ${corrections.length}`);
  for (const line of corrections) console.log(`  ${line}`);
  console.log(`storey-height rule (2.5-5 m per storey, was 2.5-6.5 m) changed ${ratioChanges.length}: ${ratioChanges.join("; ") || "none"}`);
  console.log(`tower masses over VWorld LOD4 roof levels: ${towers.join("; ") || "none"}`);
  // fetch/buildingForms.mjs derives data/building-forms.json from this selection (the footprints before any form).
  if (selectOnly) return { selectableBuildings, campusBuildings, offCampusLots, footprintShift };

  // ---- building forms (data/building-forms.json): masses replace the footprint parts of the buildings whose form
  // comes from the VWorld LOD4 mesh or a photo-traced outline; the rest keep their footprint (and the form record).
  {
    const forms = loadForms();
    const toModel = ([lon, lat]) => {
      const [x, z] = geoToModel(lon, lat);
      return [x + footprintShift[0], z + footprintShift[1]];
    };
    const used = [];
    const detachedLog = [];
    let formOriginals = [];
    for (const building of [...selectableBuildings, ...campusBuildings]) {
      const form = forms.get(formKey(building));
      if (!form) continue;
      building.form = form;
      if (form.masses.every((m) => m.fromFootprint)) continue;
      formOriginals = building.parts;
      const heightSource = building.parts[0]?.heightSource ?? building.heightSource;
      const fromLod4 = form.source.startsWith("VWorld LOD4");
      building.parts = form.masses.map((m) => ({
        outer: cleanRing(m.outer.map(toModel)),
        holes: m.holes.map((h) => cleanRing(h.map(toModel))).filter((h) => h.length >= 3),
        heightMetres: m.topMetres,
        baseMetres: m.baseMetres,
        parapetMetres: m.parapetMetres ?? null,
        eaveMetres: m.eaveMetres ?? null,
        kind: m.kind,
        floors: m.floors,
        roof: m.roof,
        triangles: m.triangles?.map((t) => t.map(([lon, lat, h]) => [...toModel([lon, lat]), h])) ?? null,
        columns: m.columns?.map((r) => cleanRing(r.map(toModel))) ?? [],
        heightSource: m.heightSource ?? (fromLod4 ? `VWorld LOD4 ${m.roof} roof at ${m.topMetres} m (estimated)` : heightSource),
      })).filter((p) => p.outer.length >= 3);
      building.massForm = true;
      building.groundScene = formGround(building, heightAt);
      used.push(`${formKey(building)} ${building.parts.length}`);
      // A uni.glb node keeps its place in the traffic frame (campusModelAsset.test.mjs compares bounding-box centres):
      // low masses (under 6 m) that lie mostly more than 2 m outside the node's own outline are drawn with
      // CampusBuildings instead (same ground, look and lean), so the node's box stays where uni.glb has it.
      if (building.nodeName && building.nodeName !== "BLD_D4") {
        const near = (p) => originals.some((o) => pointInRing(p, o.outer) || minEdgeDistance(p, [o.outer]) < metres(2));
        const outside = (part) => {
          const [x0, z0, x1, z1] = ringBox([part.outer]);
          const step = Math.max(metres(0.5), Math.min(x1 - x0, z1 - z0) / 8);
          let total = 0;
          let out = 0;
          for (let x = x0 + step / 2; x < x1; x += step) {
            for (let z = z0 + step / 2; z < z1; z += step) {
              if (!pointInRing([x, z], part.outer)) continue;
              total += 1;
              if (!near([x, z])) out += 1;
            }
          }
          return total ? out / total : 0;
        };
        const originals = formOriginals;
        const limit = lowMassLimit(building.parts);
        const detached = building.parts.filter((part) => part.heightMetres < limit && outside(part) > 0.5);
        if (detached.length && detached.length < building.parts.length) {
          building.parts = building.parts.filter((part) => !detached.includes(part));
          campusBuildings.push({
            index: -1, drawnByFurniture: false, displayName: building.displayName, footprintSource: building.footprintSource, floorsSource: building.floorsSource,
            entry: null, look: building.look, parts: detached, massForm: true, form: building.form, groundScene: building.groundScene, detachedFrom: building.nodeName,
          });
          detachedLog.push(`${building.nodeName} ${detached.map((p) => `${p.kind} ${p.heightMetres.toFixed(1)} m`).join(", ")}`);
        }
      }
    }
    console.log(`building forms (data/building-forms.json): ${used.length} buildings built from masses (${used.join(", ")}); ` +
      `low masses outside a uni.glb node's outline drawn with CampusBuildings: ${detachedLog.join("; ") || "none"}`);
  }
  const d4 = selectableBuildings.find((b) => b.nodeName === "BLD_D4");
  if (d4?.massForm) {
    const box = new Box3().setFromObject(bldNodes.find((n) => n.rawName === "BLD_D4").object);
    d4.anchorCentre = [(box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2];
  }

  // ---- materials
  // Detail maps (U42) ship as PNG in the raw GLB; the pack step re-encodes every texture as WebP.
  // Roughness and metal come from the packed map (G, B), so both factors are 1.
  const detailTextures = (textures) => ({
    normalTexture: { index: glb.addTexture(textures.normal, "image/png"), texCoord: 0 },
    metallicRoughnessTexture: { index: glb.addTexture(textures.arm, "image/png"), texCoord: 0 },
  });
  // Facade atlas: one tile per look in use (lib/facadeAtlas.mjs); every wall of every building on one material.
  const usedLooks = [...new Set([...selectableBuildings, ...campusBuildings].map((b) => b.look))];
  const facadeAtlas = await buildFacadeAtlas(usedLooks.map((id) => ({ ...catalogue.looks.get(id), id })));
  const clamped = { repeat: false };
  const facadeMaterial = glb.addMaterial({
    name: "Facade_Atlas",
    pbrMetallicRoughness: {
      baseColorTexture: { index: glb.addTexture(await jpeg(facadeAtlas.color, 90), "image/jpeg", clamped) },
      metallicRoughnessTexture: { index: glb.addTexture(facadeAtlas.arm, "image/png", clamped), texCoord: 0 },
      metallicFactor: 1,
      roughnessFactor: 1,
    },
    normalTexture: { index: glb.addTexture(facadeAtlas.normal, "image/png", clamped), texCoord: 0 },
    emissiveTexture: { index: glb.addTexture(await jpeg(facadeAtlas.emissive, 85), "image/jpeg", clamped) },
    emissiveFactor: [1, 1, 1],
  });
  {
    const byLook = Map.groupBy([...selectableBuildings, ...campusBuildings], (b) => b.look);
    console.log(`facade atlas: ${usedLooks.length} looks, ${facadeAtlas.width} x ${facadeAtlas.height} px, one Facade_Atlas material; ` +
      [...byLook].map(([id, list]) => `${id} ${list.length}`).join(", "));
  }
  const roof = await roofTexture();
  const roofDetail = detailTextures(roof);
  const roofMaterial = glb.addMaterial({
    name: "Roof_Membrane",
    pbrMetallicRoughness: {
      baseColorTexture: { index: glb.addTexture(await jpeg(roof.color), "image/jpeg") },
      metallicRoughnessTexture: roofDetail.metallicRoughnessTexture,
      metallicFactor: 1,
      roughnessFactor: 1,
    },
    normalTexture: roofDetail.normalTexture,
  });
  const parapetMaterial = glb.addMaterial({
    name: "Roof_Parapet",
    // The coping colour of each building's look comes per vertex (COLOR_0), so the factor is white.
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 },
    // Single-sided: the parapet already has an inward and an outward quad per edge. Double-sided, the two
    // coincident quads z-fight, which shows once their baked AO differs (open sky outside, roof inside).
  });
  // Rooftop plant and photovoltaic modules: one material, both looks in its atlas (lib/textures.mjs).
  const atlas = equipmentAtlas();
  const equipmentMaterial = glb.addMaterial({
    name: "Roof_Equipment",
    pbrMetallicRoughness: {
      baseColorTexture: { index: glb.addTexture(atlas.color, "image/png") },
      metallicRoughnessTexture: { index: glb.addTexture(atlas.metalRough, "image/png"), texCoord: 0 },
      metallicFactor: 1,
      roughnessFactor: 1,
    },
  });
  // Roof colours: orthophoto first, then OSM tags (see roof colours above); solar panels from the photo.
  // PANEL_REVIEW lists roofs whose photo modules were checked by eye on the z19 mosaic and rejected.
  const PANEL_REVIEW = new Map([
    ["BLD_D4", "glazed skylights read as modules on z19; no PV modelled"],
    ["BLD_D2", "blue skylights and glazed wing ends read as modules on z19; no PV modelled"],
    ["BLD_B3", "the strip along the north parapet is facade and gutter shade on z19, not PV"],
  ]);
  {
    const photoLog = [];
    const panelLog = [];
    const surfaces = {};
    for (const building of [...selectableBuildings, ...campusBuildings]) {
      const label = building.nodeName ?? (building.displayName || "(unnamed)");
      // A mass form knows its roof's relief lean in the photo (building-forms.json `lean`, metres per metre of height):
      // its roofs are sampled where the photo shows them, and the modules found there are moved back onto the roof.
      const lean = building.massForm ? building.form?.lean : null;
      const shiftOf = (part) => (lean ? [metres(lean[0] * (part.heightMetres + (part.parapetMetres ?? 0))), -metres(lean[1] * (part.heightMetres + (part.parapetMetres ?? 0)))] : [0, 0]);
      const shifted = (part) => {
        const [dx, dz] = shiftOf(part);
        const move = (ring) => ring.map(([x, z]) => [x + dx, z + dz]);
        return { ...part, outer: move(part.outer), holes: part.holes.map(move) };
      };
      const roofParts = building.massForm ? building.parts.filter((p) => p.kind !== "canopy").map(shifted) : building.parts;
      const photo = sampleRoofPhoto(inputs.ortho, inputs.orthoCalibration, roofParts.length ? roofParts : building.parts);
      const review = PANEL_REVIEW.get(building.nodeName);
      const panelsOn = (part) => !building.massForm || (!part.triangles && !PLAIN_KINDS.has(part.kind) && part.kind !== "annex" && Math.abs(ringArea(part.outer)) / UNIT_AREA >= 40);
      building.panelModules = building.parts.map((part) => {
        if (photo.status !== "photo" || review || catalogue.looks.get(building.look).pattern === "greenhouse" || !panelsOn(part)) return [];
        if (!lean) return panelModules(inputs.ortho, part, part.heightMetres).modules;
        const [dx, dz] = shiftOf(part);
        return panelModules(inputs.ortho, shifted(part), part.heightMetres).modules.map((corners) => corners.map(([x, z]) => [x - dx, z - dz]));
      });
      if (building.massForm) {
        for (const part of building.parts) {
          const own = sampleRoofPhoto(inputs.ortho, inputs.orthoCalibration, [shifted(part)]);
          if (own.status === "photo") part.roofColourRgb = own.rgb;
        }
      }
      const modules = building.panelModules.reduce((n, list) => n + list.length, 0);
      if (modules) panelLog.push(`${label} ${modules}`);
      if (review) panelLog.push(`${label} none (${review})`);
      if (photo.status === "photo") {
        building.roofColourRgb = photo.rgb;
        building.roofSurface = photo.surface;
        building.roofColourSource = `VWorld z19 orthophoto, median of ${photo.counts.roof} roof samples (estimated)`;
        surfaces[photo.surface] = (surfaces[photo.surface] ?? 0) + 1;
      } else {
        photoLog.push(`${label}: ${photo.status}`);
      }
      building.solarPanelModules = modules;
    }
    // OSM tags for roofs the photo could not colour
    const file = existsSync(ROOF_TAGS) ? JSON.parse(readFileSync(ROOF_TAGS, "utf8")) : null;
    if (!file) console.warn(`roof colours: ${path.basename(ROOF_TAGS)} missing (bun scripts/campus-model/fetch/roofTags.mjs)`);
    const tagged = (file?.buildings ?? []).map((entry) => {
      const [x, z] = geoToModel(...entry.centre);
      return { ...entry, point: [x + footprintShift[0], z + footprintShift[1]], colour: roofColourFromTags(entry.tags) };
    });
    const applied = [];
    for (const building of [...selectableBuildings, ...campusBuildings]) {
      if (building.roofColourRgb) continue;
      const match = tagged.find((entry) => building.parts.some((part) => pointInRing(entry.point, part.outer) &&
        !part.holes.some((hole) => pointInRing(entry.point, hole))));
      if (!match?.colour) continue;
      building.roofColourRgb = match.colour.rgb;
      building.roofColourSource = `OSM ${match.osm} ${match.colour.tag}`;
      applied.push(`${building.nodeName ?? (building.displayName || "(unnamed)")} <- ${building.roofColourSource}`);
    }
    // Every roof carries its colour as COLOR_0 on the one Roof_Membrane material, BLD_* nodes as well as the merged
    // CampusBuildings roof. BLD_* roofs used to get a Roof_Photo_* material variant instead; the dashboard tints
    // material colours (night, hover), which mixes a variant's colour towards the tint but multiplies a vertex
    // colour by it, so the vertex-coloured campus roofs rendered darker than BLD_* roofs of the same colour.
    for (const building of [...selectableBuildings, ...campusBuildings]) {
      for (const part of building.massForm ? building.parts : []) {
        if (part.roofColourRgb) part.roofColour = roofFactor(part.roofColourRgb).map((v) => Math.round(v * 255));
      }
      if (!building.roofColourRgb && building.nodeName) continue;
      const factor = building.roofColourRgb ? roofFactor(building.roofColourRgb) : [1, 1, 1, 1];
      building.roofColour = factor.map((v) => Math.round(v * 255));
    }
    console.log(
      `roof colours: ${Object.values(surfaces).reduce((a, b) => a + b, 0)} from the orthophoto (${Object.entries(surfaces).map(([k, n]) => `${k} ${n}`).join(", ")}), ` +
      `${applied.length} from OSM tags${applied.length ? ` (${applied.join("; ")})` : ""}, all as COLOR_0 on Roof_Membrane; no photo colour: ${photoLog.join("; ") || "none"}`,
    );
    console.log(`solar panels (estimated from the orthophoto): ${panelLog.join("; ") || "none"}`);
  }
  // ---- meshes and nodes
  // All primitives are built first so the AO charts can be packed before any TEXCOORD_1 is written.
  const charts = new AoCharts();
  const solids = [...selectableBuildings, ...campusBuildings].flatMap((building) => solidsOf(building, heightAt));
  const primitivesContext = { heightAt, facadeMaterial, tiles: facadeAtlas.tiles, looks: catalogue.looks, roofMaterial, parapetMaterial, equipmentMaterial, charts, solids };
  const primitivesOf = (building, seed) => (building.massForm ? massPrimitives(building, seed, primitivesContext) : buildingPrimitives(building, seed, primitivesContext));
  const selectablePrimitives = selectableBuildings.map((building, index) => primitivesOf(building, 1000 + index));
  const merged = new Map();
  campusBuildings.forEach((building, index) => {
    // A structure the furniture stage draws still allocates its AO charts, so the baked AO atlas layout stays valid.
    const primitives = primitivesOf(building, 5000 + index);
    if (building.drawnByFurniture) {
      console.log(`buildings: ${building.label ?? building.displayName} is drawn by stages/furniture.mjs; its generic mass is left out (label and pick proxy kept)`);
      return;
    }
    primitives.forEach((primitive) => {
      if (!merged.has(primitive.material)) merged.set(primitive.material, aoMesh(primitive.colors ? { colors: true } : undefined));
      const target = merged.get(primitive.material);
      target.append({ positions: primitive.positions, normals: primitive.normals, uvs: primitive.uvs, colors: primitive.colors, indices: primitive.indices });
      for (const value of primitive.ao) target.ao.push(value);
    });
  });
  const campusPrimitives = [...merged].map(([material, data]) => aoPrimitive(data, material));

  const aoLayout = charts.layout();
  const toAtlas = (primitive) => {
    const uv1 = new Float32Array((primitive.ao.length / 3) * 2);
    for (let k = 0, o = 0; k < primitive.ao.length; k += 3, o += 2) {
      const rect = aoLayout.rects[primitive.ao[k + 2]];
      uv1[o] = (rect.x + primitive.ao[k] / aoLayout.texel) / AO_SIZE;
      uv1[o + 1] = (rect.y + primitive.ao[k + 1] / aoLayout.texel) / AO_SIZE;
    }
    return uv1;
  };
  // GlbBuilder.addMesh writes TEXCOORD_0 only; TEXCOORD_1 is added to the primitives it kept.
  const addAoMesh = (name, primitives) => {
    const mesh = glb.addMesh(name, primitives);
    const kept = primitives.filter((primitive) => primitive.indices.length > 0);
    glb.json.meshes[mesh].primitives.forEach((target, k) => {
      target.attributes.TEXCOORD_1 = glb.addAccessor(toAtlas(kept[k]), "VEC2");
    });
    return mesh;
  };
  glb.json.asset.extras = { ...glb.json.asset.extras, aoLayout: aoLayout.hash, aoAtlasSize: AO_SIZE };
  console.log(
    `building AO atlas layout ${aoLayout.hash}: ${charts.charts.length} charts, ` +
    `${(aoLayout.texel / metres(1)).toFixed(3)} m/texel, ${(aoLayout.fill * 100).toFixed(1)} % of ${AO_SIZE}^2`,
  );
  if (existsSync(AO_ATLAS)) {
    const atlas = readFileSync(AO_ATLAS);
    const bakedFor = atlasLayoutHash(atlas);
    if (bakedFor === aoLayout.hash) {
      const texture = glb.addTexture(atlas, "image/png", { repeat: false });
      for (const material of [facadeMaterial, roofMaterial, parapetMaterial, equipmentMaterial]) {
        glb.json.materials[material].occlusionTexture = { index: texture, texCoord: 1 };
      }
      console.log(`building AO atlas: ${path.basename(AO_ATLAS)} (${atlas.length} B) attached as occlusionTexture`);
    } else {
      console.warn(
        `building AO atlas: ${path.basename(AO_ATLAS)} was baked for layout ${bakedFor ?? "(none)"}, this build is ${aoLayout.hash}; ` +
        "left out. Re-bake: bun scripts/campus-model/bake/bake-ao.mjs, then bun run model:build",
      );
    }
  } else {
    console.warn(`building AO atlas: ${path.basename(AO_ATLAS)} missing; see scripts/campus-model/bake/README.md`);
  }

  selectableBuildings.forEach((building, index) => {
    const mesh = addAoMesh(building.nodeName, selectablePrimitives[index]);
    glb.addNode({
      name: building.nodeName,
      mesh,
      extras: {
        displayName: building.displayName,
        source: building.footprintSource,
        floorsSource: building.floorsSource,
        heightSource: building.parts[0].heightSource ?? building.heightSource,
        facadeLook: building.look,
        facadeClass: catalogue.looks.get(building.look).class,
        facadeSource: `${catalogue.looks.get(building.look).sources} (colours and window layout estimated)`,
        ...(building.parts.some((p) => p.tower) ? {
          towerFloors: building.parts.find((p) => p.tower).tower.floors,
          towerHeightMetres: building.parts.find((p) => p.tower).tower.heightMetres,
          towerSource: `${building.parts.find((p) => p.tower).tower.floorsSource}; outline from the VWorld LOD4 roof level (estimated)`,
        } : {}),
        ...(building.roofColourSource ? { roofColourSource: building.roofColourSource } : {}),
        ...(building.roofColourRgb ? { roofColour: `#${building.roofColourRgb.map((c) => c.toString(16).padStart(2, "0")).join("")}` } : {}),
        ...(building.roofSurface ? { roofSurface: building.roofSurface } : {}),
        ...(building.solarPanelModules ? { solarPanelModules: building.solarPanelModules, solarPanelSource: "estimated from the VWorld z19 orthophoto" } : {}),
        ...formExtras(building),
      },
    }, { root: true });
  });

  {
    const mesh = addAoMesh("CampusBuildings", campusPrimitives);
    glb.addNode({ name: "CampusBuildings", mesh, extras: { buildings: campusBuildings.map((b) => b.displayName).filter(Boolean) } }, { root: true });
  }

  // Named SCNU campus buildings stay merged in CampusBuildings for drawing (no extra draw calls) and get one
  // selectable pick proxy each: a BLD_SCNU_* node with a plain prism of the footprint up to the parapet top in
  // the Pick_Proxy material. The dashboard keeps proxies invisible (raycasts still hit them) and shows one only
  // as the selection/hover highlight; its label and panel title come from extras.label.
  const proxyMaterial = glb.addMaterial({
    name: "Pick_Proxy",
    pbrMetallicRoughness: { baseColorFactor: [1, 0.72, 0.78, 0.45], metallicFactor: 0, roughnessFactor: 1 },
    alphaMode: "BLEND",
  });
  const reservedIds = new Set(bldNodes.map(({ rawName }) => rawName));
  const proxies = Map.groupBy(campusBuildings.filter((b) => b.nodeId && b.label), (b) => b.nodeId);
  for (const [nodeId, group] of proxies) {
    if (reservedIds.has(nodeId)) throw new Error(`pick proxy ${nodeId} collides with an existing BLD_* node`);
    reservedIds.add(nodeId);
    const prism = new MeshData({ uvs: false });
    for (const building of group) {
      if (building.massForm) {
        // One prism per mass, from its base (or below the ground line) to its parapet or ridge.
        const ground = formGround(building, heightAt);
        for (const part of building.parts) {
          const top = ground + metres(part.heightMetres + (part.triangles ? 0 : part.parapetMetres ?? 0.9));
          addWalls(prism, part.outer, true, part.baseMetres > 0 ? ground + metres(part.baseMetres) : ground - metres(1.5), top, null);
          prism.horizontalPolygon(part.outer, part.holes, top);
        }
        continue;
      }
      for (const part of building.parts) {
        const ground = Math.min(...[...part.outer, ringCentroid(part.outer)].map(([x, z]) => heightAt(x, z)));
        for (const mass of partMasses(part)) {
          const top = ground + metres(mass.heightMetres) + PARAPET;
          addWalls(prism, mass.outer, true, mass.fromMetres ? ground + metres(mass.fromMetres) : ground - metres(1.5), top, null);
          prism.horizontalPolygon(mass.outer, mass.holes, top);
        }
      }
    }
    const [first] = group;
    glb.addNode({
      name: nodeId,
      mesh: glb.addMesh(nodeId, [prism.toPrimitive(proxyMaterial)]),
      extras: {
        pickProxy: true,
        label: first.label,
        displayName: first.displayName,
        nameSource: first.nameSource,
        source: first.footprintSource,
        floorsSource: first.floorsSource,
        heightSource: first.parts[0].heightSource,
        ...formExtras(first),
      },
    }, { root: true });
  }
  console.log(`SCNU pick proxies: ${proxies.size} (${[...proxies].map(([id, [b]]) => `${id} ${b.label}`).join("; ")})`);

  return { selectableBuildings, campusBuildings, offCampusLots };
}

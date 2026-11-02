// Context ground stage: the streets around the campus, beyond EXTENT out to the context buildings (stages/context.mjs),
// drawn on the OuterTerrain ring so the views no longer end in flat green where the town has roads.
//   - source: the OSM arterial and connector centrelines already in data/osm-ground.json (`osm.lines`, the ways
//     network/surfaces.mjs traces inside EXTENT). OSM carries no lane counts or widths here; no other road data is read.
//   - centreline: each way resampled and fitted as straight runs joined by tangent arcs (lib/markingFit.mjs fitPath,
//     as the campus markings are), so edges and lines are straight where the road is.
//   - lane count: only where the same road (OSM name and class) carries paint inside EXTENT: the gate-accepted road
//     markings (stages/markings.mjs pieces) are read in 10 m sections across the fitted centreline; a section with one
//     yellow centre line and white lane lines on both sides counts (whites left + 1) + (whites right + 1), and the road
//     takes the smallest such count (mid-block; junction approaches add turn lanes). Yellow alone in two or more
//     sections means one lane each way. No paint, no lane count.
//   - carriageway: lanes x LANE_M (clamped to the asphalt traced inside EXTENT by network/surfaces.mjs, which is bounded
//     by the surveyed A003 sidewalks) where the lane count is known, else a half-width per highway class (ROAD_CLASS,
//     추정). Narrowed where a building footprint is closer.
//   - sidewalks: raised SIDEWALK_RAISE_M on primary/secondary/tertiary ways only (class width, 추정), cut where a building
//     stands or another road's carriageway runs (junction mouths); plain concrete kerb faces on both edges.
//   - markings: only on roads with a measured lane count: the yellow centre line (double, DOUBLE_OFFSET_M either side,
//     at 4 lanes or more) and white dashed lane lines with the statute 3 m / 5 m pattern (stages/markings.mjs
//     DASH_BY_KIND, LINE_WIDTH_M_BY_KIND), left out within JUNCTION_M of another road.
//   - materials: the CC0 asphalt and concrete ground tiles and the campus-speckle paver pattern textures already in the
//     model (no new images, no photo pixels), and the shared Road_Marking palette.
//   - nodes: one per TILE_M tile, Ground_Context_<i>_<j> (near) or Context_Far_Ground_<i>_<j> (tile centre beyond
//     CONTEXT_REACH): CityModel casts no shadow from Ground_* materials, and receives none on Context_Far_* nodes. Not part
//     of the road network, routing or walkable sets; the campus ground inside EXTENT is not touched.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ShapeUtils, Vector2 } from "three";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { EXTENT, SCENE_UNITS_PER_METRE, geoToModel, metres } from "../lib/frame.mjs";
import { fitPath, offsetPath, polylineLength, resample, slicePath } from "../lib/markingFit.mjs";
import { CONTEXT_REACH, TILE_M } from "./context.mjs";
import { DASH_BY_KIND, LINE_WIDTH_M_BY_KIND, PAINT_BEYOND_EXTENT, PALETTE_U, inMarkingExtent } from "./markings.mjs";
import { strokePath } from "./markingsRegular.mjs";
import { pavingPattern } from "../lib/pavingPatterns.mjs";
import { groundTile, planarTileUv, tileMaterial } from "./surfaces.mjs";

const U = SCENE_UNITS_PER_METRE;
const GROUND_FEATURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "osm-ground.json");
// Carriageway half-width and sidewalk width (m) per OSM highway class: estimates (추정), no source gives them here.
export const ROAD_CLASS = Object.freeze({
  primary: { half: 6.5, sidewalk: 3 },
  primary_link: { half: 3.5, sidewalk: 0 },
  secondary: { half: 5, sidewalk: 2.5 },
  secondary_link: { half: 3.5, sidewalk: 0 },
  tertiary: { half: 3.5, sidewalk: 2 },
  residential: { half: 3, sidewalk: 0 },
  service: { half: 2.5, sidewalk: 0 },
});
export const LANE_M = 3.25;
const STEP_M = 2;
const CELL_M = 0.5;
const MIN_HALF_M = 2.5;
const BUILDING_GAP_M = 0.3;
const MIN_SIDEWALK_M = 1;
export const SIDEWALK_RAISE_M = 0.15;
// The streets lie flush on the hill ring, cut out of it (lib/partition.mjs TinPartition): no lift, no stacking.
const ROAD_LIFT_M = 0;
const MARK_LIFT_M = 0;
const SIDEWALK_LIFT_M = ROAD_LIFT_M + SIDEWALK_RAISE_M;
const BACK_DROP_M = 0.1;
const JUNCTION_M = 4;
const DOUBLE_OFFSET_M = 0.15;
// network/surfaces.mjs ARTERIAL_FALLBACK_HALF_M: a traced half this wide hit nothing (not a measurement).
const TRACE_FALLBACK_HALF_M = 8;
const MIN_MEASURED = 20;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const perp = (d) => [-d[1], d[0]]; // lib/markingFit.mjs offsetPath: positive offsets lie along perp(tangent)
const med = (values) => {
  const v = values.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : null;
};
const median5 = (values) => values.map((_, i) => med(values.slice(Math.max(0, i - 2), i + 3)));

function distanceToPolyline(p, line) {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const ab = sub(line[i + 1], line[i]);
    const l2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - line[i][0]) * ab[0] + (p[1] - line[i][1]) * ab[1]) / l2)) : 0;
    best = Math.min(best, len(sub(p, add(line[i], mul(ab, t)))));
  }
  return best;
}

// Asphalt width (m) of each OSM way traced inside EXTENT (network/surfaces.mjs: OSM-derived ASPHALT quads
// [left a, left b, right b, right a] in EPSG:5186), from the median left and right halves that hit a sidewalk, building
// or lot; null when fewer than MIN_MEASURED samples per side did.
export function measuredWidths(layers, lines) {
  const quads = new Map();
  for (const l of layers) {
    // a quad whose two corners collapsed in cleanRing (a zero-length side) has no left/right corner pair to measure
    if (l.cls !== "ASPHALT" || l.source !== "OSM-derived" || l.rings[0].length !== 4) continue;
    if (!quads.has(l.source_ref)) quads.set(l.source_ref, []);
    quads.get(l.source_ref).push(l.rings[0].map(([E, N]) => mul(tmToScene(E, N), 1 / U)));
  }
  const out = new Map();
  for (const line of lines) {
    const q = quads.get(line.id);
    if (!q) continue;
    const centre = line.line.map(([lon, lat]) => mul(geoToModel(lon, lat), 1 / U));
    const measured = (d) => (Math.abs(d - TRACE_FALLBACK_HALF_M) > 0.05 && d > 1 ? d : null);
    const left = q.map((r) => measured(distanceToPolyline(r[0], centre))).filter((d) => d !== null);
    const right = q.map((r) => measured(distanceToPolyline(r[3], centre))).filter((d) => d !== null);
    if (left.length < MIN_MEASURED || right.length < MIN_MEASURED) continue;
    const width = med(left) + med(right);
    out.set(line.id, { widthM: Number(width.toFixed(2)), samples: Math.min(left.length, right.length) });
  }
  return out;
}

// Lane count of a fitted centreline (metres) from painted lines: paint = [{ kind, p: [x, z] metres }] (piece centroids).
const PAINT_SECTION_M = 10;
const PAINT_ALONG_M = 6;
const PAINT_ACROSS_M = 12;
const PAINT_CLUSTER_M = 1;
const PAINT_SIDE_M = [0.8, 10];
export function paintedLanes(fit, paint) {
  const total = polylineLength(fit);
  const counts = [];
  let yellowOnly = 0;
  for (let s = PAINT_SECTION_M / 2; s < total; s += PAINT_SECTION_M) {
    const piece = slicePath(fit, Math.max(0, s - 0.5), Math.min(total, s + 0.5));
    const u = unit(sub(piece.at(-1), piece[0]));
    const n = perp(u);
    const near = paint.map((m) => ({ kind: m.kind, d: sub(m.p, piece[0]) }))
      .filter(({ d }) => Math.abs(d[0] * u[0] + d[1] * u[1]) < PAINT_ALONG_M && Math.abs(d[0] * n[0] + d[1] * n[1]) < PAINT_ACROSS_M)
      .map(({ kind, d }) => ({ yellow: kind === "centre_line_yellow", o: d[0] * n[0] + d[1] * n[1] }))
      .sort((a, b) => a.o - b.o);
    const clusters = [];
    for (const m of near) {
      const last = clusters.at(-1);
      if (last && last.yellow === m.yellow && m.o - last.hi <= PAINT_CLUSTER_M) last.hi = m.o;
      else clusters.push({ yellow: m.yellow, lo: m.o, hi: m.o });
    }
    for (const c of clusters) c.o = (c.lo + c.hi) / 2;
    const yellows = clusters.filter((c) => c.yellow);
    if (yellows.length !== 1) continue;
    const c = yellows[0].o;
    const whites = clusters.filter((w) => !w.yellow && Math.abs(w.o - c) > PAINT_SIDE_M[0] && Math.abs(w.o - c) < PAINT_SIDE_M[1]);
    const left = whites.filter((w) => w.o > c).length;
    const right = whites.filter((w) => w.o < c).length;
    if (left && right) counts.push(left + 1 + right + 1);
    else if (!left && !right) yellowOnly += 1;
  }
  if (counts.length) return { lanes: Math.min(...counts), sections: counts.length };
  return yellowOnly >= 2 ? { lanes: 2, sections: yellowOnly } : null;
}

// Occupancy grid (CELL_M) over a metre-frame box.
class Grid {
  constructor(box) {
    this.x0 = box[0];
    this.z0 = box[1];
    this.w = Math.ceil((box[2] - box[0]) / CELL_M) + 1;
    this.h = Math.ceil((box[3] - box[1]) / CELL_M) + 1;
    this.cells = new Int32Array(this.w * this.h);
  }

  index([x, z]) {
    const i = Math.floor((x - this.x0) / CELL_M);
    const j = Math.floor((z - this.z0) / CELL_M);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }

  at(p) {
    const k = this.index(p);
    return k < 0 ? 0 : this.cells[k];
  }

  // Even-odd fill of rings (metres); value(old) -> new value of each covered cell.
  fill(rings, value) {
    const pts = rings.flat();
    const j0 = Math.max(0, Math.floor((Math.min(...pts.map((p) => p[1])) - this.z0) / CELL_M));
    const j1 = Math.min(this.h - 1, Math.floor((Math.max(...pts.map((p) => p[1])) - this.z0) / CELL_M));
    for (let j = j0; j <= j1; j += 1) {
      const z = this.z0 + (j + 0.5) * CELL_M;
      const xs = [];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i += 1) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          if ((a[1] <= z) !== (b[1] <= z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - this.x0) / CELL_M - 0.5));
        const i1 = Math.min(this.w - 1, Math.floor((xs[k + 1] - this.x0) / CELL_M - 0.5));
        for (let i = i0; i <= i1; i += 1) this.cells[j * this.w + i] = value(this.cells[j * this.w + i]);
      }
    }
  }
}

// Triangle soup per tile and surface, vertices in scene units; faces wound to face `normal` (or up).
class Soup {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.indices = [];
  }

  tri(a, b, c, normal = [0, 1, 0]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (Math.hypot(...n) < 1e-12) return;
    const flip = n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0;
    for (const v of flip ? [a, c, b] : [a, b, c]) {
      this.indices.push(this.positions.length / 3);
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(...normal);
      this.uvs.push(v[3], v[4]);
    }
  }

  quad(a, b, c, d, normal) {
    this.tri(a, b, c, normal);
    this.tri(a, c, d, normal);
  }

  get triangles() {
    return this.indices.length / 3;
  }

  primitive(material) {
    return { positions: Float32Array.from(this.positions), normals: Float32Array.from(this.normals), uvs: Float32Array.from(this.uvs), indices: this.indices, material };
  }
}

// The campus Ground_Pavers textures (campus-speckle pattern, stages/surfaces.mjs) on a material of its own: no AO map,
// whose second UV set these strips do not have.
const SIDEWALK_PATTERN = "campus-speckle";
function sidewalkMaterial(glb) {
  const pavers = glb.json.materials.find((m) => m.name === "Ground_Pavers" && m.extras?.paving === SIDEWALK_PATTERN);
  if (!pavers) throw new Error("context ground: run after stages/surfaces.mjs (no campus-speckle Ground_Pavers material)");
  return glb.addMaterial({
    name: "Ground_Context_Sidewalk",
    pbrMetallicRoughness: { baseColorTexture: { index: pavers.pbrMetallicRoughness.baseColorTexture.index }, metallicFactor: 0, roughnessFactor: 0.82 },
    normalTexture: { index: pavers.normalTexture.index },
    extras: { estimated: true, polygonOffsetRank: 5, context: true, paving: SIDEWALK_PATTERN, note: "estimated sidewalk; campus paver pattern, no photo pixels" },
  });
}

// lines: osm-ground.json osm.lines (read here by default); layers: network/surfaces.mjs class polygons (for the measured widths);
// footprints: building outer rings (scene units); heightAt(x, z): OuterTerrain height or null (scene units).
const PAINT_KINDS = new Set(["centre_line_yellow", "lane_line_dashed", "lane_line_solid"]);

// paint: stages/markings.mjs pieces ({ kind, rings } in scene units).
export async function buildContextGround({ glb, tin, lines = JSON.parse(readFileSync(GROUND_FEATURES, "utf8")).osm.lines, layers, paint, footprints, heightAt }) {
  const roads = lines.filter((l) => l.kind === "arterial" || l.kind === "connector").filter((l) => ROAD_CLASS[l.tags.highway]);
  const traced = measuredWidths(layers, roads);
  // outline points every metre (a solid line is one long piece, so its centroid alone would miss most sections)
  const paintM = paint.filter((piece) => PAINT_KINDS.has(piece.kind))
    .flatMap((piece) => resample([...piece.rings[0], piece.rings[0][0]].map((q) => mul(q, 1 / U)), 1).map((p) => ({ kind: piece.kind, p })));
  const fitted = (road) => fitPath(resample(road.line.map(([lon, lat]) => mul(geoToModel(lon, lat), 1 / U)), STEP_M), { tol: 0.5, maxTol: 1.5, minRun: 6 }).path;
  // lane counts from the paint inside EXTENT, shared by every way of the same road (name and class)
  const measured = new Map();
  const byName = new Map();
  for (const road of roads) {
    if (polylineLength(road.line.map(([lon, lat]) => geoToModel(lon, lat))) / U < 4) continue;
    const lanes = paintedLanes(fitted(road), paintM);
    if (!lanes) continue;
    const width = Math.min(Math.max(traced.get(road.id)?.widthM ?? 0, lanes.lanes * 3), lanes.lanes * LANE_M + 1);
    const m = { ...lanes, widthM: Number(width.toFixed(2)), road: road.tags.name ?? road.id };
    measured.set(road.id, m);
    if (road.tags.name) {
      const key = `${road.tags.name}|${road.tags.highway}`;
      if (!byName.has(key) || byName.get(key).sections < m.sections) byName.set(key, m);
    }
  }
  const extentM = [EXTENT.minX / U, EXTENT.minZ / U, EXTENT.maxX / U, EXTENT.maxZ / U];
  const inExtent = ([x, z]) => x >= extentM[0] && x <= extentM[2] && z >= extentM[1] && z <= extentM[3];
  const ringsM = footprints.map((ring) => ring.map((p) => mul(p, 1 / U)));
  const reach = ringsM.flat().reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [Infinity, Infinity, -Infinity, -Infinity]);
  const inReach = ([x, z]) => x >= reach[0] - 20 && x <= reach[2] + 20 && z >= reach[1] - 20 && z <= reach[3] + 20;
  const hM = ([x, z]) => {
    const y = heightAt(x * U, z * U);
    return y === null ? null : y / U;
  };

  // 1. fitted centrelines and samples outside EXTENT
  const ways = [];
  for (const road of roads) {
    if (polylineLength(road.line.map(([lon, lat]) => geoToModel(lon, lat))) / U < 4) continue;
    const fit = fitted(road);
    const total = polylineLength(fit);
    const cls = ROAD_CLASS[road.tags.highway];
    const m = measured.get(road.id) ?? (road.tags.name ? byName.get(`${road.tags.name}|${road.tags.highway}`) : undefined) ?? null;
    const half = m ? m.widthM / 2 : cls.half;
    const samples = [];
    for (let s = 0; s <= total + 1e-9; s += STEP_M) {
      const p = slicePath(fit, Math.max(0, s - 0.5), Math.min(total, s + 0.5));
      const t = unit(sub(p.at(-1), p[0]));
      const at = slicePath(fit, 0, Math.min(total, s)).at(-1) ?? fit[0];
      samples.push({ s, p: at, n: perp(t), ok: !inExtent(at) && inReach(at) && hM(at) !== null });
    }
    ways.push({ id: road.id, key: road.tags.name ? `${road.tags.name}` : road.id, highway: road.tags.highway, fit, total, half, sidewalk: cls.sidewalk, lanes: m?.lanes ?? null, measured: m, samples });
  }
  const live = ways.flatMap((w) => w.samples.filter((s) => s.ok).map((s) => s.p));
  if (!live.length) return { roads: 0 };
  const box = live.reduce((b, [x, z]) => [Math.min(b[0], x - 40), Math.min(b[1], z - 40), Math.max(b[2], x + 40), Math.max(b[3], z + 40)], [Infinity, Infinity, -Infinity, -Infinity]);

  // 2. building occupancy and per-sample halves
  const buildings = new Grid(box);
  for (const ring of ringsM) {
    if (ring.some(([x, z]) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3])) buildings.fill([ring], () => 1);
  }
  const march = (p, dir, max) => {
    for (let d = 0; d <= max; d += CELL_M / 2) if (buildings.at(add(p, mul(dir, d)))) return d;
    return Infinity;
  };
  for (const w of ways) {
    for (const s of w.samples) {
      if (!s.ok) continue;
      const sides = [1, -1].map((sign) => {
        const d = march(s.p, mul(s.n, sign), w.half + w.sidewalk + 0.5);
        const half = Math.min(w.half, d - BUILDING_GAP_M);
        const walk = w.sidewalk ? Math.max(0, Math.min(w.sidewalk, d - half - BUILDING_GAP_M)) : 0;
        return { half, walk: walk >= MIN_SIDEWALK_M ? walk : 0 };
      });
      if (sides.some((x) => x.half < MIN_HALF_M)) s.ok = false;
      else [s.L, s.R, s.SL, s.SR] = [sides[0].half, sides[1].half, sides[0].walk, sides[1].walk];
    }
    for (const k of ["L", "R", "SL", "SR"]) {
      const smooth = median5(w.samples.map((s) => (s.ok ? s[k] : null)));
      w.samples.forEach((s, i) => { if (s.ok) s[k] = smooth[i]; });
    }
  }

  // 3. carriageway owner grid (road index + 1; -1 where two roads overlap): junctions
  const owner = new Grid(box);
  ways.forEach((w) => {
    const own = ways.findIndex((x) => x.key === w.key) + 1;
    for (let i = 0; i + 1 < w.samples.length; i += 1) {
      const [a, b] = [w.samples[i], w.samples[i + 1]];
      if (!a.ok || !b.ok) continue;
      owner.fill([[add(a.p, mul(a.n, a.L)), add(b.p, mul(b.n, b.L)), add(b.p, mul(b.n, -b.R)), add(a.p, mul(a.n, -a.R))]],
        (old) => (old === 0 || old === own ? own : -1));
    }
    w.own = own;
  });
  const otherRoad = (w, p) => {
    const o = owner.at(p);
    return o !== 0 && o !== w.own;
  };

  // 4. geometry per tile
  const tile = metres(TILE_M);
  const [mx, mz] = [(EXTENT.minX + EXTENT.maxX) / 2, (EXTENT.minZ + EXTENT.maxZ) / 2];
  const tiles = new Map();
  const soupOf = (pM, surface) => {
    const [x, z] = mul(pM, U);
    const ti = Math.floor((x - EXTENT.minX) / tile);
    const tj = Math.floor((z - EXTENT.minZ) / tile);
    const key = `${ti < 0 ? `m${-ti}` : ti}_${tj < 0 ? `m${-tj}` : tj}`;
    if (!tiles.has(key)) {
      const far = Math.hypot(EXTENT.minX + (ti + 0.5) * tile - mx, EXTENT.minZ + (tj + 0.5) * tile - mz) > CONTEXT_REACH;
      tiles.set(key, { far, asphalt: new Soup(), pavers: new Soup(), kerb: new Soup(), marking: new Soup() });
    }
    return tiles.get(key)[surface];
  };
  const sizes = { asphalt: groundTile("asphalt").entry.physicalSizeM, pavers: pavingPattern(SIDEWALK_PATTERN).repeatM, concrete: groundTile("concrete").entry.physicalSizeM };
  // vertex: metre point + lift -> [x, y, z, u, v] in scene units
  const vtx = (pM, liftM, size) => {
    const [x, z] = mul(pM, U);
    const [u, v] = size ? planarTileUv(x, z, size) : [0, 0];
    return [x, (hM(pM) + liftM) * U, z, u, v];
  };
  const wall = (soup, a, b, topA, topB, botA, botB, normal, sAlong) => {
    // vertical face between a and b (metres), from bot to top lift (m); uv: along / height in concrete tiles
    const size = sizes.concrete;
    const v = (p, lift, along) => { const q = vtx(p, lift, null); q[3] = along / size; q[4] = lift / size; return q; };
    soup.quad(v(a, botA, sAlong), v(b, botB, sAlong + len(sub(b, a))), v(b, topB, sAlong + len(sub(b, a))), v(a, topA, sAlong), [normal[0], 0, normal[1]]);
  };
  // ground pieces (convex, metres) claimed after every street is laid out: paint first, then sidewalk tops, then the
  // carriageways (lib/partition.mjs TinPartition), so no two of them, and none of them with the OuterTerrain, share area
  const pending = { marking: [], pavers: [], asphalt: [] };
  const defer = (surface, ringM, liftM, colour = null) => {
    const tris = ringM.length === 3 ? [ringM] : [[ringM[0], ringM[1], ringM[2]], [ringM[0], ringM[2], ringM[3]]];
    for (const tri of tris) pending[surface].push({ tri, liftM, colour, at: tri[0] });
  };
  let carriagewayM2 = 0;
  let sidewalkM2 = 0;
  const marked = [];
  for (const w of ways) {
    for (let i = 0; i + 1 < w.samples.length; i += 1) {
      const [a, b] = [w.samples[i], w.samples[i + 1]];
      if (!a.ok || !b.ok) continue;
      const corner = (s, side, d) => add(s.p, mul(s.n, side * d));
      const [aL, bL, bR, aR] = [corner(a, 1, a.L), corner(b, 1, b.L), corner(b, -1, b.R), corner(a, -1, a.R)];
      // draped across the width too (about every STEP_M), so the terrain between the edges cannot show through
      const across = Math.max(1, Math.ceil(Math.max(a.L + a.R, b.L + b.R) / STEP_M));
      const at = (p, q, k) => add(p, mul(sub(q, p), k / across));
      for (let k = 0; k < across; k += 1) defer("asphalt", [at(aL, aR, k), at(bL, bR, k), at(bL, bR, k + 1), at(aL, aR, k + 1)], ROAD_LIFT_M);
      carriagewayM2 += STEP_M * (a.L + a.R);
      for (const side of [1, -1]) {
        const [wa, wb] = side > 0 ? [a.SL, b.SL] : [a.SR, b.SR];
        const [ha, hb] = side > 0 ? [a.L, b.L] : [a.R, b.R];
        if (!wa || !wb) continue;
        const [ia, ib, oa, ob] = [corner(a, side, ha), corner(b, side, hb), corner(a, side, ha + wa), corner(b, side, hb + wb)];
        const mid = mul(add(add(ia, ib), add(oa, ob)), 0.25);
        if (otherRoad(w, mid) || owner.at(mid) === w.own) continue; // a junction mouth or this road's own carriageway
        defer("pavers", [ia, ib, ob, oa], SIDEWALK_LIFT_M);
        sidewalkM2 += STEP_M * (wa + wb) / 2;
        const kerb = soupOf(a.p, "kerb");
        const inward = mul(a.n, -side);
        wall(kerb, ia, ib, SIDEWALK_LIFT_M, SIDEWALK_LIFT_M, ROAD_LIFT_M - 0.02, ROAD_LIFT_M - 0.02, inward, a.s);
        wall(kerb, oa, ob, SIDEWALK_LIFT_M, SIDEWALK_LIFT_M, -BACK_DROP_M, -BACK_DROP_M, mul(inward, -1), a.s);
      }
    }
    // markings on roads with a measured lane count: runs of consecutive live samples away from other roads
    if (!w.lanes) continue;
    // no statute lines where the photo's own paint is drawn (PAINT_BEYOND_EXTENT, below)
    const photoPainted = (pM) => { const [x, z] = mul(pM, U); return x >= PAINT_BEYOND_EXTENT.minX && x <= PAINT_BEYOND_EXTENT.maxX && z >= PAINT_BEYOND_EXTENT.minZ && z <= PAINT_BEYOND_EXTENT.maxZ; };
    const clear = w.samples.map((s) => s.ok && !photoPainted(s.p) && ![0, 1, -1].some((side) => otherRoad(w, add(s.p, mul(s.n, 0.9 * side * (side > 0 ? s.L : s.R))))));
    const keep = clear.map((_, i) => clear.slice(Math.max(0, i - Math.ceil(JUNCTION_M / STEP_M)), i + Math.ceil(JUNCTION_M / STEP_M) + 1).every(Boolean));
    const lineSpecs = [];
    const centre = LINE_WIDTH_M_BY_KIND.centre_line_yellow / 2;
    if (w.lanes >= 4) lineSpecs.push({ offset: DOUBLE_OFFSET_M, half: centre, colour: "yellow" }, { offset: -DOUBLE_OFFSET_M, half: centre, colour: "yellow" });
    else lineSpecs.push({ offset: 0, half: centre, colour: "yellow" });
    const laneW = (2 * w.half) / w.lanes;
    for (let k = 1; k < w.lanes / 2; k += 1) {
      for (const side of [1, -1]) lineSpecs.push({ offset: side * k * laneW, half: LINE_WIDTH_M_BY_KIND.lane_line_dashed / 2, colour: "white", dash: DASH_BY_KIND.lane_line_dashed });
    }
    for (let i = 0; i < keep.length; ) {
      if (!keep[i]) { i += 1; continue; }
      let j = i;
      while (j + 1 < keep.length && keep[j + 1]) j += 1;
      const [s0, s1] = [w.samples[i].s, w.samples[j].s];
      if (s1 - s0 >= 6) {
        marked.push(s1 - s0);
        for (const spec of lineSpecs) {
          const period = spec.dash ? spec.dash[0] + spec.dash[1] : null;
          const pieces = [];
          if (!period) pieces.push([s0, s1]);
          else for (let k = Math.ceil(s0 / period); k * period + spec.dash[0] <= s1; k += 1) pieces.push([k * period, k * period + spec.dash[0]]);
          for (const [p0, p1] of pieces) {
            const path = offsetPath(resample(slicePath(w.fit, p0, p1), STEP_M), spec.offset);
            const ring = strokePath(path, spec.half);
            if (!ring) continue;
            const contour = ring.map(([x, z]) => new Vector2(x, z));
            for (const [ia, ib, ic] of ShapeUtils.triangulateShape(contour, [])) defer("marking", [ring[ia], ring[ib], ring[ic]], MARK_LIFT_M, spec.colour);
          }
        }
      }
      i = j + 1;
    }
  }

  // photo paint beyond EXTENT (stages/markings.mjs PAINT_BEYOND_EXTENT: traced on the NGII sheet, gate-checked), on this
  // ground at the marking lift, faces up
  let photoPieces = 0;
  for (const piece of paint) {
    const ringsM = piece.rings.map((ring) => ring.map((q) => mul(q, 1 / U)));
    const c = ringsM[0].reduce((a, q) => [a[0] + q[0] / ringsM[0].length, a[1] + q[1] / ringsM[0].length], [0, 0]);
    if (inMarkingExtent(mul(c, U)) || PALETTE_U[piece.colour] === undefined) continue;
    const all = ringsM.flat();
    for (const [ia, ib, ic] of ShapeUtils.triangulateShape(ringsM[0].map(([x, z]) => new Vector2(x, z)), ringsM.slice(1).map((h) => h.map(([x, z]) => new Vector2(x, z))))) {
      defer("marking", [all[ia], all[ib], all[ic]], MARK_LIFT_M, piece.colour);
    }
    photoPieces += 1;
  }

  // 4b. claim the ground pieces on the hill ring and lay the parts left, faces up
  let claimedOff = 0;
  for (const surface of ["marking", "pavers", "asphalt"]) {
    for (const { tri, liftM, colour, at } of pending[surface]) {
      const soup = soupOf(at, surface);
      const parts = tin.claimOnTin(tri.map((p) => mul(p, U)));
      if (!parts.length) claimedOff += 1;
      for (const { poly, triangle } of parts) {
        // height on the plane of the hill-ring triangle the part lies in (exact, no search)
        const [ia, ib, ic] = [tin.indices[triangle], tin.indices[triangle + 1], tin.indices[triangle + 2]];
        const P = (k) => [tin.positions[k * 3], tin.positions[k * 3 + 1], tin.positions[k * 3 + 2]];
        const [A, B, Cc] = [P(ia), P(ib), P(ic)];
        const det = (B[2] - Cc[2]) * (A[0] - Cc[0]) + (Cc[0] - B[0]) * (A[2] - Cc[2]);
        const planeY = ([x, z]) => {
          const l1 = ((B[2] - Cc[2]) * (x - Cc[0]) + (Cc[0] - B[0]) * (z - Cc[2])) / det;
          const l2 = ((Cc[2] - A[2]) * (x - Cc[0]) + (A[0] - Cc[0]) * (z - Cc[2])) / det;
          return l1 * A[1] + l2 * B[1] + (1 - l1 - l2) * Cc[1];
        };
        const v = (pScene) => {
          const q = vtx(mul(pScene, 1 / U), liftM, surface === "marking" ? null : sizes[surface]);
          q[0] = pScene[0];
          q[1] = planeY(pScene) + liftM * U;
          q[2] = pScene[1];
          if (surface === "marking") { q[3] = PALETTE_U[colour]; q[4] = 0.5; }
          return q;
        };
        for (let k = 1; k + 1 < poly.length; k += 1) soup.tri(v(poly[0]), v(poly[k]), v(poly[k + 1]));
      }
    }
  }
  console.log(`context ground: ${pending.marking.length + pending.pavers.length + pending.asphalt.length} ground triangles claimed on the OuterTerrain (${claimedOff} off the ring: inside EXTENT or beyond it, not drawn)`);

  // 5. materials and nodes
  const material = {
    asphalt: await tileMaterial(glb, { name: "Ground_Context_Asphalt", cls: "asphalt", rank: 3, extras: { context: true } }),
    pavers: sidewalkMaterial(glb),
    kerb: await tileMaterial(glb, { name: "Ground_Context_Kerb", cls: "concrete", rank: 5, extras: { context: true } }),
    marking: glb.json.materials.findIndex((m) => m.name === "Road_Marking"),
  };
  if (material.marking < 0) throw new Error("context ground: run after stages/markings.mjs buildMarkings (no Road_Marking material)");
  let triangles = 0;
  let far = 0;
  for (const [key, t] of [...tiles].sort(([a], [b]) => a.localeCompare(b))) {
    const primitives = ["asphalt", "pavers", "kerb", "marking"].filter((k) => t[k].triangles).map((k) => t[k].primitive(material[k]));
    if (!primitives.length) continue;
    triangles += primitives.reduce((sum, p) => sum + p.indices.length / 3, 0);
    far += t.far ? 1 : 0;
    const name = t.far ? `Context_Far_Ground_${key}` : `Ground_Context_${key}`;
    glb.addNode({ name, mesh: glb.addMesh(name, primitives), extras: { context: true, selectable: false, walkable: false,
      note: "OSM centrelines fitted as straight runs and arcs; widths per highway class or measured inside EXTENT, sidewalks and lane lines estimated (추정)" } }, { root: true });
  }
  const stats = {
    ways: ways.filter((w) => w.samples.some((s) => s.ok)).length, tiles: tiles.size, far, triangles,
    carriagewayM2: Math.round(carriagewayM2), sidewalkM2: Math.round(sidewalkM2), markedM: Math.round(marked.reduce((a, b) => a + b, 0)),
    measured: [...measured].map(([id, m]) => `${m.road} ${id} ${m.lanes} lanes (${m.sections} sections) ${m.widthM} m`),
  };
  console.log(`context ground: ${stats.ways} OSM ways outside EXTENT in ${stats.tiles} tiles (${far} Context_Far_Ground_*), ${triangles} triangles; ` +
    `carriageway ${stats.carriagewayM2} m2, sidewalk ${stats.sidewalkM2} m2, lane markings along ${stats.markedM} m; photo paint beyond EXTENT ${photoPieces} pieces; lane counts from the paint inside EXTENT: ${stats.measured.join(", ") || "none"} (widths 추정)`);
  return stats;
}

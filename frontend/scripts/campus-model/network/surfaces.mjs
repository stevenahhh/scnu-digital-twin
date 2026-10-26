#!/usr/bin/env bun
// Surface polygon builder (plan uhf-ground-roads-routing todo 8): every ground surface the model draws as a vector
// polygon in EPSG:5186, with a precedence (higher wins where polygons overlap: stages/surfaces.mjs draws them in this
// order with increasing lift, no polygon booleans) and its provenance.
//
//   precedence  class     mesh             source
//   0           NATURAL   (Topography)     the whole EXTENT, lawn/soil from landcoverAt (implicit, not a layer)
//   1           SPORTS    Ground_Sports    data/osm-ground.json pitches, MCEE facility outlines with project surface labels,
//                                          the running track, water (painted / coloured surfaces)
//   2           PAVING    Ground_Pavers    OSM plazas; rims of water, lawn facilities and the fountain (Ground_Apron)
//   3           ASPHALT   Ground_Asphalt   road zones (docs/assets/data/road_zones_wgs84.geojson) and the arterial and
//                                          connector strips traced from the OSM centrelines out to the surveyed edges
//   4           LOT       Ground_Lot       OSM parking, the estimated bays of data/osm-ground.json supplements,
//                                          off-campus lots; the roundabout (painted ring, rim, island) over the road
//   5 / 5.5     A003      Ground_Pavers / Ground_Asphalt / Ground_Bicycle   NGII A003 walkway rings by `qual` / `scls`
//   5.8         TILES     Ground_Sports /  project paving supplements of data/osm-ground.json (patterned courtyard tiles
//                         Ground_Pavers /  or plain pavers, label PAVING; red non-slip road surfacing, Ground_Bicycle tile,
//                         Ground_Bicycle   label ASPHALT; all estimated): above the walkways, under the aprons
//   6           APRON     Ground_Apron     the 2.2 m band centred on every building outline (1.1 m outside it, estimated)
// A003 rings are the kerb lines: they stay exactly where the survey has them and the road zones stay under them.
//
// The same module rasterises the layers into the SURFACE_CLASS label raster (`labelRaster`) that groundInfo.labels
// carries for the lamp rule in stages/lights.mjs, with the 0.3 m edge-stone band on every A003 outline (KERB) so the
// lamp rule sees the same road/non-road split as before.
//
//   bun scripts/campus-model/network/surfaces.mjs --stats [--preview <png>]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { EXTENT, SCENE_UNITS_PER_METRE, geoToModel, metres } from "../lib/frame.mjs";
import { cleanRing, pointInRing, ringArea } from "../lib/geometry.mjs";
import { encodePng } from "../lib/png.mjs";
import { Raster } from "../lib/raster.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GROUND_FEATURES = path.join(HERE, "..", "data", "osm-ground.json");
const WALKWAYS = path.resolve(HERE, "../../../..", "docs", "assets", "data", "walkways_wgs84.geojson");

// Label raster resolution of the old ground texture: 6.5 px per scene unit (0.2465 m).
export const PX = 6.5;
const WIDTH = EXTENT.maxX - EXTENT.minX;
const DEPTH = EXTENT.maxZ - EXTENT.minZ;
export const EDGE_STONE_M = 0.3;
const APRON_OUT_M = 1.1;
const WATER_RIM_M = 0.8;
const FACILITY_RIM_M = 0.6;
const FOUNTAIN_RIM_M = 0.7;
const BICYCLE_LANE = "A0033327";

export const PRECEDENCE = Object.freeze({ SPORTS: 1, PAVING: 2, ASPHALT: 3, LOT: 4, A003: 5, BICYCLE: 5.5, TILES: 5.8, APRON: 6 });

// ---------------------------------------------------------------- inputs
// A003 walkways (walkways_wgs84.geojson): outlines, not centrelines. Closed rings run along the kerb and the back edge
// of each paved area, open lines where an outline is cut (orthophoto registration, 2026-10-24). `qual` is the paving:
// SWQ003 block paver, SWQ001 asphalt, SWQ999/null existing paving; `scls` A0033327 marks the red bicycle lanes.
export async function loadWalkways() {
  const data = JSON.parse(await Bun.file(WALKWAYS).text());
  return data.features.map(({ properties, geometry }) => ({
    ufid: properties.ufid,
    surface: walkwaySurface(properties),
    lines: (geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates).map((line) => line.map(([lon, lat]) => geoToModel(lon, lat))),
  }));
}
// data/network/walkways.json (network/walkways.mjs via buildNetwork.mjs): estimated walkway strips, EPSG:5186 rings.
const ESTIMATED_WALKWAYS = path.join(HERE, "..", "data", "network", "walkways.json");
export async function loadEstimatedWalkways(file = ESTIMATED_WALKWAYS) {
  const f = Bun.file(file);
  const data = (await f.exists()) ? JSON.parse(await f.text()) : {};
  return { strips: data.strips ?? [], crossings: data.crossings ?? [] };
}
export const walkwaySurface = ({ scls, qual }) => (scls === BICYCLE_LANE ? "bicycle" : qual === "SWQ003" ? "blockPaver" : qual === "SWQ001" ? "asphalt" : "existing");
const isClosed = (line) => line.length >= 2 && line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1];

// data/osm-ground.json (fetch/osm.mjs): OSM stadium/pitches/parking/plazas/water, MCEE class-141 facility outlines
// (track, courts, oval lawn) and project-authored surface labels and estimates, in model units.
export async function loadGroundFeatures() {
  const data = JSON.parse(await Bun.file(GROUND_FEATURES).text());
  const toModel = (ring) => ring.map(([lon, lat]) => geoToModel(lon, lat));
  const osm = data.osm.features.map((f) => ({ ...f, rings: f.rings.map(toModel) }));
  const facilities = data.facilities.features.map((f, index) => ({ index, rings: f.rings.map(toModel) }));
  const supplements = data.supplements.features.map((f) => ({
    ...f,
    ...(f.at || f.centre ? { point: geoToModel(...(f.at ?? f.centre)) } : {}),
    ...(f.axis ? { axis: toModel(f.axis) } : {}),
    ...(f.ring ? { ring: toModel(f.ring) } : {}),
  }));
  const areaM2 = (ring) => Math.abs(ringArea(ring)) / SCENE_UNITS_PER_METRE ** 2;
  const stadiums = osm.filter((f) => f.kind === "stadium");
  const labels = supplements.filter((f) => f.kind === "surface");
  const painted = [];
  for (const facility of facilities) {
    const outer = facility.rings[0];
    const own = labels.filter((label) => pointInRing(label.point, outer));
    const centroid = outer.reduce((acc, [x, z]) => [acc[0] + x / outer.length, acc[1] + z / outer.length], [0, 0]);
    if (own.length) painted.push({ ...facility, labels: own });
    else if (areaM2(outer) >= 8000 && stadiums.some((s) => pointInRing(centroid, s.rings[0]))) painted.push({ ...facility, track: true });
  }
  return { osm, lines: data.osm.lines ?? [], facilities: painted, supplements, unlabelledLabels: labels.filter((l) => !painted.some((p) => p.labels?.includes(l))) };
}

// Rectangle `depthMetres` wide centred on the two-point axis (model units).
export function parkingRing([[ax, az], [bx, bz]], depthMetres) {
  const length = Math.hypot(bx - ax, bz - az);
  const half = metres(depthMetres) / 2;
  const nx = (-(bz - az) / length) * half;
  const nz = ((bx - ax) / length) * half;
  return [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
}

// Oriented frame of a ring (model units): centre, unit axis along the long side, half sizes in metres.
export function orientedFrame(ring) {
  let best = null;
  for (let a = 0; a < 180; a += 0.5) {
    const ux = Math.cos((a * Math.PI) / 180);
    const uz = Math.sin((a * Math.PI) / 180);
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of ring) {
      const s = x * ux + z * uz;
      const t = -x * uz + z * ux;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area) best = { area, ux, uz, s0, s1, t0, t1 };
  }
  const { ux, uz, s0, s1, t0, t1 } = best;
  const sc = (s0 + s1) / 2;
  const tc = (t0 + t1) / 2;
  const frame = { cx: sc * ux - tc * uz, cz: sc * uz + tc * ux, ux, uz, halfLength: (s1 - s0) / 2 / SCENE_UNITS_PER_METRE, halfWidth: (t1 - t0) / 2 / SCENE_UNITS_PER_METRE };
  if (frame.halfWidth > frame.halfLength) {
    [frame.ux, frame.uz] = [-uz, ux];
    [frame.halfLength, frame.halfWidth] = [frame.halfWidth, frame.halfLength];
  }
  return frame;
}

// ---------------------------------------------------------------- ring helpers (model units)
export function discRing([cx, cz], radius, sides = 48) {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [cx + Math.cos(a) * radius, cz + Math.sin(a) * radius];
  });
}

// Closed ring offset by d model units outward (negative: inward), mitred, mitre capped at 3 d.
export function offsetRing(ring, d) {
  const sign = ringArea(ring) > 0 ? 1 : -1;
  const n = ring.length;
  const normalOf = (a, b) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [((b[1] - a[1]) / length) * sign, (-(b[0] - a[0]) / length) * sign];
  };
  return ring.map((p, i) => {
    const na = normalOf(ring[(i - 1 + n) % n], p);
    const nb = normalOf(p, ring[(i + 1) % n]);
    let m = [na[0] + nb[0], na[1] + nb[1]];
    const length = Math.hypot(m[0], m[1]);
    if (length < 1e-9) m = na;
    else m = [m[0] / length, m[1] / length];
    const cos = Math.max(1 / 3, m[0] * na[0] + m[1] * na[1]);
    return [p[0] + (m[0] * d) / cos, p[1] + (m[1] * d) / cos];
  });
}

// Band of width `widthModel` centred on a closed ring: [outer, hole].
const bandRings = (ring, widthModel) => [offsetRing(ring, widthModel / 2), offsetRing(ring, -widthModel / 2)];

// Model ring -> cleaned EPSG:5186 ring, counter-clockwise (E east, N north), or null when degenerate.
function toTmRing(ring) {
  const cleaned = cleanRing(ring);
  if (cleaned.length < 3) return null;
  const tm = cleaned.map(([x, z]) => sceneToTm(x, z));
  const area = tm.reduce((sum, p, i) => {
    const q = tm[(i + 1) % tm.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  if (Math.abs(area) < 1e-6) return null;
  return area > 0 ? tm : tm.reverse();
}

// ---------------------------------------------------------------- arterial and connector strips
// The arterial east of the campus (Jungang-ro) lies outside the measured road zones. Its carriageway follows the OSM
// centreline (osm-ground.json `osm.lines`): every SAMPLE_M along the line the asphalt runs out to the nearest
// measured A003 walkway (edge stones included), building or off-campus lot on each side, so the surveyed sidewalks
// bound it and the OSM line's few-metre offset does not show. With nothing within ARTERIAL_MAX_HALF_M a side falls
// back to ARTERIAL_FALLBACK_HALF_M (ESTIMATED). Connectors (side roads sharing a node with the arterial) are traced
// the same way from the junction until they reach a measured road zone or CONNECTOR_MAX_M.
const SAMPLE_M = 1;
const MARCH_M = 0.2;
const ARTERIAL_MAX_HALF_M = 16;
const ARTERIAL_FALLBACK_HALF_M = 8;
const CONNECTOR_MAX_HALF_M = 8;
const CONNECTOR_FALLBACK_HALF_M = 4;
const CONNECTOR_MAX_M = 60;

// Points every SAMPLE_M along a polyline (model units) with unit direction u and arc length s (m).
function resample(line) {
  const out = [];
  let s = 0;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const length = Math.hypot(bx - ax, bz - az) / SCENE_UNITS_PER_METRE;
    if (length < 1e-6) continue;
    const u = [(bx - ax) / (length * SCENE_UNITS_PER_METRE), (bz - az) / (length * SCENE_UNITS_PER_METRE)];
    const first = out.length ? Math.ceil((s - out.at(-1).s) / SAMPLE_M) * SAMPLE_M - (s - out.at(-1).s) : 0;
    for (let d = first; d < length; d += SAMPLE_M) out.push({ p: [ax + u[0] * metres(d), az + u[1] * metres(d)], u, s: s + d });
    s += length;
  }
  const [x, z] = line.at(-1);
  if (out.length) out.push({ p: [x, z], u: out.at(-1).u, s });
  return out;
}

const median = (values, radius) => values.map((_, i) => {
  const window = values.slice(Math.max(0, i - radius), i + radius + 1).filter((v) => v !== null).sort((a, b) => a - b);
  return window.length ? window[window.length >> 1] : null;
});

// lines: osm-ground.json `osm.lines` (lon/lat); block / roadZoneMask: pixel masks (width x height at `toPixel`).
// Returns the strip quads (model units) with the OSM way each belongs to.
export function traceArterials({ lines, block, roadZoneMask, width, height, toPixel }) {
  const toModel = (line) => line.map(([lon, lat]) => geoToModel(lon, lat));
  const arterials = lines.filter((l) => l.kind === "arterial").map((l) => ({ id: l.id, line: toModel(l.line) }));
  const connectors = lines.filter((l) => l.kind === "connector").map((l) => ({ id: l.id, line: toModel(l.line) }));
  const key = ([x, z]) => `${x.toFixed(4)},${z.toFixed(4)}`;
  const arterialKeys = new Set(arterials.flatMap((a) => a.line).map(key));
  const pixelIndex = ([x, z]) => {
    const [px, py] = toPixel([x, z]);
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    return ix < 0 || iy < 0 || ix >= width || iy >= height ? -1 : iy * width + ix;
  };
  // Metres from p along direction n to the first blocked pixel or the raster edge; null if p is blocked.
  const march = (p, n, maxMetres) => {
    for (let d = 0; d <= maxMetres; d += MARCH_M) {
      const index = pixelIndex([p[0] + n[0] * metres(d), p[1] + n[1] * metres(d)]);
      if (index < 0) return d;
      if (block[index]) return d === 0 ? null : d;
    }
    return Infinity;
  };
  const strips = [];
  const trace = (samples, maxHalf, fallbackHalf) => {
    const sides = samples.map(({ p, u }) => {
      const n = [-u[1], u[0]];
      const left = march(p, [-n[0], -n[1]], maxHalf);
      const right = march(p, n, maxHalf);
      if (left === null || right === null) return [null, null];
      return [left === Infinity ? fallbackHalf : left, right === Infinity ? fallbackHalf : right];
    });
    const left = median(sides.map((s) => s[0]), 3);
    const right = median(sides.map((s) => s[1]), 3);
    return samples.map((sample, i) => ({ ...sample, n: [-sample.u[1], sample.u[0]], left: left[i], right: right[i] }));
  };
  for (const { id, line } of arterials) {
    const samples = trace(resample(line), ARTERIAL_MAX_HALF_M, ARTERIAL_FALLBACK_HALF_M).filter((s) => pixelIndex(s.p) >= 0);
    if (!samples.some((s) => s.left !== null)) continue;
    strips.push({ id, samples });
  }
  for (const { id, line } of connectors) {
    for (const [index, p] of line.entries()) {
      if (!arterialKeys.has(key(p))) continue;
      for (const part of [line.slice(index), line.slice(0, index + 1).reverse()]) {
        if (part.length < 2) continue;
        const samples = [];
        for (const sample of resample(part)) {
          const at = pixelIndex(sample.p);
          if (at < 0 || sample.s > CONNECTOR_MAX_M || (sample.s > 2 && roadZoneMask[at])) break;
          samples.push(sample);
        }
        if (samples.length >= 2) strips.push({ id, samples: trace(samples, CONNECTOR_MAX_HALF_M, CONNECTOR_FALLBACK_HALF_M) });
      }
    }
  }
  const edge = (s, side) => (side < 0
    ? [s.p[0] - s.n[0] * metres(s.left), s.p[1] - s.n[1] * metres(s.left)]
    : [s.p[0] + s.n[0] * metres(s.right), s.p[1] + s.n[1] * metres(s.right)]);
  const quads = [];
  for (const { id, samples } of strips) {
    for (let i = 0; i + 1 < samples.length; i += 1) {
      const a = samples[i];
      const b = samples[i + 1];
      if (a.left === null || b.left === null) continue;
      quads.push({ id, ring: [edge(a, -1), edge(b, -1), edge(b, 1), edge(a, 1)] });
    }
  }
  return { strips: strips.length, quads };
}

// ---------------------------------------------------------------- builder
// Pixel mask of whatever `draw(raster)` paints.
function maskOf(width, height, draw) {
  const raster = new Raster(width, height);
  draw(raster);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = raster.data[i * 3] ? 1 : 0;
  return mask;
}

// Walkway rings of one A003 feature as polygons: a ring inside another ring of the same feature is its hole (the
// outlines are filled even-odd per feature).
function walkwayPolygons(rings) {
  const sorted = [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const polygons = [];
  for (const ring of sorted) {
    const host = polygons.find((polygon) => pointInRing(ring[0], polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(ring[0], hole)));
    if (host) host.push(ring);
    else polygons.push([ring]);
  }
  return polygons;
}

// inputs: { roadZones } (model units, as stages/sources.mjs loadInputs); walkways: loadWalkways(); groundFeatures:
// loadGroundFeatures() (optional); offCampusLots: rings; buildings: [{ parts: [{ outer }] }]; crosswalks: rings
// (model units, passed through in EPSG:5186 for the kerb stage). warn: where skipped inputs are reported.
export function buildSurfaces({ inputs, walkways, groundFeatures = null, offCampusLots = [], buildings = [], crosswalks = [], estimatedWalkways = [], warn = console.warn }) {
  const layers = [];
  const strokes = [];
  const skipped = [];
  const add = (layer, modelRings) => {
    const rings = [];
    for (const ring of modelRings) {
      const tm = toTmRing(ring);
      if (tm) rings.push(tm);
      else if (!rings.length) return null; // degenerate outer: nothing to draw
    }
    if (!rings.length) return null;
    const entry = { ...layer, rings };
    layers.push(entry);
    return entry;
  };

  // ---- A003 walkway outlines: closed rings are paved areas, every outline (closed or open) is a kerb line
  const outlines = [];
  const walkwayRings = [];
  for (const walkway of walkways) {
    const rings = [];
    for (const line of walkway.lines) {
      if (isClosed(line) && line.length < 4) {
        const message = `A003 ufid=${walkway.ufid}: closed outline with ${line.length} points skipped`;
        skipped.push(message);
        warn(message);
        continue;
      }
      if (line.length < 2) continue;
      outlines.push({ ufid: walkway.ufid, surface: walkway.surface, closed: isClosed(line), line: line.map(([x, z]) => sceneToTm(x, z)) });
      if (isClosed(line)) rings.push(line.slice(0, -1));
    }
    walkwayRings.push({ walkway, rings });
  }

  // ---- 1 painted surfaces, 2 plazas and rims
  if (groundFeatures) {
    if (groundFeatures.unlabelledLabels?.length) throw new Error(`osm-ground.json: surface labels outside every facility polygon: ${groundFeatures.unlabelledLabels.map((l) => l.note).join("; ")}`);
    const ofKind = (kind) => groundFeatures.osm.filter((f) => f.kind === kind);
    const reclassed = new Map(groundFeatures.supplements.filter((f) => f.kind === "reclass").map((f) => [f.osm, f.surface]));
    // Reclass surfaces: a water area painted as lawn (natural ground), a pitch painted as clay.
    const RECLASS = { lawn: "water", clay: "pitch" };
    for (const [id, surface] of reclassed) {
      const target = groundFeatures.osm.find((f) => f.id === id);
      if (!target) throw new Error(`osm-ground.json: reclass target ${id} is not an OSM area`);
      if (!RECLASS[surface]) throw new Error(`osm-ground.json: unknown reclass surface ${surface}`);
      if (RECLASS[surface] !== target.kind) throw new Error(`osm-ground.json: reclass ${surface} applies to an OSM ${RECLASS[surface]}, ${id} is a ${target.kind}`);
    }
    const tmPoint = ([x, z]) => sceneToTm(x, z);
    for (const water of ofKind("water")) {
      if (reclassed.has(water.id)) continue;
      add({ cls: "SPORTS", mesh: "Ground_Sports", label: SURFACE_CLASS.PAINTED, precedence: PRECEDENCE.SPORTS, source: "OSM-derived", source_ref: water.id, paint: { kind: "water" } }, water.rings);
      for (const ring of water.rings) {
        add({ cls: "PAVING", mesh: "Ground_Apron", label: SURFACE_CLASS.PAVING, precedence: PRECEDENCE.PAVING, source: "OSM-derived", source_ref: `${water.id} rim`, estimated: true }, bandRings(ring, metres(WATER_RIM_M)));
      }
    }
    for (const plaza of ofKind("plaza")) {
      add({ cls: "PAVING", mesh: "Ground_Pavers", label: SURFACE_CLASS.PAVING, precedence: PRECEDENCE.PAVING, source: "OSM-derived", source_ref: plaza.id }, plaza.rings);
    }
    // OSM pitches only where no facility outline covers them (MCEE outlines are closer to the ground).
    for (const pitch of ofKind("pitch")) {
      const outer = pitch.rings[0];
      const centroid = outer.reduce((acc, [x, z]) => [acc[0] + x / outer.length, acc[1] + z / outer.length], [0, 0]);
      if (groundFeatures.facilities.some((f) => pointInRing(centroid, f.rings[0]))) continue;
      const clay = reclassed.get(pitch.id) === "clay";
      add({ cls: "SPORTS", mesh: "Ground_Sports", label: SURFACE_CLASS.SPORTS, precedence: PRECEDENCE.SPORTS, source: "OSM-derived", source_ref: pitch.id, paint: { kind: "pitch", sport: pitch.tags?.sport ?? null, ...(clay ? { surface: "clay" } : {}) }, ...(clay ? { estimated: true } : {}) }, pitch.rings);
    }
    for (const facility of groundFeatures.facilities) {
      const ref = `MCEE class-141 facility ${facility.index}`;
      if (facility.track) {
        add({ cls: "SPORTS", mesh: "Ground_Sports", label: SURFACE_CLASS.SPORTS, precedence: PRECEDENCE.SPORTS, source: "project-estimated", source_ref: ref, paint: { kind: "track" }, estimated: true }, facility.rings);
        continue;
      }
      if (facility.labels.every((l) => l.surface === "lawn")) {
        // natural ground (the lawn is the base), with its stone rim
        for (const ring of facility.rings) {
          add({ cls: "PAVING", mesh: "Ground_Apron", label: SURFACE_CLASS.PAVING, precedence: PRECEDENCE.PAVING, source: "project-estimated", source_ref: `${ref} rim`, estimated: true }, bandRings(ring, metres(FACILITY_RIM_M)));
        }
        continue;
      }
      const labels = facility.labels.map((l) => ({ surface: l.surface, point: tmPoint(l.point), headingDegrees: l.headingDegrees, lines: l.lines, note: l.note }));
      add({ cls: "SPORTS", mesh: "Ground_Sports", label: SURFACE_CLASS.SPORTS, precedence: PRECEDENCE.SPORTS, source: "project-estimated", source_ref: ref, paint: { kind: "labels", labels }, estimated: true }, facility.rings);
    }
    for (const fountain of groundFeatures.supplements.filter((f) => f.kind === "fountain")) {
      const r = metres(fountain.radiusMetres);
      add({ cls: "PAVING", mesh: "Ground_Apron", label: SURFACE_CLASS.PAVING, precedence: PRECEDENCE.PAVING, source: "project-estimated", source_ref: "fountain rim", estimated: true }, [discRing(fountain.point, r), discRing(fountain.point, r - metres(FOUNTAIN_RIM_M))]);
      add({ cls: "SPORTS", mesh: "Ground_Sports", label: SURFACE_CLASS.PAINTED, precedence: PRECEDENCE.SPORTS, source: "project-estimated", source_ref: "fountain", paint: { kind: "fountain" }, estimated: true }, [discRing(fountain.point, r - metres(FOUNTAIN_RIM_M))]);
    }
  }

  // ---- 3 road zones and traced strips
  inputs.roadZones.forEach((polygon, i) => {
    add({ cls: "ASPHALT", mesh: "Ground_Asphalt", label: SURFACE_CLASS.ASPHALT, precedence: PRECEDENCE.ASPHALT, source: "road-zone-measured", source_ref: `road zone ${i}` }, polygon);
  });
  let arterial = { strips: 0, quads: [] };
  const arterialLines = groundFeatures?.lines?.filter((l) => l.kind === "arterial" || l.kind === "connector") ?? [];
  if (arterialLines.length) {
    const width = Math.round(WIDTH * PX);
    const height = Math.round(DEPTH * PX);
    const toPixel = ([x, z]) => [(x - EXTENT.minX) * PX, (z - EXTENT.minZ) * PX];
    const white = () => [255, 255, 255];
    const edgeStonePx = metres(EDGE_STONE_M) * PX;
    const block = maskOf(width, height, (r) => {
      for (const { rings } of walkwayRings) if (rings.length) r.fillPolygon(rings.map((ring) => ring.map(toPixel)), white);
      for (const o of outlines) r.strokePolyline(o.line.map(([E, N]) => toPixel(tmToScene(E, N))), edgeStonePx, white);
      for (const lot of offCampusLots) r.fillPolygon([lot.map(toPixel)], white);
      for (const building of buildings) for (const part of building.parts) r.fillPolygon([part.outer.map(toPixel)], white);
    });
    const roadZoneMask = maskOf(width, height, (r) => {
      for (const polygon of inputs.roadZones) r.fillPolygon(polygon.map((ring) => ring.map(toPixel)), white);
    });
    arterial = traceArterials({ lines: arterialLines, block, roadZoneMask, width, height, toPixel });
    for (const quad of arterial.quads) {
      add({ cls: "ASPHALT", mesh: "Ground_Asphalt", label: SURFACE_CLASS.ASPHALT, precedence: PRECEDENCE.ASPHALT, source: "OSM-derived", source_ref: quad.id, estimated: true }, [quad.ring]);
    }
  }

  // ---- 4 lots and the roundabout over the road
  if (groundFeatures) {
    for (const lot of groundFeatures.osm.filter((f) => f.kind === "parking")) {
      add({ cls: "LOT", mesh: "Ground_Lot", label: SURFACE_CLASS.ASPHALT, precedence: PRECEDENCE.LOT, source: "OSM-derived", source_ref: lot.id }, lot.rings);
    }
    groundFeatures.supplements.filter((f) => f.kind === "parking").forEach((lot, i) => {
      add({ cls: "LOT", mesh: "Ground_Lot", label: SURFACE_CLASS.ASPHALT, precedence: PRECEDENCE.LOT, source: "project-estimated", source_ref: `supplement parking ${i}: ${lot.note ?? ""}`.trim(), estimated: true }, [parkingRing(lot.axis, lot.depthMetres)]);
    });
    for (const roundabout of groundFeatures.supplements.filter((f) => f.kind === "roundabout")) {
      const r = metres(roundabout.radiusMetres);
      const disc = (k) => discRing(roundabout.point, r * k, 64);
      const base = { cls: "LOT", precedence: PRECEDENCE.LOT, source: "project-estimated", source_ref: "roundabout", estimated: true };
      add({ ...base, mesh: "Ground_Sports", label: SURFACE_CLASS.PAINTED, paint: { kind: "roundabout" } }, [disc(1), disc(0.44)]);
      add({ ...base, mesh: "Ground_Apron", label: SURFACE_CLASS.PAVING }, [disc(0.44), disc(0.38)]);
      add({ ...base, mesh: "Ground_Sports", label: SURFACE_CLASS.NATURAL, paint: { kind: "island" } }, [disc(0.38), disc(0.12)]);
      add({ ...base, mesh: "Ground_Apron", label: SURFACE_CLASS.PAVING }, [disc(0.12)]);
    }
  }
  offCampusLots.forEach((lot, i) => {
    add({ cls: "LOT", mesh: "Ground_Lot", label: SURFACE_CLASS.LOT, precedence: PRECEDENCE.LOT, source: "project-estimated", source_ref: `off-campus lot ${i}` }, [lot]);
  });

  // ---- 5 A003 walkways (bicycle lanes above the pavers they run beside)
  const WALKWAY = {
    blockPaver: { mesh: "Ground_Pavers", cls: "PAVING", label: SURFACE_CLASS.PAVING, precedence: PRECEDENCE.A003 },
    existing: { mesh: "Ground_Pavers", cls: "PAVING", label: SURFACE_CLASS.PAVING, precedence: PRECEDENCE.A003 },
    asphalt: { mesh: "Ground_Asphalt", cls: "ASPHALT", label: SURFACE_CLASS.ASPHALT, precedence: PRECEDENCE.A003 },
    bicycle: { mesh: "Ground_Bicycle", cls: "BICYCLE", label: SURFACE_CLASS.BICYCLE, precedence: PRECEDENCE.BICYCLE },
  };
  for (const { walkway, rings } of walkwayRings) {
    for (const polygon of walkwayPolygons(rings)) {
      add({ ...WALKWAY[walkway.surface], walkway: true, surface: walkway.surface, source: "NGII-A003", source_ref: walkway.ufid }, polygon);
    }
  }
  for (const o of outlines) strokes.push({ line: o.line, widthM: EDGE_STONE_M, label: SURFACE_CLASS.KERB, precedence: PRECEDENCE.A003 + 0.6 });

  // ---- 5.8 paving supplements: a courtyard's patterned tiles (pattern "tiles", running along `axis`), plain pavers, or
  // the red non-slip surfacing of a carriageway (pattern "red": the red asphalt tile of the bicycle lanes, still road)
  for (const paving of groundFeatures?.supplements.filter((f) => f.kind === "paving") ?? []) {
    if (!(paving.ring?.length >= 3) || !(paving.pattern === "plain" || paving.pattern === "red" || (paving.pattern === "tiles" && paving.axis))) throw new Error(`osm-ground.json: paving "${paving.note}" needs a ring and pattern "plain", "red" or "tiles" with an axis`);
    if (paving.pattern === "red") {
      add({ cls: "ASPHALT", mesh: "Ground_Bicycle", label: SURFACE_CLASS.ASPHALT, precedence: PRECEDENCE.TILES, source: "project-estimated", source_ref: `paving: ${paving.note}`, estimated: true }, [paving.ring]);
      continue;
    }
    if (paving.pattern === "plain") {
      add({ cls: "PAVING", mesh: "Ground_Pavers", label: SURFACE_CLASS.PAVING, precedence: PRECEDENCE.TILES, source: "project-estimated", source_ref: `paving: ${paving.note}`, estimated: true }, [paving.ring]);
      continue;
    }
    add({ cls: "PAVING", mesh: "Ground_Sports", label: SURFACE_CLASS.PAVING, precedence: PRECEDENCE.TILES, source: "project-estimated", source_ref: `paving: ${paving.note}`, paint: { kind: "tiles", axis: paving.axis.map(([x, z]) => sceneToTm(x, z)) }, estimated: true }, [paving.ring]);
  }

  // ---- 6 building aprons
  for (const building of buildings) {
    for (const part of building.parts) {
      add({ cls: "PAVING", mesh: "Ground_Apron", label: SURFACE_CLASS.PAVING, precedence: PRECEDENCE.APRON, source: "project-estimated", source_ref: building.name ?? building.id ?? "building", estimated: true }, [offsetRing(part.outer, metres(APRON_OUT_M)), part.outer]);
    }
  }

  // ---- 2 estimated walkways (paving under the road and lot layers, like the plazas; already in EPSG:5186)
  for (const strip of estimatedWalkways) {
    layers.push({ cls: "PAVING", mesh: "Ground_Walkway", label: SURFACE_CLASS.PAVING, precedence: PRECEDENCE.PAVING, source: "project-estimated", source_ref: strip.source_ref ?? strip.id, estimated: true, walkwayEstimated: true, rings: strip.rings });
  }

  const crossings = crosswalks.map((ring) => toTmRing(ring)).filter(Boolean);
  return {
    layers,
    strokes,
    outlines,
    crossings,
    arterial: { strips: arterial.strips, quads: arterial.quads.length },
    skipped,
    labelRaster: (width, height, toPixel) => labelRaster({ layers, strokes }, width, height, toPixel),
  };
}

// ---------------------------------------------------------------- label raster
class LabelFill extends Raster {
  constructor(width, height) {
    super(0, 0);
    this.width = width;
    this.height = height;
    this.labels = new Uint8Array(width * height).fill(SURFACE_CLASS.NATURAL);
    this.value = SURFACE_CLASS.NATURAL;
  }

  set(x, y) {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.labels[y * this.width + x] = this.value;
  }
}

// Layers (even-odd per polygon) and strokes in precedence order; toPixel maps [E, N] to pixel coordinates.
export function labelRaster({ layers, strokes = [] }, width, height, toPixel) {
  const fill = new LabelFill(width, height);
  const items = [...layers.map((layer, order) => ({ layer, order })), ...strokes.map((stroke, order) => ({ stroke, order: layers.length + order }))]
    .sort((a, b) => ((a.layer ?? a.stroke).precedence - (b.layer ?? b.stroke).precedence) || a.order - b.order);
  const none = () => null;
  for (const item of items) {
    if (item.layer) {
      fill.value = item.layer.label;
      fill.fillPolygon(item.layer.rings.map((ring) => ring.map(toPixel)), none);
    } else {
      const { line, widthM } = item.stroke;
      const [ax, ay] = toPixel(line[0]);
      const [bx, by] = toPixel([line[0][0] + widthM, line[0][1]]);
      fill.value = item.stroke.label;
      fill.strokePolyline(line.map(toPixel), Math.hypot(bx - ax, by - ay), none);
    }
  }
  return fill.labels;
}

// ---------------------------------------------------------------- stats and preview
export function surfaceStats({ layers, outlines, arterial, skipped }) {
  const by = (key) => layers.reduce((acc, l) => ({ ...acc, [l[key]]: (acc[l[key]] ?? 0) + 1 }), {});
  const a003 = layers.filter((l) => l.source === "NGII-A003");
  return {
    layers: layers.length,
    byMesh: by("mesh"),
    bySource: by("source"),
    a003Polygons: a003.length,
    a003Rings: a003.reduce((n, l) => n + l.rings.length, 0),
    a003Outlines: outlines.length,
    a003OpenLines: outlines.filter((o) => !o.closed).length,
    roadZones: layers.filter((l) => l.source === "road-zone-measured").length,
    lots: layers.filter((l) => l.mesh === "Ground_Lot").length,
    arterialStrips: arterial.strips,
    arterialQuads: arterial.quads,
    skipped,
  };
}

const PREVIEW_COLOURS = {
  [SURFACE_CLASS.NATURAL]: [96, 128, 72],
  [SURFACE_CLASS.PAVING]: [200, 192, 176],
  [SURFACE_CLASS.ASPHALT]: [70, 72, 78],
  [SURFACE_CLASS.PAINTED]: [176, 88, 70],
  [SURFACE_CLASS.LOT]: [130, 130, 150],
  [SURFACE_CLASS.BICYCLE]: [214, 60, 50],
  [SURFACE_CLASS.SPORTS]: [60, 120, 190],
  [SURFACE_CLASS.KERB]: [250, 250, 250],
  [SURFACE_CLASS.TACTILE]: [232, 195, 58],
};

// Vector-only PNG of the label raster over EXTENT (no photo pixels).
export function renderPreview(surfaces, widthPx = 2000) {
  const scale = widthPx / WIDTH;
  const heightPx = Math.round(DEPTH * scale);
  const labels = surfaces.labelRaster(widthPx, heightPx, ([E, N]) => {
    const [x, z] = tmToScene(E, N);
    return [(x - EXTENT.minX) * scale, (z - EXTENT.minZ) * scale];
  });
  const rgb = new Uint8Array(widthPx * heightPx * 3);
  labels.forEach((label, i) => rgb.set(PREVIEW_COLOURS[label], i * 3));
  return encodePng(widthPx, heightPx, 3, rgb);
}

// ---------------------------------------------------------------- CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const { loadInputs } = await import("../stages/sources.mjs");
  const { loadFurniture } = await import("../stages/furniture.mjs");
  const { buildBuildings } = await import("../stages/buildings.mjs");
  const { GlbBuilder } = await import("../lib/glb.mjs");
  const inputs = await loadInputs();
  const furniture = loadFurniture();
  const { selectableBuildings, campusBuildings, offCampusLots } = await buildBuildings({ glb: new GlbBuilder(), inputs, detailedStructures: furniture.detailedStructures });
  const surfaces = buildSurfaces({
    inputs,
    walkways: await loadWalkways(),
    groundFeatures: await loadGroundFeatures(),
    offCampusLots,
    buildings: [...selectableBuildings, ...campusBuildings],
    crosswalks: inputs.crosswalks,
  });
  if (args.includes("--stats")) console.log(`SURFACES ${JSON.stringify(surfaceStats(surfaces))}`);
  const previewIndex = args.indexOf("--preview");
  if (previewIndex >= 0) {
    const out = path.resolve(args[previewIndex + 1]);
    await Bun.write(out, renderPreview(surfaces));
    console.log(`preview written to ${out}`);
  }
}

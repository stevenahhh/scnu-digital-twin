// Ground stage: paint the procedural ground (walkways, ground features from data/osm-ground.json, roads,
// off-campus lots, building curbs), lay the VWorld z19 orthophoto over it (lib/orthoGround.mjs: the procedural
// layer only fills what the model draws itself - building footprints, tree crowns, street trees over paving -
// and relights the photo's cast shadows), emit the chunked Topography terrain and the crosswalk stripes.
// Topography primitives carry a planar TEXCOORD_1 over EXTENT; data/ao-ground.png (baked from the raw
// GLB by `bake/bake-ao.mjs --planar`, an estimated simulation and not a measurement) becomes the Ground
// material's occlusionTexture when its layout tag matches this build's.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT, SCENE_UNITS_PER_METRE, geoToModel, metres } from "../lib/frame.mjs";
import { LANDCOVER } from "../lib/landcover.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { encodePng } from "../lib/png.mjs";
import { Raster, hashNoise, smoothNoise } from "../lib/raster.mjs";
import { pointInRing, ringArea } from "../lib/geometry.mjs";
import { SURFACE_CLASS, composeOrthoGround } from "../lib/orthoGround.mjs";

const WIDTH = EXTENT.maxX - EXTENT.minX;
const DEPTH = EXTENT.maxZ - EXTENT.minZ;

const PX = 6.5; // texture pixels per scene unit: 0.2465 m per texel, the z19 orthophoto's 0.245 m
const STEP = 2;
const CHUNK = 42;

const AO_GROUND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "ao-ground.png");
const AO_GROUND_SIZE = 1024;
const AO_GROUND_LAYOUT = `planar:${EXTENT.minX},${EXTENT.minZ},${WIDTH}x${DEPTH}@${AO_GROUND_SIZE}`;

// The aoLayout tag a baked PNG carries in its tEXt chunk, or null.
function pngLayoutTag(bytes) {
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "tEXt") {
      const [key, value] = bytes.toString("latin1", offset + 8, offset + 8 + length).split("\0");
      if (key === "aoLayout") return value;
    }
    offset += 12 + length;
  }
  return null;
}

const GROUND_FEATURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "osm-ground.json");
const WALKWAYS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..", "docs", "assets", "data", "walkways_wgs84.geojson");

// ---------------------------------------------------------------- walkways
// walkways_wgs84.geojson (A003 sidewalk centrelines): `widt` is the paved width in metres (MEASURED);
// null/zero widths fall back to 2.4 m. `qual` is the paving: SWQ003 block paver, SWQ001 asphalt,
// SWQ999/null existing paving; `scls` A0033327 marks the red asphalt bicycle lanes. Each walkway gets a
// 0.3 m edge-stone band per side (outline = width + 0.6 m) and lawn next to it is darkened over 0.3 m
// (ASSUMED trampled/shaded edge).
const WALKWAY_FALLBACK_WIDTH_M = 2.4;
const WALKWAY_EDGE_M = 0.6;
const LAWN_EDGE_M = 0.3;
const BICYCLE_LANE = "A0033327";

async function loadWalkways() {
  const data = JSON.parse(await Bun.file(WALKWAYS).text());
  return data.features.flatMap(({ properties, geometry }) => {
    const width = Number(properties.widt) > 0 ? Number(properties.widt) : WALKWAY_FALLBACK_WIDTH_M;
    const surface = properties.scls === BICYCLE_LANE ? "bicycle" : properties.qual === "SWQ003" ? "blockPaver" : properties.qual === "SWQ001" ? "asphalt" : "existing";
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
    return lines.map((line) => ({ width, surface, line: line.map(([lon, lat]) => geoToModel(lon, lat)) }));
  });
}

// The ground raster also records the surface class each pixel was painted as (SURFACE_CLASS in `labels`,
// written while `label` is not null; land cover stays NATURAL), so the orthophoto pass fills a walkway under a
// tree with walkway colour and can tell a street tree over paving from a tree over a lawn.
const { NATURAL, PAVING, ASPHALT, PAINTED, LOT } = SURFACE_CLASS;
class LabelledRaster extends Raster {
  constructor(width, height) {
    super(width, height);
    this.labels = new Uint8Array(width * height).fill(NATURAL);
    this.label = null;
  }

  set(x, y, rgb, alpha = 1) {
    super.set(x, y, rgb, alpha);
    if (this.label !== null && x >= 0 && y >= 0 && x < this.width && y < this.height) this.labels[y * this.width + x] = this.label;
  }
}

// Pixel mask of whatever `draw(raster)` paints (any non-zero red channel counts).
function maskOf(width, height, draw) {
  const raster = new Raster(width, height);
  draw(raster);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = raster.data[i * 3] ? 1 : 0;
  return mask;
}

// ---------------------------------------------------------------- ground features
// data/osm-ground.json (fetch/osm.mjs): OSM stadium/pitches/parking/plazas/water, MCEE class-141
// facility outlines (track, courts, oval lawn) and project-authored surface labels and estimates.
const M_PER_PX = 1 / (PX * SCENE_UNITS_PER_METRE); // ~0.4 m per texture pixel
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shadeBy = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
// Painted lines are thinner than a pixel; draw them about one pixel wide, antialiased.
const LINE_HALF_WIDTH = 0.22;
const lineCover = (distance) => clamp01((LINE_HALF_WIDTH + M_PER_PX / 2 - Math.abs(distance)) / M_PER_PX);
const LINE_WHITE = [236, 236, 228];
// Distance (m) to the outline of a centred rectangle with half sizes hs x ht.
const rectOutline = (s, t, hs, ht) => {
  const dx = Math.abs(s) - hs;
  const dy = Math.abs(t) - ht;
  return dx <= 0 && dy <= 0 ? Math.min(-dx, -dy) : Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
};

const SURFACE = {
  track: [168, 84, 64],
  turf: [72, 124, 60],
  futsal: [52, 106, 66],
  basketball: [58, 116, 176],
  multiApron: [116, 178, 146],
  multiCourt: [168, 82, 68],
  clay: [176, 126, 94],
  tennisCourt: [126, 156, 112],
  lawn: [104, 148, 70],
  paver: [194, 189, 178],
  parking: [92, 94, 98],
  water: [58, 88, 100],
  rim: [196, 192, 182],
  roundabout: [170, 76, 64],
  island: [90, 128, 70],
};

// Oriented frame of a ring (model units) or of a point and heading: s along the long axis, t across, metres.
function orientedFrame(ring) {
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
const headingFrame = ([cx, cz], degrees) => ({ cx, cz, ux: Math.cos((degrees * Math.PI) / 180), uz: Math.sin((degrees * Math.PI) / 180) });
const pixelToModel = (px, py) => [EXTENT.minX + (px + 0.5) / PX, EXTENT.minZ + (py + 0.5) / PX];
function toLocal(frame, px, py) {
  const [x, z] = pixelToModel(px, py);
  const dx = x - frame.cx;
  const dz = z - frame.cz;
  return [(dx * frame.ux + dz * frame.uz) / SCENE_UNITS_PER_METRE, (-dx * frame.uz + dz * frame.ux) / SCENE_UNITS_PER_METRE];
}
const grain = (base, px, py, seed, amount = 0.08) => shadeBy(base, 1 - amount / 2 + hashNoise(px, py, seed) * amount);

// Running track fitted to the outer edge of the facility outline: semicircular ends, 8 lanes of
// 1.22 m with white lane lines, red D-zones, and a football pitch with standard markings inside.
function trackShader(frame) {
  const radius = frame.halfWidth;
  const straight = Math.max(0, frame.halfLength - radius);
  const band = 8 * 1.22;
  const inner = radius - band;
  const pitchHalfWidth = Math.min(34, inner - 2);
  const pitchHalfLength = Math.min(52.5, straight + Math.sqrt(Math.max(0, inner * inner - pitchHalfWidth * pitchHalfWidth)) - 1);
  return (px, py) => {
    const [s, t] = toLocal(frame, px, py);
    const depth = radius - (Math.abs(s) <= straight ? Math.abs(t) : Math.hypot(Math.abs(s) - straight, t));
    if (depth < band + LINE_HALF_WIDTH) {
      const lane = depth / 1.22;
      return mix(grain(SURFACE.track, px, py, 21), LINE_WHITE, lineCover((lane - Math.round(lane)) * 1.22) * 0.85);
    }
    if (Math.abs(s) > pitchHalfLength + 0.5 || Math.abs(t) > pitchHalfWidth + 0.5) return grain(SURFACE.track, px, py, 21);
    const stripe = Math.floor((s + pitchHalfLength) / ((pitchHalfLength * 2) / 18)) % 2 ? 1.05 : 0.95;
    const turf = grain(shadeBy(SURFACE.turf, stripe), px, py, 22, 0.06);
    const boxS = Math.abs(s) - (pitchHalfLength - 8.25);
    const goalS = Math.abs(s) - (pitchHalfLength - 2.75);
    const d = Math.min(
      rectOutline(s, t, pitchHalfLength, pitchHalfWidth),
      Math.abs(t) <= pitchHalfWidth ? Math.abs(s) : Infinity,
      Math.abs(Math.hypot(s, t) - 9.15),
      rectOutline(boxS, t, 8.25, 20.16),
      rectOutline(goalS, t, 2.75, 9.16),
    );
    return mix(turf, LINE_WHITE, lineCover(d) * 0.85);
  };
}

// Surfaces of labelled facility areas, drawn around the label point.
function surfaceShader(label, polygonFrame) {
  const frame = label.headingDegrees === undefined ? polygonFrame : headingFrame(label.point, label.headingDegrees);
  const local = (px, py) => toLocal(frame, px, py);
  switch (label.surface) {
    case "basketball":
      return (px, py) => {
        const base = grain(SURFACE.basketball, px, py, 23, 0.05);
        if (label.lines === false) return base;
        const [s, t] = local(px, py);
        const key = Math.abs(s) - (14 - 2.9);
        const d = Math.min(
          rectOutline(s, t, 14, 7.5),
          Math.abs(t) <= 7.5 ? Math.abs(s) : Infinity,
          Math.abs(Math.hypot(s, t) - 1.8),
          rectOutline(key, t, 2.9, 2.45),
          Math.abs(s) < 14 - 1.575 - 0.0 ? Math.abs(Math.hypot(Math.abs(s) - (14 - 1.575), t) - 6.75) : Infinity,
        );
        return mix(base, LINE_WHITE, lineCover(d) * 0.85);
      };
    case "futsal":
      return (px, py) => {
        const [s, t] = local(px, py);
        const d = Math.min(rectOutline(s, t, 20, 10), Math.abs(t) <= 10 ? Math.abs(s) : Infinity, Math.abs(Math.hypot(s, t) - 3), Math.abs(Math.hypot(Math.abs(s) - 20, t) - 6));
        return mix(grain(SURFACE.futsal, px, py, 24, 0.06), LINE_WHITE, lineCover(d) * 0.8);
      };
    case "multi":
      return (px, py) => {
        const [s, t] = local(px, py);
        const inside = Math.abs(s) <= 9 && Math.abs(t) <= 4.5;
        const base = grain(inside ? SURFACE.multiCourt : SURFACE.multiApron, px, py, 25, 0.05);
        return mix(base, LINE_WHITE, lineCover(Math.min(rectOutline(s, t, 9, 4.5), Math.abs(t) <= 4.5 ? Math.abs(s) : Infinity)) * 0.8);
      };
    case "tennis":
      return (px, py) => {
        const [s, t] = local(px, py);
        let colour = grain(SURFACE.clay, px, py, 26, 0.08);
        for (const offset of [-8.2, 8.2]) {
          const tt = t - offset;
          if (Math.abs(s) <= 11.885 + 3 && Math.abs(tt) <= 5.485 + 2) colour = grain(SURFACE.tennisCourt, px, py, 27, 0.05);
          const d = Math.min(rectOutline(s, tt, 11.885, 5.485), rectOutline(s, tt, 11.885, 4.115), rectOutline(s, tt, 6.4, 4.115), Math.abs(tt) <= 4.115 && Math.abs(s) <= 6.4 ? Math.abs(tt) : Infinity, Math.abs(tt) <= 5.485 ? Math.abs(s) : Infinity);
          colour = mix(colour, LINE_WHITE, lineCover(d) * 0.8);
        }
        return colour;
      };
    case "lawn":
      return (px, py) => grain(SURFACE.lawn, px, py, 28, 0.1);
    default:
      throw new Error(`osm-ground.json: unknown surface ${label.surface}`);
  }
}

// Parking lot: asphalt with double-loaded rows of `bay` x `depth` m bays (6 m aisle) along the lot's
// long axis; OSM lots use 2.5 x 5 m.
function parkingShader(frame, bay = 2.5, depth = 5) {
  const module = depth * 2 + 6;
  return (px, py) => {
    const [s, t] = toLocal(frame, px, py);
    const base = grain(SURFACE.parking, px, py, 29, 0.1);
    const across = t + frame.halfWidth - 0.6;
    const inRow = ((across % module) + module) % module;
    let d = Infinity;
    if (across > 0 && Math.abs(s) < frame.halfLength - 0.6 && (inRow < depth || inRow > module - depth)) {
      d = Math.abs(((s % bay) + bay) % bay - bay / 2) - bay / 2;
      d = Math.min(Math.abs(d), Math.abs(inRow < depth ? inRow : module - inRow));
    }
    return mix(base, LINE_WHITE, lineCover(d) * 0.7);
  };
}

// Plaza: 2 m pavers with darker joints and per-tile tint.
function paverShader(frame) {
  return (px, py) => {
    const [s, t] = toLocal(frame, px, py);
    const tile = hashNoise(Math.floor(s / 2), Math.floor(t / 2), 30);
    const joint = Math.min(Math.abs(s - Math.round(s / 2) * 2), Math.abs(t - Math.round(t / 2) * 2));
    return shadeBy(SURFACE.paver, (0.95 + tile * 0.08) * (1 - lineCover(joint) * 0.06));
  };
}

async function loadGroundFeatures() {
  const data = JSON.parse(await Bun.file(GROUND_FEATURES).text());
  const toModel = (ring) => ring.map(([lon, lat]) => geoToModel(lon, lat));
  const osm = data.osm.features.map((f) => ({ ...f, rings: f.rings.map(toModel) }));
  const facilities = data.facilities.features.map((f) => ({ rings: f.rings.map(toModel) }));
  const supplements = data.supplements.features.map((f) => ({
    ...f,
    ...(f.at || f.centre ? { point: geoToModel(...(f.at ?? f.centre)) } : {}),
    ...(f.axis ? { axis: toModel(f.axis) } : {}),
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

async function paintGroundFeatures(ground, toPixel) {
  const features = await loadGroundFeatures();
  if (features.unlabelledLabels.length) throw new Error(`osm-ground.json: surface labels outside every facility polygon: ${features.unlabelledLabels.map((l) => l.note).join("; ")}`);
  const pixelRings = (rings) => rings.map((ring) => ring.map(toPixel));
  const ofKind = (kind) => features.osm.filter((f) => f.kind === kind);
  const reclassed = new Map(features.supplements.filter((f) => f.kind === "reclass").map((f) => [f.osm, f.surface]));
  for (const [id, surface] of reclassed) {
    const area = features.osm.find((f) => f.id === id);
    if (!area) throw new Error(`osm-ground.json: reclass target ${id} is not an OSM area`);
    if (surface !== "lawn") throw new Error(`osm-ground.json: unknown reclass surface ${surface}`);
    ground.label = NATURAL;
    ground.fillPolygon(pixelRings(area.rings), (x, y) => grain(SURFACE.lawn, x, y, 28, 0.1));
  }
  for (const water of ofKind("water")) {
    if (reclassed.has(water.id)) continue;
    ground.label = PAINTED;
    ground.fillPolygon(pixelRings(water.rings), (x, y) => grain(SURFACE.water, x, y, 31, 0.06));
    ground.label = PAVING;
    for (const ring of water.rings) ground.strokePolyline([...ring, ring[0]].map(toPixel), metres(0.8) * PX, () => SURFACE.rim);
  }
  ground.label = null;
  return {
    lines: features.lines,
    surfaces(afterPlazas) {
      ground.label = PAVING;
      for (const plaza of ofKind("plaza")) ground.fillPolygon(pixelRings(plaza.rings), paverShader(orientedFrame(plaza.rings[0])));
      ground.label = null;
      afterPlazas();
      ground.label = ASPHALT;
      for (const lot of ofKind("parking")) ground.fillPolygon(pixelRings(lot.rings), parkingShader(orientedFrame(lot.rings[0])));
      ground.label = PAINTED;
      // OSM pitches only where no facility outline covers them (MCEE outlines are closer to the ground).
      for (const pitch of ofKind("pitch")) {
        const centroid = pitch.rings[0].reduce((acc, [x, z]) => [acc[0] + x / pitch.rings[0].length, acc[1] + z / pitch.rings[0].length], [0, 0]);
        if (features.facilities.some((f) => pointInRing(centroid, f.rings[0]))) continue;
        const frame = orientedFrame(pitch.rings[0]);
        const colour = pitch.tags.sport === "tennis" ? SURFACE.tennisCourt : pitch.tags.sport === "basketball" ? SURFACE.basketball : SURFACE.turf;
        ground.fillPolygon(pixelRings(pitch.rings), (x, y) => {
          const [s, t] = toLocal(frame, x, y);
          return mix(grain(colour, x, y, 32, 0.06), LINE_WHITE, lineCover(rectOutline(s, t, frame.halfLength - 1, frame.halfWidth - 1)) * 0.8);
        });
      }
      for (const facility of features.facilities) {
        const frame = orientedFrame(facility.rings[0]);
        ground.label = PAINTED;
        if (facility.track) {
          ground.fillPolygon(pixelRings(facility.rings), trackShader(frame));
          continue;
        }
        if (facility.labels.every((l) => l.surface === "lawn")) ground.label = NATURAL;
        const shaders = facility.labels.map((label) => [label, surfaceShader(label, { ...frame, cx: label.point[0], cz: label.point[1] })]);
        ground.fillPolygon(pixelRings(facility.rings), (x, y) => {
          const [mx, mz] = pixelToModel(x, y);
          let nearest = shaders[0];
          for (const entry of shaders) {
            if (Math.hypot(entry[0].point[0] - mx, entry[0].point[1] - mz) < Math.hypot(nearest[0].point[0] - mx, nearest[0].point[1] - mz)) nearest = entry;
          }
          return nearest[1](x, y);
        });
        if (facility.labels.every((l) => l.surface === "lawn")) {
          ground.label = PAVING;
          for (const ring of facility.rings) ground.strokePolyline([...ring, ring[0]].map(toPixel), metres(0.6) * PX, () => SURFACE.rim);
        }
      }
      for (const fountain of features.supplements.filter((f) => f.kind === "fountain")) {
        const [cx, cy] = toPixel(fountain.point);
        const r = metres(fountain.radiusMetres) * PX;
        ground.label = PAVING;
        ground.fillDisc(cx, cy, r, () => SURFACE.rim);
        ground.label = PAINTED;
        ground.fillDisc(cx, cy, r - metres(0.7) * PX, (x, y) => grain([92, 132, 150], x, y, 33, 0.06));
      }
      ground.label = null;
    },
    overRoads() {
      // Estimated bays (supplements): painted over the road zones, which already cover parts of them.
      ground.label = ASPHALT;
      for (const lot of features.supplements.filter((f) => f.kind === "parking")) {
        const ring = parkingRing(lot.axis, lot.depthMetres);
        ground.fillPolygon([ring.map(toPixel)], parkingShader(orientedFrame(ring), lot.bayMetres, lot.depthMetres));
      }
      for (const roundabout of features.supplements.filter((f) => f.kind === "roundabout")) {
        const [cx, cy] = toPixel(roundabout.point);
        const r = metres(roundabout.radiusMetres) * PX;
        ground.label = PAINTED;
        ground.fillDisc(cx, cy, r, (x, y) => grain(SURFACE.roundabout, x, y, 34, 0.08));
        ground.label = PAVING;
        ground.fillDisc(cx, cy, r * 0.44, () => SURFACE.rim);
        ground.label = NATURAL;
        ground.fillDisc(cx, cy, r * 0.38, (x, y) => grain(SURFACE.island, x, y, 35, 0.12));
        ground.label = PAVING;
        ground.fillDisc(cx, cy, r * 0.12, () => [176, 174, 168]);
      }
      ground.label = null;
    },
  };
}

// Rectangle `depthMetres` wide centred on the two-point axis (model units).
function parkingRing([[ax, az], [bx, bz]], depthMetres) {
  const length = Math.hypot(bx - ax, bz - az);
  const half = metres(depthMetres) / 2;
  const nx = (-(bz - az) / length) * half;
  const nz = ((bx - ax) / length) * half;
  return [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
}

// ---------------------------------------------------------------- arterial road
// The arterial east of the campus (Jungang-ro) lies outside the measured road zones. Its carriageway
// follows the OSM centreline (osm-ground.json `osm.lines`): every SAMPLE_M along the line the asphalt
// runs out to the nearest measured A003 walkway (edge stones included), building or off-campus lot on
// each side, so the surveyed sidewalks bound it and the OSM line's few-metre offset does not show. With
// nothing within ARTERIAL_MAX_HALF_M a side falls back to ARTERIAL_FALLBACK_HALF_M (ESTIMATED).
// Connectors (side roads sharing a node with the arterial) are traced the same way from the junction
// until they reach a measured road zone or CONNECTOR_MAX_M, without markings.
// Markings are an ESTIMATED layout (OSM has no lane data here): a yellow double centre line midway
// between the sidewalks, dashed white lane lines every LANE_M (3 m dash, 5 m gap), none within
// JUNCTION_CLEAR_M of a junction node or CROSSING_CLEAR_M of a marked crossing. Marked OSM crossings
// on this asphalt join the Crosswalks mesh, CROSSING_WIDTH_M wide (ESTIMATED).
const SAMPLE_M = 1;
const MARCH_M = 0.2;
const ARTERIAL_MAX_HALF_M = 16;
const ARTERIAL_FALLBACK_HALF_M = 8;
const CONNECTOR_MAX_HALF_M = 8;
const CONNECTOR_FALLBACK_HALF_M = 4;
const CONNECTOR_MAX_M = 60;
const LANE_M = 3.25;
const JUNCTION_CLEAR_M = 6;
const CROSSING_CLEAR_M = 4;
const CROSSING_WIDTH_M = 4;
const LINE_YELLOW = [214, 172, 58];

const cover = (distance, halfWidth) => clamp01((halfWidth + M_PER_PX / 2 - Math.abs(distance)) / M_PER_PX);

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
const mean = (values, radius) => values.map((_, i) => {
  const window = values.slice(Math.max(0, i - radius), i + radius + 1);
  return window.reduce((a, b) => a + b, 0) / window.length;
});
const segmentDistance = ([px, pz], [ax, az], [bx, bz]) => {
  const dx = bx - ax;
  const dz = bz - az;
  const k = clamp01(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1));
  return Math.hypot(px - ax - dx * k, pz - az - dz * k);
};

function paintArterials({ ground, toPixel, lines, block, roadZoneMask, asphalt, crosswalks }) {
  const toModel = (line) => line.map(([lon, lat]) => geoToModel(lon, lat));
  const arterials = lines.filter((l) => l.kind === "arterial").map((l) => toModel(l.line));
  const connectors = lines.filter((l) => l.kind === "connector").map((l) => toModel(l.line));
  const crossings = lines.filter((l) => l.kind === "crossing").map((l) => toModel(l.line));
  const key = ([x, z]) => `${x.toFixed(4)},${z.toFixed(4)}`;
  const arterialKeys = new Set(arterials.flat().map(key));
  const junctions = connectors.flat().filter((p) => arterialKeys.has(key(p)));
  const pixelIndex = ([x, z]) => {
    const [px, py] = toPixel([x, z]);
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    return ix < 0 || iy < 0 || ix >= ground.width || iy >= ground.height ? -1 : iy * ground.width + ix;
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
  for (const line of arterials) {
    const samples = trace(resample(line), ARTERIAL_MAX_HALF_M, ARTERIAL_FALLBACK_HALF_M).filter((s) => pixelIndex(s.p) >= 0);
    if (!samples.some((s) => s.left !== null)) continue;
    const centre = mean(samples.map((s) => (s.left === null ? 0 : (s.right - s.left) / 2)), 10);
    samples.forEach((s, i) => {
      s.centre = centre[i];
      s.marked = s.left !== null && s.left + s.right >= 8 &&
        junctions.every((j) => Math.hypot(j[0] - s.p[0], j[1] - s.p[1]) > metres(JUNCTION_CLEAR_M)) &&
        crossings.every((c) => c.every((_, k) => k === 0 || segmentDistance(s.p, c[k - 1], c[k]) > metres(CROSSING_CLEAR_M)));
    });
    strips.push({ samples, markings: true });
  }
  for (const line of connectors) {
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
        if (samples.length >= 2) strips.push({ samples: trace(samples, CONNECTOR_MAX_HALF_M, CONNECTOR_FALLBACK_HALF_M), markings: false });
      }
    }
  }
  const edge = (s, side) => (side < 0
    ? [s.p[0] - s.n[0] * metres(s.left), s.p[1] - s.n[1] * metres(s.left)]
    : [s.p[0] + s.n[0] * metres(s.right), s.p[1] + s.n[1] * metres(s.right)]);
  const quads = [];
  for (const { samples, markings } of strips) {
    for (let i = 0; i + 1 < samples.length; i += 1) {
      const a = samples[i];
      const b = samples[i + 1];
      if (a.left === null || b.left === null) continue;
      const ring = [edge(a, -1), edge(b, -1), edge(b, 1), edge(a, 1)];
      quads.push(ring);
      const marked = markings && a.marked && b.marked;
      ground.fillPolygon([ring.map(toPixel)], (x, y) => {
        const base = asphalt(x, y);
        if (!marked) return base;
        const [mx, mz] = pixelToModel(x, y);
        const dx = mx - a.p[0];
        const dz = mz - a.p[1];
        const along = (dx * a.u[0] + dz * a.u[1]) / SCENE_UNITS_PER_METRE;
        const k = clamp01(along / SAMPLE_M);
        const t = (dx * a.n[0] + dz * a.n[1]) / SCENE_UNITS_PER_METRE - (a.centre + (b.centre - a.centre) * k);
        const half = (a.left + a.right + (b.left + b.right - a.left - a.right) * k) / 2;
        // Real lines are 0.15 m; at ~0.4 m per texel the double yellow line is one 0.5 m band and lane
        // lines are drawn 0.3 m wide so they survive texture compression and mipmapping.
        let colour = mix(base, LINE_YELLOW, cover(t, 0.25) * 0.95);
        if (((((a.s + along) % 8) + 8) % 8) < 3) {
          for (let lane = LANE_M; lane < half - 1.5; lane += LANE_M) colour = mix(colour, LINE_WHITE, cover(Math.abs(t) - lane, 0.15) * 0.95);
        }
        return colour;
      });
    }
  }
  // Marked crossings whose midpoint lies on the traced asphalt and not on an existing crosswalk.
  const painted = maskOf(ground.width, ground.height, (r) => { for (const ring of quads) r.fillPolygon([ring.map(toPixel)], () => [255, 255, 255]); });
  const centroid = (ring) => ring.reduce((acc, [x, z]) => [acc[0] + x / ring.length, acc[1] + z / ring.length], [0, 0]);
  const existing = crosswalks.map(centroid);
  const added = [];
  for (const line of crossings) {
    const a = line[0];
    const b = line.at(-1);
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const at = pixelIndex(middle);
    if (at < 0 || !painted[at] || existing.some((c) => Math.hypot(c[0] - middle[0], c[1] - middle[1]) < metres(5))) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const half = metres(CROSSING_WIDTH_M) / 2;
    const nx = (-(b[1] - a[1]) / length) * half;
    const nz = ((b[0] - a[0]) / length) * half;
    added.push([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]]);
  }
  return { strips: strips.length, quads: quads.length, crosswalks: added };
}

const jpeg = async (png, quality = 86) => new Bun.Image(png).jpeg({ quality }).toBuffer();

export async function buildGround({ glb, inputs, selectableBuildings, campusBuildings, offCampusLots, markingMaterial, treeInstances }) {
  const { heightAt, roadZones, crosswalks, landcoverAt } = inputs;
  const walkways = await loadWalkways();

  // ---- ground texture
  const ground = new LabelledRaster(WIDTH * PX, DEPTH * PX);
  const toPixel = ([x, z]) => [(x - EXTENT.minX) * PX, (z - EXTENT.minZ) * PX];
  const PALETTE = {
    [LANDCOVER.PAVED]: [158, 156, 148],
    [LANDCOVER.GRASS]: [112, 150, 74],
    [LANDCOVER.TREE]: [74, 106, 52],
    [LANDCOVER.SOIL]: [170, 140, 102],
    [LANDCOVER.TRACK]: [178, 84, 66],
    [LANDCOVER.COURT]: [62, 112, 168],
  };
  for (let y = 0; y < ground.height; y += 1) {
    for (let x = 0; x < ground.width; x += 1) {
      // bilinear blend of the four nearest class colours softens the 1-unit class grid
      const fx = x / PX - 0.5;
      const fy = y / PX - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const colourAt = (cx, cy) => PALETTE[landcoverAt(EXTENT.minX + cx + 0.5, EXTENT.minZ + cy + 0.5)];
      const c00 = colourAt(ix, iy);
      const c10 = colourAt(ix + 1, iy);
      const c01 = colourAt(ix, iy + 1);
      const c11 = colourAt(ix + 1, iy + 1);
      const k = 0.9 + smoothNoise(x, y, 14, 1) * 0.12 + hashNoise(x, y, 2) * 0.05;
      const i = (y * ground.width + x) * 3;
      for (let ch = 0; ch < 3; ch += 1) {
        const v = (c00[ch] * (1 - tx) + c10[ch] * tx) * (1 - ty) + (c01[ch] * (1 - tx) + c11[ch] * tx) * ty;
        ground.data[i + ch] = Math.max(0, Math.min(255, v * k));
      }
    }
  }
  const paving = (x, y) => {
    const joint = x % 6 === 0 || y % 6 === 0;
    const k = 0.95 + hashNoise(Math.floor(x / 6), Math.floor(y / 6), 3) * 0.08 - (joint ? 0.06 : 0);
    return [200 * k, 194 * k, 182 * k];
  };
  const asphalt = (x, y) => {
    const k = 0.9 + hashNoise(x, y, 4) * 0.12 + smoothNoise(x, y, 40, 5) * 0.06;
    // Weathered asphalt reads mid grey in the reference imagery; the earlier 70/73/77 rendered near-black
    // once ground AO and the overcast sky were applied (estimated albedo, not measured).
    return [120 * k, 123 * k, 127 * k];
  };
  // Block pavers (~0.2 x 0.1 m) are below texture resolution: warm grey with fine mottling.
  const blockPaver = (x, y) => {
    const k = 0.94 + hashNoise(x, y, 7) * 0.08 + smoothNoise(x, y, 12, 8) * 0.04;
    return [186 * k, 178 * k, 166 * k];
  };
  const bicycleLane = (x, y) => {
    const k = 0.92 + hashNoise(x, y, 9) * 0.1 + smoothNoise(x, y, 30, 10) * 0.05;
    return [138 * k, 88 * k, 78 * k];
  };
  const WALKWAY_SHADERS = { blockPaver, asphalt, bicycle: bicycleLane, existing: paving };
  const walkwayPixels = walkways.map((w) => ({ ...w, points: w.line.map(toPixel) }));
  const pavedWidth = (w, extra = 0) => metres(w.width + extra) * PX;
  // Edge stones, then the paved fill; bicycle lanes last so the red lane stays continuous where it runs
  // beside a paver walk. `clip(x, y)` limits a repaint to some pixels (others keep their colour).
  // A clipped repaint leaves the surface classes alone (most of its pixels keep their colour).
  const WALKWAY_CLASS = { blockPaver: PAVING, asphalt: ASPHALT, bicycle: PAINTED, existing: PAVING };
  const paintWalkways = (clip = null) => {
    const keep = (shade) => (x, y) => {
      if (!clip || clip(x, y)) return shade(x, y);
      const i = (y * ground.width + x) * 3;
      return [ground.data[i], ground.data[i + 1], ground.data[i + 2]];
    };
    ground.label = clip ? null : PAVING;
    for (const w of walkwayPixels) ground.strokePolyline(w.points, pavedWidth(w, WALKWAY_EDGE_M), keep(() => [164, 160, 150]));
    for (const w of [...walkwayPixels].sort((a, b) => (a.surface === "bicycle") - (b.surface === "bicycle"))) {
      if (!clip) ground.label = WALKWAY_CLASS[w.surface];
      ground.strokePolyline(w.points, pavedWidth(w), keep(WALKWAY_SHADERS[w.surface]));
    }
    ground.label = null;
  };
  const groundFeatures = await paintGroundFeatures(ground, toPixel);
  const paintWalkwaysAndLawnEdges = () => {
    paintWalkways();
    // Lawn edge: darken grass within LAWN_EDGE_M outside each walkway's edge stones (once per pixel).
    const strokeAll = (extra) => (r) => { for (const w of walkwayPixels) r.strokePolyline(w.points, pavedWidth(w, extra), () => [255, 255, 255]); };
    const outline = maskOf(ground.width, ground.height, strokeAll(WALKWAY_EDGE_M));
    const band = maskOf(ground.width, ground.height, strokeAll(WALKWAY_EDGE_M + 2 * LAWN_EDGE_M));
    const d = ground.data;
    for (let p = 0; p < band.length; p += 1) {
      if (!band[p] || outline[p]) continue;
      const i = p * 3;
      if (d[i + 1] > d[i] + 8 && d[i + 1] > d[i + 2] + 8) for (let ch = 0; ch < 3; ch += 1) d[i + ch] *= 0.8;
    }
  };
  // Walkways go over plazas (the A003 lines are surveyed paths, the plaza outlines coarse areas) but
  // under facility surfaces, roads and building curbs.
  groundFeatures.surfaces(paintWalkwaysAndLawnEdges);
  ground.label = ASPHALT;
  for (const polygon of roadZones) ground.fillPolygon(polygon.map((ring) => ring.map(toPixel)), asphalt);
  ground.label = null;
  {
    // Kerb (0.15 m step, ASSUMED) drawn as a thin strip: a 0.3 m light kerb stone on the road edge and
    // the step's shadow as a 0.25 m darker gutter on the asphalt side (pixels inside a road polygon).
    const strokeRings = (width) => (r) => {
      for (const polygon of roadZones) for (const ring of polygon) r.strokePolyline([...ring, ring[0]].map(toPixel), width, () => [255, 255, 255]);
    };
    const kerb = maskOf(ground.width, ground.height, strokeRings(metres(0.3) * PX));
    const gutter = maskOf(ground.width, ground.height, strokeRings(metres(0.3 + 0.5) * PX));
    const road = maskOf(ground.width, ground.height, (r) => {
      for (const polygon of roadZones) r.fillPolygon(polygon.map((ring) => ring.map(toPixel)), () => [255, 255, 255]);
    });
    const d = ground.data;
    for (let p = 0; p < kerb.length; p += 1) {
      const i = p * 3;
      if (kerb[p]) {
        const k = 0.96 + hashNoise(p % ground.width, Math.floor(p / ground.width), 11) * 0.06;
        d[i] = 184 * k; d[i + 1] = 182 * k; d[i + 2] = 174 * k;
        ground.labels[p] = PAVING;
      } else if (gutter[p] && road[p]) {
        for (let ch = 0; ch < 3; ch += 1) d[i + ch] *= 0.72;
      }
    }
  }
  groundFeatures.overRoads();
  ground.label = LOT;
  for (const lot of offCampusLots) {
    ground.fillPolygon([lot.map(toPixel)], (x, y) => {
      const k = 0.94 + hashNoise(x, y, 6) * 0.08;
      return [150 * k, 148 * k, 141 * k];
    });
  }
  ground.label = null;
  {
    // Off-campus lots cover the street-side walkways; repaint those inside the lots only.
    const lots = maskOf(ground.width, ground.height, (r) => {
      for (const lot of offCampusLots) r.fillPolygon([lot.map(toPixel)], () => [255, 255, 255]);
    });
    paintWalkways((x, y) => lots[y * ground.width + x] === 1);
  }
  const white = () => [255, 255, 255];
  ground.label = ASPHALT;
  const arterial = paintArterials({
    ground,
    toPixel,
    lines: groundFeatures.lines,
    block: maskOf(ground.width, ground.height, (r) => {
      for (const w of walkwayPixels) r.strokePolyline(w.points, pavedWidth(w, WALKWAY_EDGE_M), white);
      for (const lot of offCampusLots) r.fillPolygon([lot.map(toPixel)], white);
      for (const building of [...selectableBuildings, ...campusBuildings]) {
        for (const part of building.parts) r.fillPolygon([part.outer.map(toPixel)], white);
      }
    }),
    roadZoneMask: maskOf(ground.width, ground.height, (r) => {
      for (const polygon of roadZones) r.fillPolygon(polygon.map((ring) => ring.map(toPixel)), white);
    }),
    asphalt,
    crosswalks,
  });
  ground.label = PAVING;
  console.log(`arterial: ${arterial.strips} traced strips (${arterial.quads} quads), ${arterial.crosswalks.length} OSM crossings added to Crosswalks`);
  for (const building of [...selectableBuildings, ...campusBuildings]) {
    for (const part of building.parts) {
      ground.strokePolyline([...part.outer, part.outer[0]].map(toPixel), metres(2.2) * PX, () => [182, 178, 170]);
    }
  }
  ground.label = null;
  const photo = composeOrthoGround({
    ground,
    classes: ground.labels,
    ortho: inputs.ortho,
    calibration: inputs.orthoCalibration,
    toPixel,
    pixelCentre: pixelToModel,
    metresPerPixel: M_PER_PX,
    unitsPerPixel: 1 / PX,
    buildings: [...selectableBuildings, ...campusBuildings],
    crowns: Object.values(treeInstances).flat(),
  });
  const share = (key) => `${(photo.shares[key] * 100).toFixed(1)} %`;
  console.log(
    `ground: VWorld z19 orthophoto ${photo.width}x${photo.height} at ${photo.metresPerPixel.toFixed(4)} m/px; procedural fill under buildings ${share("building")}, ` +
    `open-ground tree crowns ${share("crown")}, street trees over paving ${share("street")}; photo canopy kept in groves ${share("grove")}; ` +
    `relit shadows ${share("shadow")}; ` +
    `white balance ${inputs.orthoCalibration.gains.map((g) => g.toFixed(3)).join("/")} from ${inputs.orthoCalibration.samples} neutral pixels, ` +
    `albedo lift 1/${inputs.orthoCalibration.gamma} (estimated)`,
  );
  // The pack step re-encodes it as WebP (EXT_texture_webp); q92 keeps that second lossy step the dominant one.
  const groundTexture = glb.addTexture(await jpeg(encodePng(ground.width, ground.height, 3, ground.data), 92), "image/jpeg", { repeat: false });
  const groundMaterial = glb.addMaterial({
    name: "Ground",
    pbrMetallicRoughness: { baseColorTexture: { index: groundTexture }, metallicFactor: 0, roughnessFactor: 1 },
  });
  glb.json.asset.extras = {
    ...glb.json.asset.extras,
    aoGroundLayout: AO_GROUND_LAYOUT,
    aoGroundSize: AO_GROUND_SIZE,
    orthophoto: {
      source: inputs.ortho.meta.source,
      attribution: inputs.ortho.meta.attribution,
      licence: inputs.ortho.meta.licence,
      tiles: `z${inputs.ortho.meta.zoom} x ${inputs.ortho.meta.x0}-${inputs.ortho.meta.x1}, y ${inputs.ortho.meta.y0}-${inputs.ortho.meta.y1}, fetched ${inputs.ortho.meta.tilesFetched}`,
      groundMetresPerPixel: Number(M_PER_PX.toFixed(4)),
      note: "ground albedo, roof colours and solar panels are estimates derived from imagery, not measurements",
    },
  };
  if (existsSync(AO_GROUND)) {
    const png = readFileSync(AO_GROUND);
    const bakedFor = pngLayoutTag(png);
    if (bakedFor === AO_GROUND_LAYOUT) {
      glb.json.materials[groundMaterial].occlusionTexture = { index: glb.addTexture(png, "image/png", { repeat: false }), texCoord: 1 };
      console.log(`ground AO: ${path.basename(AO_GROUND)} (${png.length} B) attached as occlusionTexture`);
    } else {
      console.warn(`ground AO: ${path.basename(AO_GROUND)} was baked for ${bakedFor ?? "(none)"}, this build is ${AO_GROUND_LAYOUT}; left out. Re-bake: bun scripts/campus-model/bake/bake-ao.mjs --planar`);
    }
  } else {
    console.warn(`ground AO: ${path.basename(AO_GROUND)} missing; see scripts/campus-model/bake/README.md`);
  }

  // ---- terrain (chunked so raycasts stay cheap)
  const topographyChildren = [];
  for (let cz = EXTENT.minZ; cz < EXTENT.maxZ; cz += CHUNK) {
    for (let cx = EXTENT.minX; cx < EXTENT.maxX; cx += CHUNK) {
      const data = new MeshData();
      const xs = [];
      const zs = [];
      for (let x = cx; x < Math.min(cx + CHUNK, EXTENT.maxX) + 1e-6; x += STEP) xs.push(Math.min(x, EXTENT.maxX));
      for (let z = cz; z < Math.min(cz + CHUNK, EXTENT.maxZ) + 1e-6; z += STEP) zs.push(Math.min(z, EXTENT.maxZ));
      if (xs.at(-1) < Math.min(cx + CHUNK, EXTENT.maxX)) xs.push(Math.min(cx + CHUNK, EXTENT.maxX));
      if (zs.at(-1) < Math.min(cz + CHUNK, EXTENT.maxZ)) zs.push(Math.min(cz + CHUNK, EXTENT.maxZ));
      for (const z of zs) {
        for (const x of xs) {
          const nx = heightAt(x - 1, z) - heightAt(x + 1, z);
          const nz = heightAt(x, z - 1) - heightAt(x, z + 1);
          const length = Math.hypot(nx, 2, nz);
          data.vertex([x, heightAt(x, z), z], [nx / length, 2 / length, nz / length], [(x - EXTENT.minX) / WIDTH, (z - EXTENT.minZ) / DEPTH]);
        }
      }
      for (let j = 0; j + 1 < zs.length; j += 1) {
        for (let i = 0; i + 1 < xs.length; i += 1) {
          const a = j * xs.length + i;
          const b = a + 1;
          const c = a + xs.length;
          const d = c + 1;
          data.indices.push(a, c, b, b, c, d);
        }
      }
      const name = `Topography_${topographyChildren.length}`;
      const primitive = data.toPrimitive(groundMaterial);
      const mesh = glb.addMesh(name, [primitive]);
      // GlbBuilder.addMesh writes TEXCOORD_0 only; the planar AO coordinate is added here.
      const uv1 = new Float32Array((primitive.positions.length / 3) * 2);
      for (let v = 0; v < uv1.length / 2; v += 1) {
        uv1[v * 2] = (primitive.positions[v * 3] - EXTENT.minX) / WIDTH;
        uv1[v * 2 + 1] = (primitive.positions[v * 3 + 2] - EXTENT.minZ) / DEPTH;
      }
      glb.json.meshes[mesh].primitives[0].attributes.TEXCOORD_1 = glb.addAccessor(uv1, "VEC2");
      topographyChildren.push(glb.addNode({ name, mesh }));
    }
  }
  glb.addNode({ name: "Topography", children: topographyChildren }, { root: true });

  // ---- crosswalk stripes
  {
    const stripes = new MeshData({ uvs: false });
    const lift = metres(0.08);
    for (const ring of [...crosswalks, ...arterial.crosswalks]) {
      if (ring.length < 4) continue;
      const [p0, p1, p2] = ring;
      const e0 = [p1[0] - p0[0], p1[1] - p0[1]];
      const e1 = [p2[0] - p1[0], p2[1] - p1[1]];
      // stripes run along the short side (traffic direction) and repeat along the long side
      const [along, across, origin] = Math.hypot(...e0) >= Math.hypot(...e1) ? [e0, e1, p0] : [e1, [-e0[0], -e0[1]], p1];
      const length = Math.hypot(...along);
      const ux = along[0] / length;
      const uz = along[1] / length;
      const stripe = metres(0.5);
      for (let s = metres(0.25); s + stripe <= length; s += metres(1)) {
        const a = [origin[0] + ux * s, origin[1] + uz * s];
        const b = [a[0] + ux * stripe, a[1] + uz * stripe];
        const corners = [a, b, [b[0] + across[0], b[1] + across[1]], [a[0] + across[0], a[1] + across[1]]];
        const area = ringArea(corners);
        const ordered = area > 0 ? corners : [...corners].reverse();
        const base = stripes.vertexCount;
        ordered.forEach(([x, z]) => stripes.vertex([x, heightAt(x, z) + lift, z], [0, 1, 0]));
        stripes.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    const mesh = glb.addMesh("Crosswalks", [stripes.toPrimitive(markingMaterial)]);
    glb.addNode({ name: "Crosswalks", mesh }, { root: true });
  }
}

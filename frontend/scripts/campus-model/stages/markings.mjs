// Road markings stage: the paint the orthophoto shows, as one decal mesh on the Topography surface.
//
// Input: data/photo/markings.geojson (WGS84), the photo detection of NGII 2025 orthophoto sheet 34702020 (0.25 m; the
// same photograph as the VWorld z19 ground texture, registered to it within 5 mm): zebra bars grouped per crossing,
// stop lines, lane, centre and edge lines, arrows, text, hatching and parking lines, each with its colour and
// `estimated` (pieces the detection inferred between two visible ones, e.g. a bar hidden by a car).
//
// Geometry, in the model frame, lifted LIFT_M over the terrain triangles it lies on (CityModel adds a polygon offset):
//   - zebra bars: every detected bar at its own centre and length, along its crossing's mean axis, ZEBRA_BAR_M wide.
//     The bar width is below the photo's resolution, so it comes from the bar profiles of 25 crossings folded over
//     the 0.903 m period: the second harmonic is negative in 73-92 % of them (bars wider than the gaps), giving a
//     duty of 0.52-0.58, i.e. 0.47-0.52 m bars (ESTIMATED 0.50 m; 0.40 m gaps). Crossings whose bars are fused to a
//     painted frame come as one outline polygon (`fused_frame`) and are drawn as that polygon;
//   - lines at LINE_WIDTH_M (stop lines at their detected width within STOP_LINE_M); `double` yellow centre lines as
//     two lines DOUBLE_OFFSET_M either side of the detected centreline (ASSUMED layout: the photo blurs the gap);
//     `dotted` guide lines as `dots` squares evenly spaced between the first and the last dot;
//   - arrows, text, hatching and parking outlines as the detected polygons ("painted symbol here": the detection's
//     kind labels are often wrong, the painted shape is what is drawn);
//   - kind `other` is left out: on a sample of 54 of them about half were car roofs, kerbs, fences and roof edges.
// Candidates the photo or the surveyed ground contradicts are left out as well: a centroid inside a modelled building
// or an A003 sidewalk, polygon surroundings that are mostly vegetation, a cast shadow on the side away from the
// photo's sun (azimuth 92.5 deg, elevation 62 deg; cars and walls cast one, paint does not), and, for the line kinds
// the detection's hand check found least reliable (ROAD_CHECKED: 57-80 % on paint), a centroid off the road (road
// zones, OSM parking, or within ARTERIAL_REACH_M of an OSM arterial or connector).
//
// Crossings: OSM crossing ways (data/osm-ground.json) and the digitised crosswalk polygons
// (docs/assets/data/crosswalks_wgs84.geojson) never draw stripes of their own. One that matches a detected zebra is
// drawn from the photo alone (its offset is logged). One without a detected zebra whose area the photo shows under
// canopy (the ground stage's street-tree test) gets estimated bars (ZEBRA_PERIOD_M, ZEBRA_BAR_M); under a cast
// shadow alone the relit photo keeps its own faint paint, and on open asphalt there is none, so those stay undrawn.
//
// Material: one Road_Marking material whose two-colour palette texture (white, yellow) is both the base colour and the
// emissive map, so the dashboard's night ramp (CityModel lights every emissiveMap at night) makes the paint glow
// faintly in its own colour; KHR_materials_emissive_strength (NIGHT_GLOW) caps it. One mesh, one draw call.
// The ground stage suppresses the photo's own paint under every marking drawn here, estimated ones included (`paint`,
// lib/orthoGround.mjs), so wherever the model draws paint the photo shows none.
// Everything here is derived from imagery; widths and estimated crossings are estimates, not survey data.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ShapeUtils, Vector2 } from "three";
import { EXTENT, SCENE_UNITS_PER_METRE, geoToModel, metres } from "../lib/frame.mjs";
import { pointInRing, ringArea, segmentDistance } from "../lib/geometry.mjs";
import { sampleOrtho } from "../lib/ortho.mjs";
import { VEG_EXG, excessGreen, shadowWeight } from "../lib/orthoGround.mjs";
import { encodePng } from "../lib/png.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARKINGS = path.join(HERE, "..", "data", "photo", "markings.geojson");
const GROUND_FEATURES = path.join(HERE, "..", "data", "osm-ground.json");
const CROSSWALKS = path.resolve(HERE, "../../../..", "docs", "assets", "data", "crosswalks_wgs84.geojson");

const ZEBRA_PERIOD_M = 0.903;
const ZEBRA_BAR_M = 0.5;
const LINE_WIDTH_M = 0.15;
const STOP_LINE_M = [0.3, 0.6];
const DOUBLE_OFFSET_M = 0.15;
const LINE_KINDS = new Set(["lane_line_dashed", "lane_line_solid", "edge_line", "centre_line_yellow", "stop_line", "parking_line"]);
const POLYGON_KINDS = new Set(["arrow", "text", "hatch", "parking_line"]);
// Packed positions are 14-bit over the campus (about 4.9 cm steps), terrain and markings each rounded on their own.
const LIFT_M = 0.04;
// Photo paint blurs about one pixel past the detected edge; the suppression mask reaches this far beyond each marking.
export const SUPPRESS_MARGIN_M = 0.3;

const SHADOW_AZIMUTH_DEG = 272.5;
const SHADOW_REACH_M = [0.3, 0.6, 0.9];
const RAISED_SHADOW_SHARE = 0.4;
const RAISED_SHADOW_EXCESS = 0.25;
const VEG_RING_M = [0.5, 0.9];
const VEG_RING_SHARE = 0.5;
const ROAD_CHECKED = new Set(["lane_line_solid", "edge_line", "centre_line_yellow"]);
const ARTERIAL_REACH_M = 12;
const BICYCLE_LANE = "A0033327";
const WALKWAYS = path.resolve(HERE, "../../../..", "docs", "assets", "data", "walkways_wgs84.geojson");

// Estimated crossings: painted width of the detected arterial zebras (median 4.57 m, REG), overrun of the digitised
// polygons past their painted bars (median 1.45 m, REG), and REG's OSM crossing translation (photo minus OSM).
const CROSSING_WIDTH_M = 4.57;
const POLYGON_OVERRUN_M = 1.45;
const OSM_SHIFT_M = { east: -0.905, north: 0.315 };
const OCCLUDED_SHARE = 0.5;
const MATCH_ANGLE_DEG = 25;
const MATCH_REACH_M = 3;

const CONFORM_TOLERANCE_M = 0.005;
const PALETTE_SRGB = { white: [226, 226, 220], yellow: [228, 172, 52] };
const PALETTE_U = { white: 0.25, yellow: 0.75 };
const NIGHT_GLOW = 0.18;

const UNIT = SCENE_UNITS_PER_METRE;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (v) => {
  const length = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / length, v[1] / length];
};
const toModel = (coords) => coords.map(([lon, lat]) => geoToModel(lon, lat));
const openRing = (ring) => {
  const out = [];
  for (const p of ring) if (!out.length || Math.hypot(p[0] - out.at(-1)[0], p[1] - out.at(-1)[1]) > 1e-4) out.push(p);
  if (out.length > 1 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) <= 1e-4) out.pop();
  return out;
};
const centroidOf = (points) => points.reduce((acc, p) => [acc[0] + p[0] / points.length, acc[1] + p[1] / points.length], [0, 0]);
const rect = (centre, along, across, halfLength, halfWidth) => [
  [centre[0] - along[0] * halfLength - across[0] * halfWidth, centre[1] - along[1] * halfLength - across[1] * halfWidth],
  [centre[0] + along[0] * halfLength - across[0] * halfWidth, centre[1] + along[1] * halfLength - across[1] * halfWidth],
  [centre[0] + along[0] * halfLength + across[0] * halfWidth, centre[1] + along[1] * halfLength + across[1] * halfWidth],
  [centre[0] - along[0] * halfLength + across[0] * halfWidth, centre[1] - along[1] * halfLength + across[1] * halfWidth],
];

// Outline of a polyline stroked `halfWidth` (model units) either side, mitred (limit 2).
function strokeRing(line, halfWidth) {
  const points = openRing(line);
  if (points.length < 2) return null;
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i += 1) {
    const before = i > 0 ? unit(sub(points[i], points[i - 1])) : null;
    const after = i + 1 < points.length ? unit(sub(points[i + 1], points[i])) : null;
    const tangent = before && after ? unit([before[0] + after[0], before[1] + after[1]]) : before ?? after;
    const normal = [-tangent[1], tangent[0]];
    const reference = after ?? before;
    const scale = 1 / Math.max(0.5, dot(normal, [-reference[1], reference[0]]));
    left.push([points[i][0] + normal[0] * halfWidth * scale, points[i][1] + normal[1] * halfWidth * scale]);
    right.push([points[i][0] - normal[0] * halfWidth * scale, points[i][1] - normal[1] * halfWidth * scale]);
  }
  return [...left, ...right.reverse()];
}

// Polyline offset sideways by `offset` (model units, positive to the left).
function offsetLine(line, offset) {
  const points = openRing(line);
  return points.map((p, i) => {
    const before = i > 0 ? unit(sub(p, points[i - 1])) : null;
    const after = i + 1 < points.length ? unit(sub(points[i + 1], p)) : null;
    const tangent = before && after ? unit([before[0] + after[0], before[1] + after[1]]) : before ?? after;
    return [p[0] - tangent[1] * offset, p[1] + tangent[0] * offset];
  });
}

// Minimum-area oriented rectangle of a ring: centre, unit axes (long first) and half sizes in model units.
function orientedBox(ring) {
  let best = null;
  for (let a = 0; a < 180; a += 0.5) {
    const u = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
    const v = [-u[1], u[0]];
    const s = ring.map((p) => dot(p, u));
    const t = ring.map((p) => dot(p, v));
    const [s0, s1, t0, t1] = [Math.min(...s), Math.max(...s), Math.min(...t), Math.max(...t)];
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area) best = { area, u, v, s0, s1, t0, t1 };
  }
  const { u, v, s0, s1, t0, t1 } = best;
  const centre = [((s0 + s1) / 2) * u[0] + ((t0 + t1) / 2) * v[0], ((s0 + s1) / 2) * u[1] + ((t0 + t1) / 2) * v[1]];
  return s1 - s0 >= t1 - t0
    ? { centre, long: u, short: v, halfLong: (s1 - s0) / 2, halfShort: (t1 - t0) / 2 }
    : { centre, long: v, short: u, halfLong: (t1 - t0) / 2, halfShort: (s1 - s0) / 2 };
}

// ---------------------------------------------------------------- photo checks
function photoChecks(ortho, buildingRings) {
  const rgb = [0, 0, 0];
  const at = (p) => sampleOrtho(ortho, ortho.col(p[0]), ortho.row(p[1]), rgb);
  const shadowDir = [Math.sin((SHADOW_AZIMUTH_DEG * Math.PI) / 180), -Math.cos((SHADOW_AZIMUTH_DEG * Math.PI) / 180)];
  const inside = (p, rings) => pointInRing(p, rings[0]) && !rings.slice(1).some((hole) => pointInRing(p, hole));
  // Sample points inside a piece: a 0.2 m grid, or its vertices when the grid misses a thin piece.
  const interior = (rings) => {
    const outer = rings[0];
    const xs = outer.map((p) => p[0]);
    const zs = outer.map((p) => p[1]);
    const step = metres(0.2);
    const points = [];
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
      for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) if (inside([x, z], rings)) points.push([x, z]);
    }
    return points.length >= 3 ? points : [...outer, centroidOf(outer)];
  };
  // Points VEG_RING_M outside the outer ring, every 0.25 m along it.
  const ring = (outer) => {
    const sign = ringArea(outer) > 0 ? 1 : -1;
    const points = [];
    for (let i = 0; i < outer.length; i += 1) {
      const a = outer[i];
      const b = outer[(i + 1) % outer.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-6) continue;
      const e = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const out = [e[1] * sign, -e[0] * sign];
      for (let s = 0; s < length; s += metres(0.25)) {
        for (const d of VEG_RING_M) points.push([a[0] + e[0] * s + out[0] * metres(d), a[1] + e[1] * s + out[1] * metres(d)]);
      }
    }
    return points;
  };
  const share = (points, test) => (points.length ? points.filter((p) => test(at(p))).length / points.length : 0);
  return {
    inBuilding: (p) => buildingRings.some((r) => pointInRing(p, r)),
    vegetated: (rings) => share(ring(rings[0]), ([r, g, b]) => excessGreen(r, g, b) > VEG_EXG) >= VEG_RING_SHARE,
    // Cast-shadow share just beside the piece on its shadow side, and on its sun side.
    raised(rings) {
      const points = interior(rings);
      const side = (sign) => {
        const shifted = [];
        for (const reach of SHADOW_REACH_M) {
          for (const p of points) {
            const q = [p[0] + shadowDir[0] * metres(reach) * sign, p[1] + shadowDir[1] * metres(reach) * sign];
            if (!inside(q, rings)) shifted.push(q);
          }
        }
        return share(shifted, ([r, g, b]) => shadowWeight(r, g, b) >= 0.3);
      };
      const shadow = side(1);
      return shadow >= RAISED_SHADOW_SHARE && shadow - side(-1) >= RAISED_SHADOW_EXCESS;
    },
    // Share of a set of points the photo shows under canopy.
    occluded: (points) => share(points, ([r, g, b]) => excessGreen(r, g, b) > VEG_EXG),
  };
}

// Surveyed ground the markings must agree with: A003 sidewalks (not bicycle lanes) and the road surfaces.
async function groundTruth(inputs) {
  const walkways = JSON.parse(await Bun.file(WALKWAYS).text()).features
    .filter((f) => f.properties.scls !== BICYCLE_LANE)
    .map((f) => (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates)
      .filter((line) => line.length >= 4 && line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1])
      .map(toModel))
    .filter((rings) => rings.length);
  const ground = JSON.parse(await Bun.file(GROUND_FEATURES).text());
  const roadLines = ground.osm.lines.filter((l) => l.kind === "arterial" || l.kind === "connector").map((l) => toModel(l.line));
  const parking = ground.osm.features.filter((f) => f.kind === "parking").map((f) => f.rings.map(toModel));
  const inPolygon = (p, rings) => pointInRing(p, rings[0]) && !rings.slice(1).some((hole) => pointInRing(p, hole));
  const evenOdd = (p, rings) => rings.filter((ring) => pointInRing(p, ring)).length % 2 === 1;
  return {
    onSidewalk: (p) => walkways.some((rings) => evenOdd(p, rings)),
    onRoad: (p) => inputs.roadZones.some((rings) => inPolygon(p, rings)) || parking.some((rings) => inPolygon(p, rings)) ||
      roadLines.some((line) => line.some((q, i) => i > 0 && segmentDistance(p, line[i - 1], q) <= metres(ARTERIAL_REACH_M))),
  };
}

// ---------------------------------------------------------------- loading
export async function loadMarkings({ inputs, buildings }) {
  const data = JSON.parse(await Bun.file(MARKINGS).text());
  const buildingRings = buildings.flatMap((b) => b.parts.map((part) => part.outer));
  const checks = photoChecks(inputs.ortho, buildingRings);
  const truth = await groundTruth(inputs);
  const pieces = [];
  const log = { drawn: {}, estimated: {}, dropped: { other: 0, building: 0, sidewalk: 0, offRoad: 0, vegetation: 0, shadow: 0 } };
  const count = (table, kind) => { table[kind] = (table[kind] ?? 0) + 1; };

  // ---- zebra bars, per crossing (a fused frame is drawn as its outline polygon)
  const groups = new Map();
  const zebras = [];
  for (const feature of data.features) {
    const p = feature.properties;
    if (p.kind !== "zebra_bar") continue;
    if (p.fused_frame) {
      const rings = feature.geometry.coordinates.map((ring) => openRing(toModel(ring)));
      pieces.push({ rings, colour: "white", kind: "zebra_bar", estimated: false });
      count(log.drawn, "zebra frame outline");
      const box = orientedBox(rings[0]);
      zebras.push({ id: `${p.crossing_id} frame`, centre: box.centre, axis: box.short, bars: 1, halfLength: box.halfShort, barCentres: [box.centre, ...rings[0]] });
      continue;
    }
    const corners = openRing(toModel(feature.geometry.coordinates[0]));
    const box = orientedBox(corners);
    if (!groups.has(p.crossing_id)) groups.set(p.crossing_id, []);
    groups.get(p.crossing_id).push({ centre: box.centre, axis: box.long, halfLength: box.halfLong, estimated: p.estimated, id: p.id });
  }
  for (const [id, bars] of groups) {
    const reference = bars[0].axis;
    const axis = unit(bars.reduce((acc, bar) => {
      const sign = dot(bar.axis, reference) >= 0 ? 1 : -1;
      return [acc[0] + bar.axis[0] * sign, acc[1] + bar.axis[1] * sign];
    }, [0, 0]));
    const across = [-axis[1], axis[0]];
    const centre = centroidOf(bars.map((b) => b.centre));
    const halfBar = metres(ZEBRA_BAR_M) / 2;
    for (const bar of bars) {
      pieces.push({ rings: [rect(bar.centre, axis, across, bar.halfLength, halfBar)], colour: "white", kind: "zebra_bar", estimated: false });
      count(log.drawn, bar.estimated ? "zebra_bar (inferred inside a detected crossing)" : "zebra_bar");
    }
    zebras.push({
      id, centre, axis, bars: bars.length,
      halfLength: Math.max(...bars.map((b) => Math.abs(dot(sub(b.centre, centre), axis)) + b.halfLength)),
      barCentres: bars.map((b) => b.centre),
    });
  }

  // ---- lines and polygons
  for (const feature of data.features) {
    const p = feature.properties;
    if (p.kind === "zebra_bar") continue;
    if (p.kind === "other") {
      log.dropped.other += 1;
      continue;
    }
    const { type, coordinates } = feature.geometry;
    let shapes;
    if (type === "LineString" && p.dotted) {
      const line = toModel(coordinates);
      const [a, b] = [line[0], line.at(-1)];
      const along = unit(sub(b, a));
      const across = [-along[1], along[0]];
      const half = metres(p.width_m) / 2;
      shapes = Array.from({ length: p.dots }, (_, k) => {
        const t = p.dots > 1 ? k / (p.dots - 1) : 0.5;
        return [rect([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], along, across, half, half)];
      });
    } else if (type === "LineString" && LINE_KINDS.has(p.kind)) {
      const line = toModel(coordinates);
      if (p.double) {
        const half = metres(LINE_WIDTH_M) / 2;
        shapes = [offsetLine(line, metres(DOUBLE_OFFSET_M)), offsetLine(line, -metres(DOUBLE_OFFSET_M))].map((l) => strokeRing(l, half));
      } else {
        const width = p.kind === "stop_line" ? Math.min(STOP_LINE_M[1], Math.max(STOP_LINE_M[0], p.width_m)) : LINE_WIDTH_M;
        shapes = [strokeRing(line, metres(width) / 2)];
      }
      shapes = shapes.filter(Boolean).map((ring) => [ring]);
    } else if (type === "Polygon" && POLYGON_KINDS.has(p.kind)) {
      shapes = [coordinates.map((ring) => openRing(toModel(ring))).filter((ring) => ring.length >= 3)];
    } else {
      throw new Error(`markings.geojson: ${p.id} has kind ${p.kind} with geometry ${type}, which this stage does not draw`);
    }
    const first = shapes[0];
    const centre = type === "LineString" ? centroidOf(toModel(coordinates)) : centroidOf(first[0]);
    const drop = checks.inBuilding(centre) ? "building"
      : truth.onSidewalk(centre) ? "sidewalk"
        : ROAD_CHECKED.has(p.kind) && !truth.onRoad(centre) ? "offRoad"
          : type === "Polygon" && checks.vegetated(first) ? "vegetation"
            : shapes.some((rings) => checks.raised(rings)) ? "shadow"
              : null;
    if (drop) {
      log.dropped[drop] += 1;
      continue;
    }
    for (const rings of shapes) pieces.push({ rings, colour: p.colour, kind: p.kind, estimated: Boolean(p.estimated) });
    count(p.estimated ? log.estimated : log.drawn, p.kind);
  }

  // ---- crossings the photo cannot show
  const zebraMatch = (inRegion) => zebras.find((z) => z.barCentres.some(inRegion));
  const crossings = [];
  // Bars stacked along `walk` (unit) over +-halfWalk around `centre`, each 2 x halfBar long across it (model units).
  const addEstimatedBars = (centre, walk, halfWalk, halfBar) => {
    const along = [-walk[1], walk[0]];
    const period = metres(ZEBRA_PERIOD_M);
    const bar = metres(ZEBRA_BAR_M);
    const n = Math.floor((2 * halfWalk - bar) / period) + 1;
    if (n < 2) return 0;
    const first = -((n - 1) * period) / 2;
    for (let k = 0; k < n; k += 1) {
      const c = [centre[0] + walk[0] * (first + k * period), centre[1] + walk[1] * (first + k * period)];
      pieces.push({ rings: [rect(c, along, walk, halfBar, bar / 2)], colour: "white", kind: "zebra_bar", estimated: true });
      count(log.estimated, "zebra_bar");
    }
    return n;
  };
  const inExtent = ([x, z]) => x >= EXTENT.minX && x <= EXTENT.maxX && z >= EXTENT.minZ && z <= EXTENT.maxZ;

  const osmLines = JSON.parse(await Bun.file(GROUND_FEATURES).text()).osm.lines.filter((l) => l.kind === "crossing");
  for (const way of osmLines) {
    const line = toModel(way.line);
    const a = line[0];
    const b = line.at(-1);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < metres(2)) continue;
    const walk = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!inExtent(middle)) continue;
    const match = zebras
      .filter((z) => Math.abs(dot(walk, z.axis)) <= Math.sin((MATCH_ANGLE_DEG * Math.PI) / 180))
      .map((z) => {
        const lateral = dot(sub(z.centre, middle), z.axis);
        const along = dot(sub(z.centre, middle), walk);
        return { z, lateral, along };
      })
      .filter(({ z, lateral, along }) => Math.abs(lateral) <= z.halfLength + metres(MATCH_REACH_M) && Math.abs(along) <= length / 2 + metres(MATCH_REACH_M))
      .sort((p, q) => Math.abs(p.lateral) - Math.abs(q.lateral))[0];
    if (match) {
      crossings.push(`${way.id}: photo zebra ${match.z.id} (${match.z.bars} bars), OSM way ${(match.lateral / UNIT).toFixed(2)} m off its centreline`);
      continue;
    }
    const shift = [metres(OSM_SHIFT_M.east), -metres(OSM_SHIFT_M.north)];
    const centre = [middle[0] + shift[0], middle[1] + shift[1]];
    const across = [-walk[1], walk[0]];
    const band = [];
    for (let s = -length / 2; s <= length / 2; s += metres(0.5)) {
      for (let t = -metres(CROSSING_WIDTH_M) / 2; t <= metres(CROSSING_WIDTH_M) / 2; t += metres(0.5)) band.push([centre[0] + walk[0] * s + across[0] * t, centre[1] + walk[1] * s + across[1] * t]);
    }
    const occluded = checks.occluded(band);
    if (occluded < OCCLUDED_SHARE) {
      crossings.push(`${way.id}: no zebra detected, ${(occluded * 100).toFixed(0)} % under canopy (open asphalt or cast shadow), not drawn`);
      continue;
    }
    const bars = addEstimatedBars(centre, walk, length / 2 - metres(0.3), metres(CROSSING_WIDTH_M) / 2);
    crossings.push(`${way.id}: no zebra visible, ${(occluded * 100).toFixed(0)} % under canopy, ${bars} estimated bars`);
  }

  const crosswalks = JSON.parse(await Bun.file(CROSSWALKS).text()).features;
  for (const feature of crosswalks) {
    const ring = openRing(toModel(feature.geometry.coordinates[0]));
    const id = feature.properties.id;
    if (!inExtent(centroidOf(ring))) continue;
    const match = zebraMatch((c) => pointInRing(c, ring) || ring.some((p, i) => segmentDistance(c, p, ring[(i + 1) % ring.length]) <= metres(1.5)));
    if (match) {
      crossings.push(`${id}: photo zebra ${match.id} (${match.bars} bars)`);
      continue;
    }
    const box = orientedBox(ring);
    const points = [];
    for (let s = -box.halfLong; s <= box.halfLong; s += metres(0.5)) {
      for (let t = -box.halfShort; t <= box.halfShort; t += metres(0.5)) {
        const q = [box.centre[0] + box.long[0] * s + box.short[0] * t, box.centre[1] + box.long[1] * s + box.short[1] * t];
        if (pointInRing(q, ring)) points.push(q);
      }
    }
    const occluded = checks.occluded(points);
    if (occluded < OCCLUDED_SHARE) {
      crossings.push(`${id}: no zebra detected, ${(occluded * 100).toFixed(0)} % under canopy (open asphalt or cast shadow), not drawn`);
      continue;
    }
    const halfWalk = Math.max(box.halfLong - metres(POLYGON_OVERRUN_M), Math.min(box.halfLong, metres(1.5)));
    const bars = addEstimatedBars(box.centre, box.long, halfWalk, box.halfShort);
    crossings.push(`${id}: no zebra visible, ${(occluded * 100).toFixed(0)} % under canopy, ${bars} estimated bars`);
  }

  // Paint to suppress in the photo: under every piece drawn.
  const paint = pieces.map((piece) => piece.rings[0]);
  return { pieces, paint, zebras, crossings, log, source: data.properties?.source ?? "data/photo/markings.geojson" };
}

// ---------------------------------------------------------------- mesh
// Splits polygon `poly` (convex) by the line f(p) = c. Edge crossings are computed from the edge's lexicographically
// first endpoint, so two pieces sharing an edge get bit-identical vertices.
function splitConvex(poly, f, c) {
  const below = [];
  const above = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p) - c;
    const fq = f(q) - c;
    if (fp <= 0) below.push(p);
    if (fp >= 0) above.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const [s, e] = p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? [p, q] : [q, p];
      const t = (c - f(s)) / (f(e) - f(s));
      const x = [s[0] + (e[0] - s[0]) * t, s[1] + (e[1] - s[1]) * t];
      below.push(x);
      above.push(x);
    }
  }
  return [below, above].filter((piece) => piece.length >= 3 && Math.abs(ringArea(piece)) > 1e-10);
}

// Triangles (in [x, z]) of `tri` lying each inside one terrain triangle: unsplit when the flat triangle stays within
// CONFORM_TOLERANCE_M of the terrain, else split along the grid lines and diagonals it crosses.
function conform(tri, surface) {
  const { step, x0, z0 } = surface.grid;
  const xs = tri.map((p) => p[0]);
  const zs = tri.map((p) => p[1]);
  const ds = tri.map((p) => p[0] + p[1]);
  const lines = (lo, hi, origin) => {
    const out = [];
    for (let v = origin + Math.ceil((lo - origin) / step) * step; v < hi; v += step) if (v > lo) out.push(v);
    return out;
  };
  const vertical = lines(Math.min(...xs), Math.max(...xs), x0);
  const horizontal = lines(Math.min(...zs), Math.max(...zs), z0);
  const diagonal = lines(Math.min(...ds), Math.max(...ds), x0 + z0);
  if (!vertical.length && !horizontal.length && !diagonal.length) return [tri];
  // Deviation of the flat triangle from the terrain at its crease crossings and the grid vertices inside it.
  const h = tri.map((p) => surface.height(p[0], p[1]));
  const det = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]);
  const flat = ([x, z]) => {
    const l1 = ((x - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (z - tri[0][1])) / det;
    const l2 = ((tri[1][0] - tri[0][0]) * (z - tri[0][1]) - (x - tri[0][0]) * (tri[1][1] - tri[0][1])) / det;
    return h[0] + (h[1] - h[0]) * l1 + (h[2] - h[0]) * l2;
  };
  const tests = [];
  for (let i = 0; i < 3; i += 1) {
    const p = tri[i];
    const q = tri[(i + 1) % 3];
    for (const [values, f] of [[vertical, (r) => r[0]], [horizontal, (r) => r[1]], [diagonal, (r) => r[0] + r[1]]]) {
      for (const c of values) {
        const fp = f(p) - c;
        const fq = f(q) - c;
        if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) tests.push([p[0] + (q[0] - p[0]) * (fp / (fp - fq)), p[1] + (q[1] - p[1]) * (fp / (fp - fq))]);
      }
    }
  }
  for (const x of vertical) for (const z of horizontal) if (pointInRing([x, z], tri)) tests.push([x, z]);
  const tolerance = metres(CONFORM_TOLERANCE_M);
  if (tests.every((q) => Math.abs(flat(q) - surface.height(q[0], q[1])) <= tolerance)) return [tri];
  let pieces = [tri];
  for (const x of vertical) pieces = pieces.flatMap((piece) => splitConvex(piece, (r) => r[0], x));
  for (const z of horizontal) pieces = pieces.flatMap((piece) => splitConvex(piece, (r) => r[1], z));
  for (const d of diagonal) pieces = pieces.flatMap((piece) => splitConvex(piece, (r) => r[0] + r[1], d));
  return pieces.flatMap((piece) => piece.slice(2).map((_, k) => [piece[0], piece[k + 1], piece[k + 2]]));
}

export function buildMarkings({ glb, markings, surface }) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const index = new Map();
  const lift = metres(LIFT_M);
  const vertex = ([x, z], colour) => {
    const key = `${Math.round(x * 1e5)},${Math.round(z * 1e5)},${colour}`;
    let i = index.get(key);
    if (i === undefined) {
      i = positions.length / 3;
      index.set(key, i);
      positions.push(x, surface.height(x, z) + lift, z);
      normals.push(...surface.normal(x, z));
      uvs.push(PALETTE_U[colour], 0.5);
    }
    return i;
  };
  let source = 0;
  for (const piece of markings.pieces) {
    const [outer, ...holes] = piece.rings;
    const contour = outer.map(([x, z]) => new Vector2(x, z));
    const holeVectors = holes.map((ring) => ring.map(([x, z]) => new Vector2(x, z)));
    const all = [...outer, ...holes.flat()];
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, holeVectors)) {
      source += 1;
      for (const tri of conform([all[a], all[b], all[c]], surface)) {
        // Upward face (+y): the (x, z) cross product of the edges must be negative.
        const cross = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
        if (Math.abs(cross) < 1e-10) continue;
        const ordered = cross < 0 ? tri : [tri[0], tri[2], tri[1]];
        indices.push(...ordered.map((p) => vertex(p, piece.colour)));
      }
    }
  }

  const palette = new Uint8Array(32 * 16 * 3);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 32; x += 1) palette.set(x < 16 ? PALETTE_SRGB.white : PALETTE_SRGB.yellow, (y * 32 + x) * 3);
  }
  const texture = glb.addTexture(encodePng(32, 16, 3, palette), "image/png", { repeat: false });
  glb.extensionsUsed.add("KHR_materials_emissive_strength");
  const material = glb.addMaterial({
    name: "Road_Marking",
    pbrMetallicRoughness: { baseColorTexture: { index: texture }, metallicFactor: 0, roughnessFactor: 0.75 },
    emissiveTexture: { index: texture },
    emissiveFactor: [1, 1, 1],
    // CityModel multiplies its night weight (0..1) by this strength; by day the emissive intensity is 0.
    extensions: { KHR_materials_emissive_strength: { emissiveStrength: NIGHT_GLOW } },
  });
  const mesh = glb.addMesh("Road_Markings", [{
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices,
    material,
  }]);
  const detected = markings.pieces.filter((p) => !p.estimated).length;
  glb.addNode({
    name: "Road_Markings",
    mesh,
    extras: {
      markingsDetected: detected,
      markingsEstimated: markings.pieces.length - detected,
      source: markings.source,
      note: "road markings traced from the orthophoto; bar and line widths and estimated crossings are estimates",
    },
  }, { root: true });
  return { vertices: positions.length / 3, triangles: indices.length / 3, sourceTriangles: source };
}

// One-line build summary of what loadMarkings kept, dropped and estimated.
export function describeMarkings({ log, crossings, zebras }) {
  const list = (table) => Object.entries(table).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  return [
    `markings: ${zebras.length} photo zebras; drawn ${list(log.drawn)}; estimated ${list(log.estimated)}; ` +
      `left out: ${log.dropped.other} 'other', ${log.dropped.building} inside buildings, ${log.dropped.sidewalk} on A003 sidewalks, ` +
      `${log.dropped.offRoad} lines off the road, ${log.dropped.vegetation} in vegetation, ${log.dropped.shadow} casting a shadow (raised objects)`,
    ...crossings.map((line) => `  crossing ${line}`),
  ].join("\n");
}

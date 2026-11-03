// Seed/QA only. Never imported by the campus build.
import { readFileSync } from "node:fs";
// Road markings stage: the paint the orthophoto shows, as one decal mesh on the Topography surface.
//
// Inputs (WGS84), both read from NGII 2025 orthophoto sheet 34702020 (0.25 m; the same photograph as the VWorld z19
// mosaic, registered to it within 5 mm; methods and hand checks in data/photo/README.md):
//   - data/photo/evidence/markings.geojson, the detection pass: zebra bars grouped per crossing, stop lines, lane, centre and
//     edge lines, arrows, text, hatching and parking lines, each with its colour and `estimated` (pieces the detection
//     inferred between two visible ones, e.g. a bar hidden by a car);
//   - data/photo/evidence/markings-extra.geojson, the completion pass: paint the first pass missed (`method` detect: a reviewed
//     paint component; trace: picked or outlined by eye and snapped to the paint) and `properties.corrections`, the
//     markings.geojson ids that are not paint (`delete`) or carry the wrong kind (`kind`). The corrections are
//     applied first; then both files form one candidate list.
//
// A candidate is drawn only when the photo backs it:
//   1. context: it is left out when its centroid lies inside a modelled building or an A003 sidewalk, a polygon's
//      surroundings are mostly vegetation, the photo shows a cast shadow beside it on the side away from the photo's
//      sun (azimuth 92.5 deg, elevation 62 deg; cars and walls cast one, paint does not), or, for the line kinds the
//      first pass found least reliable (ROAD_CHECKED), its centroid lies off the road (road zones, OSM parking, or
//      within ARTERIAL_REACH_M of an OSM arterial or connector);
//   2. paint gate (paintEvidence): the share of its drawn area that the photo shows as paint of its own colour must
//      reach GATE_SUPPORT. Paint is a top-hat over PAINT_OPEN_M (the grey opening is the road surface around a mark):
//      white is brighter than the surface and nearly grey, yellow is more yellow than the surface ((R + G) / 2 - B)
//      and not darker, blue is bluer (or a wide blue area). This is what rejects lines traced on kerb stones, medians,
//      crossing frames and shadows, stop lines drawn wider than their paint, and outlines drawn around paint;
//   2a. the chip review in markings-gate.json overrides both: "not paint" rejects a candidate, "paint" accepts a hand
//      trace of paint too faint or shaded for the masks (each looked at on the 4x photo);
//   2b. zebra bars of a crossing whose bars mostly pass need only ZEBRA_GROUP_SUPPORT (shadow halves a bar's
//      contrast), and the pieces of one traced model (`group`: the bands of a striped hump, the fill, frame and
//      symbol of a blue bay, a ladder's rails and rungs) are drawn or left out together on their mean support (each
//      member still needs GROUP_MEMBER_FLOOR);
//   3. duplicates: where accepted candidates of one colour cover the same paint (DEDUP_SHARE of the smaller one's
//      area), a piece reviewed as paint by eye keeps over one that is not; else the smaller one inside a much larger
//      one (DEDUP_CONTAIN) or else the one with less support is dropped.
// A rejected candidate is not drawn (the modelled ground has no photo paint). Pieces the photo cannot show (`estimated`)
// skip the gate.
//
// Geometry. The candidates above are the photo's pieces as detected (traced fragments, bars at their own centres,
// paint blobs); the gate measures exactly those (fingerprints), so it stays the existence check. What is DRAWN is
// regular geometry fitted to the accepted pieces (4., stages/markingsRegular.mjs, fitters in lib/markingFit.mjs):
//   - zebra bars: one rectangle per crossing (bar groups that overlap are merged), equal bars ZEBRA_BAR_M wide at the
//     period ZEBRA_PERIOD_M with the phase of the detected bars. The period 0.903 m is MEASURED on the photo (n = 64
//     crossings, p10-p90 0.896-0.910 m). The bar width is below the photo's resolution (2 px), so ZEBRA_BAR_M 0.50 m
//     with 0.40 m gaps is ASSUMED (statute 0.45-0.50 m; the folded bar profiles of 25 crossings only bound the duty to
//     0.52-0.58). markings.geojson groups its bars by `crossing_id`; the completion pass's bars are grouped here
//     (ZEBRA_LINK_M, ZEBRA_LINK_DEG). Crossings whose bars are fused to a painted frame (`fused_frame`) are their
//     outline with its edges snapped straight;
//   - lines: fragments of one line chained and fitted as straight runs joined by tangent arcs, at the statute width
//     LINE_WIDTH_M_BY_KIND (estimated: the photo cannot measure a 0.10-0.20 m width); dashed kinds as DASH_BY_KIND
//     dashes phased on the detected ones (the photo's own period where it clearly differs); `double` yellow lines as
//     two lines DOUBLE_OFFSET_M either side of the fitted centreline (ASSUMED layout: the photo blurs the gap), or one
//     line when only that reading is on paint; stop lines straight, square to their lane, at their detected width
//     clamped into STOP_LINE_M (STOP_LINE_DEFAULT_M without one); `dotted` guide lines as `dots` squares;
//   - arrows, text, diamonds, give-way triangles, chevrons and bicycle symbols: statute templates
//     (lib/markingGlyphs.mjs) at the detected centre and size, oriented to their lane's travel direction; road text is
//     one block per lane read for the approaching driver, its words read in the SCNU VR tour or on the photo
//     (data/photo/evidence/markings-text.json), else the most likely statute text, logged 추정;
//   - stall lines, blue bays and their symbols: never from these detections; data/ground/parking.json draws them
//     (stages/parking.mjs joins markings.pieces in the build);
//   - other painted areas (hatch stripes, hump bands): rectangles, or outlines with their edges
//     snapped to their dominant directions.
// All of it lies flush on the ground it is painted on, cut out of the surfaces under it (lib/partition.mjs).
//
// Crossings: OSM crossing ways (data/osm-ground.json) and the digitised crosswalk polygons
// (docs/assets/data/crosswalks_wgs84.geojson) never draw stripes of their own. One that matches a drawn zebra is
// drawn from the photo alone (its offset is logged). One without a drawn zebra whose area the photo shows under
// canopy gets estimated bars (ZEBRA_PERIOD_M, ZEBRA_BAR_M); under a cast shadow alone or on open asphalt the photo
// shows no paint there, so those stay undrawn.
//
// Material: one Road_Marking material whose three-colour palette texture (white, yellow, blue) is both the base colour
// and the emissive map, so the dashboard's night ramp (CityModel lights every emissiveMap at night) makes the paint
// glow faintly in its own colour; KHR_materials_emissive_strength (NIGHT_GLOW) caps it. One mesh, one draw call.
// Everything here is derived from imagery; widths and estimated crossings are estimates, not survey data.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ShapeUtils, Vector2 } from "three";
import { EXTENT, SCENE_UNITS_PER_METRE, geoToModel, metres } from "../lib/frame.mjs";
import { busStopBoxTemplate, hatchedMedianTemplate } from "../lib/markingGlyphs.mjs";
import { conform } from "../lib/conform.mjs";
import { decimateDecal } from "../lib/decimate.mjs";
import { DECIMATE_TOLERANCE_M } from "../stages/surfaces.mjs";
import { pointInRing, ringArea, segmentDistance } from "../lib/geometry.mjs";
import { VEG_EXG, excessGreen, sampleOrtho, shadowWeight } from "../lib/ortho.mjs";
import { encodePng } from "../lib/png.mjs";
import { regularise } from "./markingEvidenceFit.mjs";
import { readA003 } from "../lib/a003.mjs";
import { registrationOf } from "../fit/registration.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARKINGS = path.join(HERE, "..", "data", "photo", "evidence", "markings.geojson");
const MARKINGS_EXTRA = path.join(HERE, "..", "data", "photo", "evidence", "markings-extra.geojson");
// templated markings read in the VR where the photo shows no paint (it predates them): placed, estimated (추정)
const TEMPLATES_VR = { bus_stop_box: busStopBoxTemplate, hatched_median: (l, w, m) => hatchedMedianTemplate(l, w, m.pattern) };
// Photo paint traced beyond EXTENT (scene units): the arterial at VR scene_f1, east of the campus, now that the context
// ground (stages/contextGround.mjs) draws a carriageway there. The paint gate measures it too (bake/markings-gate.mjs);
// buildMarkings leaves it out (no Topography there) and contextGround draws it on its own carriageway.
export const PAINT_BEYOND_EXTENT = Object.freeze({ minX: 502, maxX: 540, minZ: -45, maxZ: 20 });
export const inMarkingExtent = ([x, z]) => x >= EXTENT.minX && x <= EXTENT.maxX && z >= EXTENT.minZ && z <= EXTENT.maxZ;
const MARKINGS_VR = path.join(HERE, "..", "data", "photo", "evidence", "markings-vr.json");
const MARKINGS_GATE = path.join(HERE, "..", "data", "photo", "evidence", "markings-gate.json");
const MARKINGS_TEXT = path.join(HERE, "..", "data", "photo", "evidence", "markings-text.json");
const GROUND_FEATURES = path.join(HERE, "..", "data", "osm-ground.json");
const CROSSWALKS = path.resolve(HERE, "../../../..", "docs", "assets", "data", "crosswalks_wgs84.geojson");

const ZEBRA_PERIOD_M = 0.903;
const ZEBRA_BAR_M = 0.5;
const ZEBRA_LINK_M = 2;
const ZEBRA_LINK_DEG = 15;
// Statute widths and dash periods (경찰청 2024 교통노면표시 설치·관리 업무편람 표 2-1: centre/edge 150-200 mm,
// lane 100-150 mm -> the values below; 도로교통법 시행규칙 별표 6). Every width is an estimate here: the photo cannot
// verify a 0.10-0.20 m line. Warnings only, never a gate on what the photo shows.
export const LINE_WIDTH_M_BY_KIND = Object.freeze({
  centre_line_yellow: 0.15, edge_line: 0.15, lane_line_solid: 0.125, lane_line_dashed: 0.125,
  parking_line: 0.1, kerb_no_parking: 0.15, give_way_line: 0.15,
});
export const STOP_LINE_M = [0.3, 0.45];
const STOP_LINE_DEFAULT_M = 0.4;
// [dash, gap] in metres of the dashed kinds, laid along every fitted dashed line with the phase of its detected dashes
// (stages/markingsRegular.mjs; the photo's own period where it clearly differs). guide_dotted: dotted guide lines.
export const DASH_BY_KIND = Object.freeze({ centre_line_yellow: [3, 3], lane_line_dashed: [3, 5], guide_dotted: [0.5, 1.0] });
const CROSSING_MIN_M = 4.0;
const CROSSING_SPLIT_M = 6.0;
const STATUTE_SOURCE = "경찰청 2024 교통노면표시 설치·관리 업무편람 표 2-1; 도로교통법 시행규칙 별표 6 (2024-11-14)";
const STROKE_WIDTH_M = [0.1, 0.5];
const DOUBLE_OFFSET_M = 0.15;
// Kinds whose colour is fixed by what they are (yellow kerb and centre lines, white zebra bars, blue bays): never
// recoloured from the photo.
const FIXED_COLOUR_KINDS = new Set(["kerb_no_parking", "centre_line_yellow", "zebra_bar", "disabled_parking", "bike_lane_blue", "green_band"]);
const STROKED_KINDS = new Set(["lane_line_dashed", "lane_line_solid", "edge_line", "centre_line_yellow", "parking_line", "kerb_no_parking", "give_way_line"]);
// Above the Ground_* layers (at most 0.036 m, stages/surfaces.mjs); pack.mjs keeps positions as float.
const ON_FILL_KINDS = new Set(["disabled_parking", "bike_lane_blue"]);
const PARKING_KINDS = new Set(["parking_line", "disabled_parking"]);
// A point is on a building or a sidewalk for the regular geometry only when it and four points BLOCK_PROBE_M around it
// are: the A003 outlines and the building footprints are not exact to the kerb, so an edge line beside one stays.
const BLOCK_PROBE_M = 0.3;
const BLOCK_PROBES = [[0, 0], [BLOCK_PROBE_M, 0], [-BLOCK_PROBE_M, 0], [0, BLOCK_PROBE_M], [0, -BLOCK_PROBE_M]];

const SHADOW_AZIMUTH_DEG = 272.5;
const SHADOW_REACH_M = [0.3, 0.6, 0.9];
const RAISED_SHADOW_SHARE = 0.4;
const RAISED_SHADOW_EXCESS = 0.25;
const VEG_RING_M = [0.5, 0.9];
const VEG_RING_SHARE = 0.5;
const ROAD_CHECKED = new Set(["lane_line_solid", "edge_line", "centre_line_yellow"]);
const ARTERIAL_REACH_M = 12;
const BICYCLE_LANE = "A0033327";

// The paint gate: share of a candidate's drawn area on paint of its colour (bake/markings-gate.mjs), sampled every
// SUPPORT_STEP_M; duplicates are found on a DEDUP_CELL_M grid.
export const SUPPORT_STEP_M = 0.05;
export const GATE_SUPPORT = 0.6;
const ZEBRA_GROUP_SHARE = 2 / 3;
const ZEBRA_GROUP_SUPPORT = 0.3;
const GROUP_MEMBER_FLOOR = 0.3;
const DEDUP_CELL_M = 0.1;
const DEDUP_SHARE = 0.5;
const DEDUP_CONTAIN = 3;

// Estimated crossings: painted width of the detected arterial zebras (median 4.57 m, REG), overrun of the digitised
// polygons past their painted bars (median 1.45 m, REG). REG's OSM crossing translation (photo minus OSM) is the
// `osm` source of data/registration.json (design §9).
const crossingPrior = JSON.parse(readFileSync(new URL("../data/photo/evidence/crossing-prior.json", import.meta.url), "utf8"));
const POLYGON_OVERRUN_M = 1.45;
const OSM_TRANSFORM = registrationOf("osm").transform;
const OCCLUDED_SHARE = 0.5;
const MATCH_ANGLE_DEG = 25;
const MATCH_REACH_M = 3;

// green: the green bands across the E7 red carriageway (colour from the VR tour, 추정); the gate measures no green, so a
// green piece is drawn only when the chip review accepts it
// light_blue: the bus-stop box (VR scene_a19, 추정); data/photo/evidence/markings-vr.json
const PALETTE_SRGB = { white: [226, 226, 220], yellow: [228, 172, 52], blue: [40, 120, 196], green: [38, 140, 96], light_blue: [110, 190, 225] };
const PALETTE_COLOURS = ["white", "yellow", "blue", "green", "light_blue"];
// the colours bake/markings-gate.mjs measures, in its order: supports are [white, yellow, blue, fingerprint, ...]
const GATE_COLOURS = ["white", "yellow", "blue"];
export const PALETTE_U = Object.fromEntries(PALETTE_COLOURS.map((colour, i) => [colour, (i + 0.5) / PALETTE_COLOURS.length]));
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
  const buildingBoxes = buildingRings.map((r) => {
    const xs = r.map((q) => q[0]);
    const zs = r.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  });
  return {
    inBuilding: (p) => buildingRings.some((r, i) => {
      const b = buildingBoxes[i];
      return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && pointInRing(p, r);
    }),
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
  const walkways = readA003().features
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
  const boxOf = (rings) => {
    const xs = rings[0].map((q) => q[0]);
    const zs = rings[0].map((q) => q[1]);
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  };
  const walkwayBoxes = walkways.map(boxOf);
  const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
  return {
    onSidewalk: (p) => walkways.some((rings, i) => inBox(p, walkwayBoxes[i]) && evenOdd(p, rings)),
    roadLines,
    onRoad: (p) => inputs.roadZones.some((rings) => inPolygon(p, rings)) || parking.some((rings) => inPolygon(p, rings)) ||
      roadLines.some((line) => line.some((q, i) => i > 0 && segmentDistance(p, line[i - 1], q) <= metres(ARTERIAL_REACH_M))),
  };
}

// ---------------------------------------------------------------- sampling
// Points on a `step` grid (model units) inside `rings` (even-odd); a piece thinner than the grid gives its centroid.
export function gridPoints(rings, step) {
  const zs = rings.flatMap((ring) => ring.map((p) => p[1]));
  const top = Math.max(...zs);
  const points = [];
  const xs = [];
  for (let z = (Math.floor(Math.min(...zs) / step) + 0.5) * step; z < top; z += step) {
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, zi] = ring[i];
        const [xj, zj] = ring[j];
        if ((zi > z) !== (zj > z)) xs.push(xi + ((z - zi) / (zj - zi)) * (xj - xi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = (Math.ceil(xs[k] / step - 0.5) + 0.5) * step; x < xs[k + 1]; x += step) points.push([x, z]);
    }
  }
  return points.length ? points : [centroidOf(rings[0])];
}

// Short hash of a candidate's colour and drawn rings: the gate file stores it with the support it measured, so an
// entry that no longer matches the geometry the stage draws is caught.
function fingerprint({ colour, shapes }) {
  const text = colour + JSON.stringify(shapes.map((rings) => rings.map((ring) => ring.map(([x, z]) => [x.toFixed(3), z.toFixed(3)]))));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------- candidates
// Both files as one list: markings.geojson with the completion pass's corrections applied, then the completion pass.
function mergeSources(data, extra) {
  const corrections = new Map((extra.properties?.corrections ?? []).map((c) => [c.id, c]));
  const ids = new Set(data.features.map((f) => f.properties.id));
  const unknown = [...corrections.values()].filter((c) => !ids.has(c.id) || !["delete", "kind"].includes(c.action));
  if (unknown.length) throw new Error(`markings-extra.geojson: ${unknown.length} corrections name no markings.geojson id or no known action, e.g. ${JSON.stringify(unknown[0])}`);
  const applied = { deleted: 0, rekinded: 0 };
  const features = [];
  for (const feature of data.features) {
    const correction = corrections.get(feature.properties.id);
    if (correction?.action === "delete") {
      applied.deleted += 1;
      continue;
    }
    if (correction?.action === "kind") applied.rekinded += 1;
    features.push({ ...feature, properties: { ...feature.properties, kind: correction?.kind ?? feature.properties.kind }, file: "markings" });
  }
  for (const feature of extra.features) features.push({ ...feature, file: "markings-extra" });
  return { features, applied };
}

const clamp = (value, [lo, hi]) => Math.min(hi, Math.max(lo, value));

// ---------------------------------------------------------------- statute helpers
export const lineWidthFor = (kind) => LINE_WIDTH_M_BY_KIND[kind] ?? LINE_WIDTH_M_BY_KIND.centre_line_yellow;

// Stop line width: the detected width clamped into STOP_LINE_M, or STOP_LINE_DEFAULT_M without one.
export function stopLineWidth(detected) {
  if (!(detected > 0)) return { width: STOP_LINE_DEFAULT_M, clamped: false, defaulted: true };
  const width = clamp(detected, STOP_LINE_M);
  return { width, clamped: width !== detected, defaulted: false };
}

// Dash intervals [from, to] (metres along the line) of an estimated dashed piece `lengthM` long, starting with a dash.
export function dashPieces(lengthM, kind) {
  const [dash, gap] = DASH_BY_KIND[kind];
  const out = [];
  for (let s = 0; s + dash <= lengthM + 1e-9; s += dash + gap) out.push([s, s + dash]);
  return out;
}

// Crossing width (bar length) check: a warning string, never a rejection.
export function crossingWidthWarning(id, widthM, { split = false } = {}) {
  if (widthM < CROSSING_MIN_M) return `crossing ${id} width ${widthM.toFixed(2)} m < ${CROSSING_MIN_M.toFixed(1)} m (설치 기준, 경고)`;
  if (widthM >= CROSSING_SPLIT_M && !split) return `crossing ${id} width ${widthM.toFixed(2)} m >= ${CROSSING_SPLIT_M.toFixed(1)} m without a split (설치 기준, 경고)`;
  return null;
}

// Sub-polyline of `line` (model units) between arc lengths a and b (metres).
function slice(line, a, b) {
  const out = [];
  let s = 0;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const length = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]) / UNIT;
    const at = (t) => [line[i][0] + (line[i + 1][0] - line[i][0]) * ((t - s) / length), line[i][1] + (line[i + 1][1] - line[i][1]) * ((t - s) / length)];
    if (length > 1e-9 && s + length >= a && s <= b) {
      if (!out.length) out.push(at(Math.max(a, s)));
      if (s + length <= b) out.push(line[i + 1]);
      else {
        out.push(at(b));
        break;
      }
    }
    s += length;
  }
  return out;
}
const lineLengthM = (line) => line.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0) / UNIT;

// Plan-view pieces (each a list of rings, model units) of a line or polygon feature.
function featureShapes(p, { type, coordinates }) {
  if (type === "LineString" && p.dotted && p.dots) {
    const line = toModel(coordinates);
    const [a, b] = [line[0], line.at(-1)];
    const along = unit(sub(b, a));
    const across = [-along[1], along[0]];
    const half = metres(p.width_m) / 2;
    return Array.from({ length: p.dots }, (_, k) => {
      const t = p.dots > 1 ? k / (p.dots - 1) : 0.5;
      return [rect([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], along, across, half, half)];
    });
  }
  if (type === "LineString") {
    const line = toModel(coordinates);
    const width = p.kind === "stop_line" ? stopLineWidth(p.width_m).width
      : STROKED_KINDS.has(p.kind) || p.double ? lineWidthFor(p.double ? "centre_line_yellow" : p.kind)
        : clamp(p.width_m, STROKE_WIDTH_M);
    let lines = p.double ? [offsetLine(line, metres(DOUBLE_OFFSET_M)), offsetLine(line, -metres(DOUBLE_OFFSET_M))] : [line];
    if (p.estimated && DASH_BY_KIND[p.kind]) {
      lines = lines.flatMap((l) => dashPieces(lineLengthM(l), p.kind).map(([a, b]) => slice(l, a, b)).filter((piece) => piece.length >= 2));
    }
    return lines.map((l) => strokeRing(l, metres(width) / 2)).filter(Boolean).map((ring) => [ring]);
  }
  if (type === "Polygon") {
    const rings = coordinates.map((ring) => openRing(toModel(ring))).filter((ring) => ring.length >= 3);
    return rings.length ? [rings] : [];
  }
  throw new Error(`${p.id}: kind ${p.kind} with geometry ${type}, which this stage does not draw`);
}

// Zebra bars, each a ZEBRA_BAR_M wide rectangle at its own centre and length along its crossing's mean axis.
// markings.geojson groups its bars by crossing_id; the completion pass's bars are linked here when their centres lie
// within ZEBRA_LINK_M of each other and their axes agree within ZEBRA_LINK_DEG.
function zebraCandidates(features) {
  const groups = new Map();
  const loose = [];
  for (const feature of features) {
    const p = feature.properties;
    if (p.kind !== "zebra_bar" || p.fused_frame) continue;
    const box = orientedBox(openRing(toModel(feature.geometry.coordinates[0])));
    const bar = { feature, centre: box.centre, axis: box.long, halfLength: box.halfLong };
    if (!p.crossing_id) loose.push(bar);
    else if (groups.has(p.crossing_id)) groups.get(p.crossing_id).push(bar);
    else groups.set(p.crossing_id, [bar]);
  }
  const parent = loose.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const linked = Math.cos((ZEBRA_LINK_DEG * Math.PI) / 180);
  for (let i = 0; i < loose.length; i += 1) {
    for (let j = i + 1; j < loose.length; j += 1) {
      const [a, b] = [loose[i], loose[j]];
      if (Math.hypot(...sub(a.centre, b.centre)) <= metres(ZEBRA_LINK_M) && Math.abs(dot(a.axis, b.axis)) >= linked) parent[root(i)] = root(j);
    }
  }
  loose.forEach((bar, i) => {
    const id = `${loose[root(i)].feature.properties.id} group`;
    if (groups.has(id)) groups.get(id).push(bar);
    else groups.set(id, [bar]);
  });
  const candidates = [];
  for (const [group, bars] of groups) {
    const reference = bars[0].axis;
    const axis = unit(bars.reduce((acc, bar) => {
      const sign = dot(bar.axis, reference) >= 0 ? 1 : -1;
      return [acc[0] + bar.axis[0] * sign, acc[1] + bar.axis[1] * sign];
    }, [0, 0]));
    const across = [-axis[1], axis[0]];
    for (const bar of bars) {
      candidates.push({ feature: bar.feature, shapes: [[rect(bar.centre, axis, across, bar.halfLength, metres(ZEBRA_BAR_M) / 2)]], zebra: { group, axis, centre: bar.centre, halfLength: bar.halfLength } });
    }
  }
  return candidates;
}

// Every candidate of both files with its drawn pieces (model units), `fingerprint` and where it came from. Shared with
// bake/markings-gate.mjs, which measures the paint support of exactly these pieces.
export async function markingCandidates() {
  const data = JSON.parse(await Bun.file(MARKINGS).text());
  const extra = JSON.parse(await Bun.file(MARKINGS_EXTRA).text());
  const { features, applied } = mergeSources(data, extra);
  const candidates = zebraCandidates(features);
  let other = 0;
  for (const feature of features) {
    const p = feature.properties;
    if (p.kind === "zebra_bar" && !p.fused_frame) continue;
    if (p.kind === "other") {
      other += 1;
      continue;
    }
    const shapes = featureShapes(p, feature.geometry);
    // A `double` line also gets its single-line reading (the detected centreline at its statute width): the photo blurs the
    // gap of a double line, and a single line read as double would leave both strokes half off its paint.
    const single = p.double && feature.geometry.type === "LineString" ? featureShapes({ ...p, double: false }, feature.geometry) : null;
    if (shapes.length) candidates.push({ feature, shapes, single, frame: Boolean(p.fused_frame) });
  }
  const ids = new Set();
  for (const c of candidates) {
    const p = c.feature.properties;
    Object.assign(c, { id: p.id, file: c.feature.file, kind: p.kind, colour: p.colour, estimated: Boolean(p.estimated) });
    if (ids.has(c.id)) throw new Error(`${c.file}: marking id ${c.id} is used twice`);
    if (!PALETTE_SRGB[c.colour]) throw new Error(`${c.file}: ${c.id} has colour ${c.colour}, which the palette does not have`);
    ids.add(c.id);
    c.fingerprint = fingerprint(c);
  }
  return { candidates, applied, other };
}

// ---------------------------------------------------------------- loading
export async function loadMarkings({ inputs, buildings }) {
  const { candidates, applied, other } = await markingCandidates();
  const gate = JSON.parse(await Bun.file(MARKINGS_GATE).text());
  const stale = candidates.filter((c) => gate.supports[c.id]?.[3] !== c.fingerprint);
  if (stale.length) {
    throw new Error(`data/photo/evidence/markings-gate.json has no current paint support for ${stale.length} candidates (e.g. ${stale.slice(0, 3).map((c) => c.id).join(", ")}): ` +
      "run bun scripts/campus-model/bake/markings-gate.mjs (needs the NGII sheet in .cache/ngii-ortho)");
  }
  const fingerprints = new Map(candidates.map((c) => [c.id, c.fingerprint]));
  const staleReview = Object.entries(gate.review ?? {}).filter(([id, entry]) => fingerprints.get(id) !== entry.fingerprint);
  if (staleReview.length) {
    throw new Error(`data/photo/evidence/markings-gate.json reviews ${staleReview.length} candidates whose geometry has changed or gone (e.g. ${staleReview[0][0]}): review them again`);
  }
  const buildingRings = buildings.flatMap((b) => b.parts.map((part) => part.outer));
  const checks = photoChecks(inputs.ortho, buildingRings);
  const truth = await groundTruth(inputs);
  const pieces = [];
  const log = {
    corrections: applied, kinds: {}, files: {}, estimated: {},
    dropped: { other, building: 0, sidewalk: 0, offRoad: 0, vegetation: 0, shadow: 0, islandKerb: 0 },
  };
  const count = (table, kind) => { table[kind] = (table[kind] ?? 0) + 1; };
  const step = metres(SUPPORT_STEP_M);
  const cell = metres(DEDUP_CELL_M);

  // ---- 1. context and 2. the paint gate (support measured on the NGII photo by bake/markings-gate.mjs)
  for (const c of candidates) {
    const p = c.feature.properties;
    // Chip review (gate.review): "not paint" rejects a candidate whatever its support; "paint" accepts a hand trace
    // whose paint is too faint or shaded for the masks (looked at on the 4x photo).
    const verdict = gate.review?.[c.id]?.verdict;
    c.review = verdict === "not paint" ? gate.review[c.id].reason : null;
    c.byEye = verdict === "paint";
    // the yellow kerb of a raised island (data/photo/evidence/markings-extra.geojson kind island_kerb) is a structure, not
    // carriageway paint: logged, never drawn
    if (p.kind === "island_kerb") {
      c.dropped = "islandKerb";
      continue;
    }
    if (p.kind !== "zebra_bar" && !c.byEye) {
      const { type, coordinates } = c.feature.geometry;
      const first = c.shapes[0];
      const centre = type === "LineString" ? centroidOf(toModel(coordinates)) : centroidOf(first[0]);
      // beyond EXTENT the campus rasters are blank: the paint there (PAINT_BEYOND_EXTENT) was traced inside the
      // arterial's carriageway band only, so the context checks do not apply
      c.dropped = !inMarkingExtent(centre) ? null
        : checks.inBuilding(centre) ? "building"
        : truth.onSidewalk(centre) ? "sidewalk"
          : ROAD_CHECKED.has(p.kind) && !truth.onRoad(centre) ? "offRoad"
            : type === "Polygon" && checks.vegetated(first) ? "vegetation"
              : c.shapes.some((rings) => checks.raised(rings)) ? "shadow"
                : null;
      if (c.dropped) continue;
    }
    // Support per palette colour. A polygon whose own colour fails but whose paint the photo shows white or yellow
    // is drawn in that colour (the detection's colour label is wrong for some text and stall outlines); a line, or a
    // kind with a fixed colour, is not: a yellow kerb line the photo shows white is a light kerb stone, not white paint.
    const share = Object.fromEntries(GATE_COLOURS.map((colour, k) => [colour, gate.supports[c.id][k]]));
    c.support = share[c.colour] ?? 0;
    const singleSupport = c.single ? gate.supports[c.id][4 + GATE_COLOURS.indexOf(c.colour)] : undefined;
    if (c.single && c.support < GATE_SUPPORT && singleSupport >= GATE_SUPPORT) Object.assign(c, { shapes: c.single, support: singleSupport, singled: true });
    if (!c.estimated && c.support < GATE_SUPPORT && c.feature.geometry.type === "Polygon" && !FIXED_COLOUR_KINDS.has(c.kind) && !c.feature.properties.group) {
      // white and yellow only: paint in a cast shadow reads blue-grey, and blue paint is its own kinds
      const best = ["white", "yellow"].reduce((a, b) => (share[b] > share[a] ? b : a));
      if (share[best] >= GATE_SUPPORT) Object.assign(c, { recoloured: c.colour, colour: best, support: share[best] });
    }
    c.cells = new Set(c.shapes.flatMap((rings) => gridPoints(rings, step)).map(([x, z]) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`));
    c.accepted = c.byEye || (!c.review && (c.estimated || c.support >= GATE_SUPPORT));
  }

  // ---- 2b. zebra bars in a crossing the photo backs: a bar under a tree's or a building's shadow keeps less than half
  // its contrast, so within a crossing whose bars mostly pass (ZEBRA_GROUP_SHARE) a bar needs ZEBRA_GROUP_SUPPORT
  const groups = new Map();
  for (const c of candidates) {
    if (!c.zebra || c.dropped || c.estimated) continue;
    if (groups.has(c.zebra.group)) groups.get(c.zebra.group).push(c);
    else groups.set(c.zebra.group, [c]);
  }
  for (const bars of groups.values()) {
    if (bars.filter((c) => c.support >= GATE_SUPPORT).length < ZEBRA_GROUP_SHARE * bars.length) continue;
    for (const c of bars) {
      if (!c.accepted && !c.review && c.support >= ZEBRA_GROUP_SUPPORT) Object.assign(c, { accepted: true, byGroup: true });
    }
  }

  // ---- 2c. traced groups (the bands of one striped hump, the fill, frame and symbol of one blue bay, a ladder's
  // rails and rungs): one fitted model, so drawn or left out as a whole on the members' mean support. Drawing only
  // some would leave a traced model half drawn.
  const traced = new Map();
  for (const c of candidates) {
    const group = c.feature.properties.group;
    if (!group) continue;
    if (traced.has(group)) traced.get(group).push(c);
    else traced.set(group, [c]);
  }
  for (const members of traced.values()) {
    const measured = members.filter((c) => c.support !== undefined);
    const mean = measured.reduce((sum, c) => sum + c.support, 0) / Math.max(1, measured.length);
    for (const c of members) {
      if (c.review || c.byEye) continue;
      if (mean >= GATE_SUPPORT && c.support === undefined) {
        // left out by the context tests: a member of a traced model stands with its group
        c.support = GATE_COLOURS.includes(c.colour) ? gate.supports[c.id][GATE_COLOURS.indexOf(c.colour)] : 0;
        c.cells = new Set(c.shapes.flatMap((rings) => gridPoints(rings, step)).map(([x, z]) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`));
        c.dropped = null;
      }
      // a member must still lie mostly on its colour (GROUP_MEMBER_FLOOR): the fitted stripes at a hump's clipped
      // corners or over its unpainted edge are left out
      const accepted = mean >= GATE_SUPPORT && c.support >= GROUP_MEMBER_FLOOR;
      Object.assign(c, { accepted, byGroup: accepted && c.support < GATE_SUPPORT });
    }
  }

  // ---- 3. duplicates: candidates of one colour sharing DEDUP_SHARE of the smaller one's cells
  const accepted = candidates.filter((c) => c.accepted);
  const owners = new Map();
  accepted.forEach((c, i) => {
    for (const cell of c.cells) {
      const key = `${c.colour} ${cell}`;
      if (owners.has(key)) owners.get(key).push(i);
      else owners.set(key, [i]);
    }
  });
  const shared = new Map();
  for (const list of owners.values()) {
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        const key = list[a] * accepted.length + list[b];
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }
  const pairs = [...shared]
    .map(([key, n]) => {
      const a = accepted[Math.floor(key / accepted.length)];
      const b = accepted[key % accepted.length];
      return { a, b, share: n / Math.min(a.cells.size, b.cells.size) };
    })
    .filter((pair) => pair.share >= DEDUP_SHARE)
    .sort((p, q) => q.share - p.share);
  for (const { a, b } of pairs) {
    if (a.duplicateOf || b.duplicateOf) continue;
    const [small, large] = a.cells.size <= b.cells.size ? [a, b] : [b, a];
    // a piece judged paint by eye on the VR tour and the 4x chip (gate review) outranks a detector piece of the same paint
    const loser = a.estimated !== b.estimated ? (a.estimated ? a : b)
      : a.byEye !== b.byEye ? (a.byEye ? b : a)
      : large.cells.size >= DEDUP_CONTAIN * small.cells.size ? small
        : a.support !== b.support ? (a.support < b.support ? a : b)
          : small;
    loser.duplicateOf = (loser === a ? b : a).id;
  }

  // ---- what is drawn
  const zebras = [];
  const drawn = [];
  for (const c of candidates) {
    c.verdict = c.dropped ? "dropped" : c.review ? "reviewed" : !c.accepted ? "rejected" : c.duplicateOf ? "duplicate" : c.estimated ? "estimated" : "drawn";
    for (const table of [log.kinds, log.files]) {
      const key = table === log.kinds ? c.kind : c.file;
      table[key] ??= { drawn: 0, estimated: 0, rejected: 0, reviewed: 0, duplicate: 0, dropped: 0, recoloured: 0 };
      table[key][c.verdict] += 1;
      if (c.recoloured && c.verdict === "drawn") table[key].recoloured += 1;
      if (c.byGroup && c.verdict === "drawn") table[key].byGroup = (table[key].byGroup ?? 0) + 1;
      if (c.singled && c.verdict === "drawn") table[key].singled = (table[key].singled ?? 0) + 1;
      if (c.byEye && c.verdict === "drawn") table[key].byEye = (table[key].byEye ?? 0) + 1;
    }
    if (c.dropped) log.dropped[c.dropped] += 1;
    if (c.verdict !== "drawn" && c.verdict !== "estimated") continue;
    if (c.feature.geometry.type === "LineString") c.lineModel = toModel(c.feature.geometry.coordinates);
    drawn.push(c);
    if (c.frame) {
      const box = orientedBox(c.shapes[0][0]);
      zebras.push({ id: `${c.feature.properties.crossing_id} frame`, centre: box.centre, axis: box.short, bars: 1, halfLength: box.halfShort, barCentres: [box.centre, ...c.shapes[0][0]] });
    }
  }

  // ---- 4. regular geometry: the gate decided where paint is; what is drawn there is fitted lines, statute dashes,
  // one bar set per crossing and templates (stages/markingsRegular.mjs)
  const textMarkings = JSON.parse(await Bun.file(MARKINGS_TEXT).text()).markings;
  const regular = regularise(drawn, {
    unit: UNIT,
    blocked: (p) => BLOCK_PROBES.every(([dx, dz]) => {
      const q = [p[0] + metres(dx), p[1] + metres(dz)];
      return checks.inBuilding(q) || truth.onSidewalk(q);
    }),
    roadAxes: truth.roadLines,
    textMarkings,
    statute: {
      widthFor: lineWidthFor, stopLineWidth, dash: DASH_BY_KIND, doubleOffsetM: DOUBLE_OFFSET_M, zebraPeriodM: ZEBRA_PERIOD_M, zebraBarM: ZEBRA_BAR_M,
    },
  });
  pieces.push(...regular.pieces);
  zebras.push(...regular.zebras);
  log.regular = regular.stats;

  // ---- VR-only templated markings (data/photo/evidence/markings-vr.json): the photo predates the paint, so no gate; each is a
  // template at its read centre, front along its travel bearing, estimated
  log.vrOnly = [];
  for (const m of JSON.parse(await Bun.file(MARKINGS_VR).text()).markings) {
    const centre = geoToModel(...m.centre);
    const b = (m.travelBearingDeg * Math.PI) / 180;
    const f = [Math.sin(b), -Math.cos(b)];
    const r = [-f[1], f[0]];
    const polys = TEMPLATES_VR[m.kind](m.lengthM, m.widthM, m);
    const construction = { centre, forward: f, shape: { type: "glyph", template: m.kind,
      args: [m.lengthM, m.widthM, m.pattern], centered: false }, refs: [m.id], tier: "T2" };
    regular.model.symbols.push({ ...construction, kind:m.kind, colour:m.colour, legacyId:m.id });
    for (const rings of polys) {
      pieces.push({ rings: rings.map((ring) => ring.map(([x, y]) => [centre[0] + metres(x) * r[0] + metres(y) * f[0], centre[1] + metres(x) * r[1] + metres(y) * f[1]])), colour: m.colour, kind: m.kind, estimated: true, id: m.id, construction });
    }
    log.vrOnly.push(`${m.id} ${m.kind} ${m.lengthM} x ${m.widthM} m`);
  }

  // Crossing width check on the drawn zebras (bar length; warnings only, the photo's crossings are never rejected).
  const warnings = zebras.map((z) => crossingWidthWarning(z.id, (2 * z.halfLength) / UNIT)).filter(Boolean);
  for (const warning of warnings) console.warn(warning);

  // ---- crossings the photo cannot show
  const zebraMatch = (inRegion) => zebras.find((z) => z.barCentres.some(inRegion));
  const crossings = [];
  // Bars stacked along `walk` (unit) over +-halfWalk around `centre`, each 2 x halfBar long across it (model units).
  const addEstimatedBars = (centre, walk, halfWalk, halfBar, sourceRef) => {
    const along = [-walk[1], walk[0]];
    const period = metres(ZEBRA_PERIOD_M);
    const bar = metres(ZEBRA_BAR_M);
    const n = Math.floor((2 * halfWalk - bar) / period) + 1;
    if (n < 2) return 0;
    const first = -((n - 1) * period) / 2;
    const construction = {
      centre: [centre[0] + walk[0] * first, centre[1] + walk[1] * first], forward: [walk[1], -walk[0]],
      shape: { type: "crossing", lengthM: 2 * halfBar / UNIT, widthM: ZEBRA_BAR_M, periodM: ZEBRA_PERIOD_M, count: n, slots: Array.from({ length: n }, (_, k) => k) },
      refs: [sourceRef], tier: "T4",
    };
    regular.model.crossings.push(construction);
    for (let k = 0; k < n; k += 1) {
      const c = [centre[0] + walk[0] * (first + k * period), centre[1] + walk[1] * (first + k * period)];
      pieces.push({ rings: [rect(c, along, walk, halfBar, bar / 2)], colour: "white", kind: "zebra_bar", estimated: true, construction });
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
    const shift = [metres(OSM_TRANSFORM.dE), -metres(OSM_TRANSFORM.dN)];
    const centre = [middle[0] + shift[0], middle[1] + shift[1]];
    const across = [-walk[1], walk[0]];
    const band = [];
    for (let s = -length / 2; s <= length / 2; s += metres(0.5)) {
      for (let t = -metres(crossingPrior.barLengthM) / 2; t <= metres(crossingPrior.barLengthM) / 2; t += metres(0.5)) band.push([centre[0] + walk[0] * s + across[0] * t, centre[1] + walk[1] * s + across[1] * t]);
    }
    const occluded = checks.occluded(band);
    if (occluded < OCCLUDED_SHARE) {
      crossings.push(`${way.id}: no zebra detected, ${(occluded * 100).toFixed(0)} % under canopy (open asphalt or cast shadow), not drawn`);
      continue;
    }
    const bars = addEstimatedBars(centre, walk, length / 2 - metres(0.3), metres(crossingPrior.barLengthM) / 2, "OSM crossing "+way.id);
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
    const bars = addEstimatedBars(box.centre, box.long, halfWalk, box.halfShort, "CW crossing "+id);
    crossings.push(`${id}: no zebra visible, ${(occluded * 100).toFixed(0)} % under canopy, ${bars} estimated bars`);
  }

  const report = candidates.map((c) => ({
    id: c.id, file: c.file, kind: c.kind, colour: c.colour, method: c.feature.properties.method ?? "detect", estimated: c.estimated, fingerprint: c.fingerprint,
    support: c.support ?? null, recoloured: c.recoloured ?? null, verdict: c.verdict, reason: c.dropped ?? c.review ?? c.duplicateOf ?? null, shapes: c.shapes,
  }));
  // Stall paint comes from data/ground/parking.json (stages/parking.mjs); the detections stay gate evidence in the report.
  return { pieces: pieces.filter((p) => !PARKING_KINDS.has(p.kind)), zebras, crossings, warnings, log, report, model:regular.model, source: "data/photo/evidence/markings.geojson + data/photo/evidence/markings-extra.geojson" };
}

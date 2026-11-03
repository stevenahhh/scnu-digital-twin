// Main-gate traffic islands (data/photo/gate-structures.geojson, kind traffic_island: axis LineString + width_m, rounded
// ends; traced by eye on the NGII 2025 orthophoto, estimated). Cars never drive over an island: the islands are
// subtracted from the carriageway (road_polygons.geojson class `island`, which the trace oracle and the polygon checks
// treat as not-road) and every bidirectional car edge that passes within reach of an island is split round the island
// zone into two one-way lines through the free gaps between the islands, keep-right (the edge direction takes the gap
// on its right, the reverse direction the gap on its left), at least HALF_CAR_M from every island, ramped in and out over
// RAMP_M. The one-way lines are estimated (derived, no lane offset). Simulation frame (metres east/north of the D4 anchor).
import { dist, lineLength, round, segmentNearest, subLine } from "./geom.mjs";

export const HALF_CAR_M = 0.9; // half a car width (estimated)
export const REACH_M = 6; // islands this close to a car centreline shape its lanes
export const RAMP_M = 8;
const STEP_M = 0.5;
const T_STEP = 0.1;

// Stadium ring round an island axis (simulation frame).
export function islandRing(axis, widthM, arcSegments = 12) {
  const [a, b] = [axis[0], axis.at(-1)];
  const l = dist(a, b) || 1;
  const u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const r = widthM / 2;
  const ring = [];
  const arc = (c, from) => {
    for (let k = 0; k <= arcSegments; k += 1) {
      const ang = from + (Math.PI * k) / arcSegments;
      const [cx, cy] = [Math.cos(ang), Math.sin(ang)];
      // rotate the unit circle so angle 0 points along u
      ring.push([c[0] + r * (cx * u[0] - cy * u[1]), c[1] + r * (cx * u[1] + cy * u[0])]);
    }
  };
  arc(b, -Math.PI / 2);
  arc(a, Math.PI / 2);
  return ring.map((p) => p.map((v) => round(v)));
}

// gate-structures.geojson -> [{ id, axis, widthM, ring }] in the simulation frame (toSim([lon, lat]) -> [x, z]).
export function loadIslands(geojson, toSim) {
  return geojson.features
    .filter((f) => f.properties.kind === "traffic_island")
    .map((f) => {
      const axis = f.geometry.coordinates.map(toSim);
      const widthM = Number(f.properties.width_m);
      return { id: f.properties.id, axis, widthM, ring: islandRing(axis, widthM), estimated: f.properties.estimated !== false };
    });
}

// Distance from p to the island surface (negative inside).
const islandDistance = (p, island) => {
  let d = Infinity;
  for (let i = 0; i + 1 < island.axis.length; i += 1) d = Math.min(d, segmentNearest(p, island.axis[i], island.axis[i + 1]).d);
  return d - island.widthM / 2;
};

// Free intervals of t in [-T, T] along the normal at p where a car centre clears every island by HALF_CAR_M.
function freeIntervals(p, n, islands, T) {
  const out = [];
  let start = null;
  for (let t = -T; t <= T + 1e-9; t += T_STEP) {
    const q = [p[0] + n[0] * t, p[1] + n[1] * t];
    const free = islands.every((island) => islandDistance(q, island) >= HALF_CAR_M);
    if (free && start === null) start = t;
    if (!free && start !== null) { out.push([start, t - T_STEP]); start = null; }
  }
  if (start !== null) out.push([start, T]);
  return out;
}

// Lane position on one side: the free interval nearest the centreline on that side (sign -1 right, +1 left); the
// interval holding t = 0 serves both directions when the centreline itself is clear.
function sideTarget(intervals, sign) {
  const holding = intervals.find(([a, b]) => a <= 0 && b >= 0);
  if (holding) return { t: (holding[0] + holding[1]) / 2, width: holding[1] - holding[0] };
  const side = intervals.filter(([a, b]) => (sign < 0 ? b < 0 : a > 0)).sort((x, y) => (sign < 0 ? y[1] - x[1] : x[0] - y[0]));
  if (!side.length) return null;
  return { t: (side[0][0] + side[0][1]) / 2, width: side[0][1] - side[0][0] };
}

const pointAt = (pts, s) => subLine(pts, s, s)[0] ?? pts.at(-1);
function tangentAt(pts, s) {
  const total = lineLength(pts);
  const a = pointAt(pts, Math.max(0, s - 0.5));
  const b = pointAt(pts, Math.min(total, s + 0.5));
  const l = dist(a, b) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}

// features: the network FeatureCollection features (mutated: edges split, nodes added). Returns a report.
export function routeAroundIslands(features, islands, { reach = REACH_M, ramp = RAMP_M } = {}) {
  const report = { split: [], unresolved: [] };
  if (!islands.length) return report;
  const nodes = new Map(features.filter((f) => f.properties.feature_type === "node").map((f) => [f.id, f]));
  const candidates = features.filter((f) => f.properties.feature_type === "edge" && f.properties.allowed_types.includes("car") && f.properties.kind === "allowed_road");
  for (const edge of candidates) {
    const pts = edge.geometry.coordinates;
    const total = lineLength(pts);
    const near = [];
    for (let s = 0; s <= total + 1e-9; s += STEP_M) if (islands.some((island) => islandDistance(pointAt(pts, s), island) < reach)) near.push(s);
    if (!near.length) continue;
    const s0 = Math.max(0, near[0] - ramp);
    const s1 = Math.min(total, near.at(-1) + ramp);
    const sections = [];
    for (let s = s0; s <= s1 + 1e-9; s += STEP_M) {
      const p = pointAt(pts, s);
      const u = tangentAt(pts, s);
      const n = [-u[1], u[0]]; // left of travel
      const zone = s >= near[0] && s <= near.at(-1);
      const intervals = freeIntervals(p, n, islands, reach);
      sections.push({ s, p, n, zone, intervals, right: sideTarget(intervals, -1), left: sideTarget(intervals, 1) });
    }
    // one lane position per side through the whole zone (the median gap position where the centreline is blocked),
    // clamped into the free interval that holds it: a straight line through the gap, never snapping back to the
    // centreline round an island tip
    for (const side of ["right", "left"]) {
      const blocked = sections.filter((c) => c.zone && c[side] && !c.intervals.some(([a0, b0]) => a0 <= 0 && b0 >= 0)).map((c) => c[side].t).sort((x, y) => x - y);
      if (!blocked.length) continue;
      const ref = blocked[Math.floor(blocked.length / 2)];
      for (const c of sections.filter((x) => x.zone)) {
        const holding = c.intervals.find(([a0, b0]) => a0 <= ref && b0 >= ref)
          ?? [...c.intervals].sort((x, y) => Math.abs((x[0] + x[1]) / 2 - ref) - Math.abs((y[0] + y[1]) / 2 - ref))[0];
        if (holding) c[side] = { t: Math.min(holding[1], Math.max(holding[0], ref)), width: holding[1] - holding[0] };
      }
    }
    if (sections.some((c) => c.zone && (!c.right || !c.left))) {
      report.unresolved.push({ edge: edge.id, reason: "no free gap on one side of an island" });
      continue;
    }
    // lane position: the gap centre inside the island zone, ramped linearly from / to the centreline over `ramp`
    const zoneSections = sections.filter((c) => c.zone);
    const first = zoneSections[0], last = zoneSections.at(-1);
    const offsetAt = (c, side) => {
      if (c.zone) return c[side].t;
      const edgeT = c.s < first.s ? first[side].t : last[side].t;
      const span = c.s < first.s ? first.s - s0 : s1 - last.s;
      const k = span > 0 ? (c.s < first.s ? (c.s - s0) / span : (s1 - c.s) / span) : 1;
      return edgeT * k;
    };
    const line = (side) => sections.map((c) => { const t = offsetAt(c, side); return [round(c.p[0] + c.n[0] * t), round(c.p[1] + c.n[1] * t)]; });
    const forward = line("right");
    const backward = line("left").reverse();
    const narrowest = (side) => Math.min(...zoneSections.map((c) => c[side].width));
    const props = edge.properties;
    const nodeFeature = (id, p) => ({ type: "Feature", id, geometry: { type: "Point", coordinates: p.map((v) => round(v)) }, properties: { id, feature_type: "node", kind: "lane_split", poi_id: null, road_id: props.road_id ?? null, source_route_id: null, source: "derived_from_vehicle_network", confidence: 0.3, derived: true, authoritative: false, estimated: true, position_source: `split of ${edge.id} round the main-gate traffic islands (estimated)` } });
    const piece = (id, from, to, coords, extra = {}) => ({ type: "Feature", id, geometry: { type: "LineString", coordinates: coords }, properties: { ...props, id, source_id: id, from_node: from, to_node: to, length_m: round(lineLength(coords), 2), ...extra } });
    const startNode = s0 > 0.05 ? nodeFeature(`${edge.id}_ISL_A`, pointAt(pts, s0)) : null;
    const endNode = s1 < total - 0.05 ? nodeFeature(`${edge.id}_ISL_B`, pointAt(pts, s1)) : null;
    const a = startNode ? startNode.id : props.from_node;
    const b = endNode ? endNode.id : props.to_node;
    const gap = { bidirectional: false, derived: true, estimated: true, authoritative: false, lanes: 1, source: "derived_from_vehicle_network", confidence: 0.3, gap_reason: "routed through the gaps between the main-gate traffic islands, keep-right (추정)", source_ref: `${edge.id} round ${islands.map((i) => i.id).join(", ")}` };
    for (const key of ["lanes_source", "lane_offset_cap_m"]) delete gap[key];
    const added = [];
    if (startNode) added.push(startNode);
    if (endNode) added.push(endNode);
    const westCoords = startNode ? [...pts.filter((_, i) => lineLength(pts.slice(0, i + 1)) < s0), pointAt(pts, s0)] : null;
    const eastCoords = endNode ? [pointAt(pts, s1), ...pts.filter((_, i) => lineLength(pts.slice(0, i + 1)) > s1)] : null;
    const replaced = [];
    if (westCoords) replaced.push(piece(edge.id, props.from_node, a, westCoords.map((p) => p.map((v) => round(v)))));
    if (eastCoords) replaced.push(piece(`${edge.id}_E`, b, props.to_node, eastCoords.map((p) => p.map((v) => round(v)))));
    const fwd = piece(`${edge.id}_ISL_FWD`, a, b, forward, { ...gap, width_m: round(narrowest("right") + 2 * HALF_CAR_M, 2) });
    const rev = piece(`${edge.id}_ISL_REV`, b, a, backward, { ...gap, width_m: round(narrowest("left") + 2 * HALF_CAR_M, 2) });
    for (const f of [fwd, rev]) { delete f.properties.lanes_source; delete f.properties.lane_offset_cap_m; }
    const at = features.indexOf(edge);
    features.splice(at, 1, ...replaced, fwd, ...(props.bidirectional === false ? [] : [rev]));
    features.push(...added);
    for (const f of added) nodes.set(f.id, f);
    report.split.push({ edge: edge.id, from_m: round(s0, 1), to_m: round(s1, 1), forwardGapM: round(narrowest("right"), 2), reverseGapM: round(narrowest("left"), 2) });
  }
  return report;
}

// Island polygons for road_polygons.geojson (class island: subtracted from the carriageway by every consumer).
export const islandPolygons = (islands) => islands.map((island) => ({ class: "island", id: `ISLAND_${island.id}`, source_ref: `data/photo/gate-structures.geojson ${island.id} (traced by eye, 추정)`, estimated: true, rings: [island.ring] }));

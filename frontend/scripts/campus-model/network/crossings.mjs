#!/usr/bin/env bun
// Crossing edges from the digitised crosswalk polygons CW_001-CW_031 (plan uhf-ground-roads-routing todo 16, draft D-5).
// Simulation frame (metres east/north of the D4 anchor in EPSG:5186 TM).
//
//   bun scripts/campus-model/network/crossings.mjs [--stats] [--preview <png>] [--window <name>]
//
// Per polygon: the road centreline edge of network/roads.mjs that intersects it (else the nearest within ROAD_REACH_M,
// else `CW_0xx: no road within 6 m, skipped`); the crossing line runs through the polygon centroid PERPENDICULAR to
// that centreline (not along the polygon's long axis) and spans the road polygons kerb to kerb. Each end snaps to the
// nearest sidewalk node of network/sidewalks.mjs within SNAP_M (a node is inserted when the nearest point is mid-edge);
// with none there, an estimated `shared_path` connector (confidence 0.2) joins the end to the nearest sidewalk node
// within CONNECT_M. Cross-checks, logged and never applied silently: the CROSSWALK_BY_ZONE map of the previous
// road-zone builder (b0969e2, ported in roads.mjs) against the zone of the chosen road edge, and the crossings with
// a dropped kerb (stages/kerbs.mjs, todo 11) against the crossings whose ends reached a sidewalk.
import path from "node:path";
import { CROSSWALK_BY_ZONE } from "./roads.mjs";
import { NetGraph } from "./graph.mjs";
import { PolygonGrid, dist, inRings, lineLength, nearestOnLine, ringsDistance, round, segmentNearest } from "./geom.mjs";

export const ROAD_REACH_M = 6;
export const SNAP_M = 3;
export const STRIP_REACH_M = 1;
export const ZONE_REACH_M = 20;
export const CLIP_MARGIN_M = 3;
export const CENTRELINE_OVERSHOOT_M = 0.5;
export const STRIP_SNAP_M = 10;
export const CONNECT_M = 30;
const MARCH_M = 0.05;
const MAX_HALF_SPAN_M = 30;

const centroidOf = (ring) => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const k = p[0] * q[1] - q[0] * p[1];
    a += k;
    cx += (p[0] + q[0]) * k;
    cy += (p[1] + q[1]) * k;
  }
  if (Math.abs(a) < 1e-9) return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  return [cx / (3 * a), cy / (3 * a)];
};

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
// Nearest point of a polyline whose perpendicular from p falls inside its segment (so the perpendicular line through p
// really crosses the polyline there); falls back to the plain nearest point.
function perpendicularFoot(p, pts, clamp = false) {
  let best = null;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l2 = ex * ex + ey * ey;
    if (l2 < 1) continue; // sub-metre pieces (pixel staircases) give no usable direction
    const raw = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2;
    if (!clamp && (raw <= 0.02 || raw >= 0.98)) continue;
    const t = Math.max(0, Math.min(1, raw));
    const q = [a[0] + t * ex, a[1] + t * ey];
    const d = dist(p, q);
    if (!best || d < best.d) best = { q, d, seg: i, t, clamped: raw < 0 || raw > 1 };
  }
  return best;
}
const lexLess = (a, b) => {
  for (let k = 0; k < a.length; k += 1) if (a[k] !== b[k]) return a[k] < b[k];
  return false;
};
// Unit long axis of a ring (principal component of its vertices about c).
function longAxis(ring, c) {
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of ring) {
    sxx += (x - c[0]) ** 2;
    syy += (y - c[1]) ** 2;
    sxy += (x - c[0]) * (y - c[1]);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return [Math.cos(angle), Math.sin(angle)];
}
const lineHitsRing = (pts, ring) => pts.some((p) => inRings(p, [ring])) || pts.slice(1).some((p, i) => ring.some((r, k) => segmentsCross(pts[i], p, r, ring[(k + 1) % ring.length])));

// crosswalks: [{ id, ring }]; roads: buildRoads() result (edges as GeoJSON features, polygons); graph: NetGraph of the
// sidewalks (mutated: nodes inserted, crossing and connector edges added); kerbTouched: CW ids with a dropped kerb.
// strips: sidewalk strips ({ id, rings }) - a crossing end within STRIP_REACH_M of a strip snaps to that strip's centreline.
export function buildCrossings({ crosswalks, roads, graph, strips = [], kerbTouched = null, crosswalkByZone = CROSSWALK_BY_ZONE, warn = console.warn }) {
  const warnings = [];
  const log = (m) => {
    warnings.push(m);
    warn(m);
  };
  const seen = new Set();
  for (const c of crosswalks) {
    if (seen.has(c.id)) throw new Error(`duplicate CW id ${c.id}`);
    seen.add(c.id);
  }
  // centrelines long enough to cross (stubs left by the zone joins have no direction of their own)
  const roadEdges = roads.edges.map((f) => ({ id: f.id, points: f.geometry.coordinates, props: f.properties })).filter((e) => lineLength(e.points) >= 2);
  // kerb to kerb: through carriageway polygons (not lots), stopping at the first A003 strip (the strips lie over the
  // road zones up to the kerb line)
  const roadGrid = new PolygonGrid(roads.polygons.filter((p) => p.class === "road"), 20);
  const lotGrid = new PolygonGrid(roads.polygons.filter((p) => p.class === "lot"), 20);
  const stripGrid = new PolygonGrid(strips.map((st) => ({ rings: st.rings, id: st.id })), 20);
  const zoneRings = new Map();
  for (const p of roads.polygons) if (p.name) zoneRings.set(p.name, [...(zoneRings.get(p.name) ?? []), p.rings]);
  const cwRing = new Map();
  const edges = [];
  const nodes = [];
  const skipped = [];
  const attachedBoth = new Set();
  let connectors = 0;
  const chosenZone = new Map();
  const sidewalkEdge = (e) => e.kind === "sidewalk";
  for (const cw of [...crosswalks].sort((a, b) => a.id.localeCompare(b.id))) {
    const ring = cw.ring.length > 1 && dist(cw.ring[0], cw.ring.at(-1)) < 1e-9 ? cw.ring.slice(0, -1) : cw.ring;
    const c = centroidOf(ring);
    cwRing.set(cw.id, ring);
    // the polygon's long axis is the walking direction: the road runs across it
    const axis = longAxis(ring, c);
    // road edge: intersecting the polygon, the centreline (not a link) whose local direction is most perpendicular to the
    // walking axis, then nearest to the centroid; else the nearest within ROAD_REACH_M of the polygon
    let road = null;
    for (const e of roadEdges) {
      const n = perpendicularFoot(c, e.points);
      if (!n) continue;
      const hits = lineHitsRing(e.points, ring);
      const gap = hits ? 0 : Math.min(...e.points.map((p) => ringsDistance(p, [ring])), ...ring.map((p) => nearestOnLine(p, e.points).d));
      if (gap > ROAD_REACH_M) continue;
      const s0 = e.points[n.seg];
      const s1 = e.points[n.seg + 1];
      const l = dist(s0, s1) || 1;
      const along = Math.abs(((s1[0] - s0[0]) * axis[0] + (s1[1] - s0[1]) * axis[1]) / l);
      const rank = [hits ? 0 : 1, e.props.link ? 1 : 0, hits ? along + 0.02 * n.d : gap];
      if (!road || lexLess(rank, road.rank)) road = { e, n, rank };
    }
    if (!road) {
      // no centreline has a perpendicular foot here (the crossing sits at a bend or an edge end): the nearest point,
      // the crossing then runs from the centroid through it
      for (const e of roadEdges) {
        const n = perpendicularFoot(c, e.points, true);
        if (!n || n.d > ROAD_REACH_M + 2 || !lineHitsRing(e.points, ring)) continue;
        if (!road || lexLess([e.props.link ? 1 : 0, n.d], road.rank)) road = { e, n, rank: [e.props.link ? 1 : 0, n.d] };
      }
    }
    if (!road && [c, ...ring].some((p) => roadGrid.contains(p) || lotGrid.contains(p))) {
      // the polygon lies on the carriageway of a zone whose centreline passes further away (an intersection blob):
      // the nearest centreline within ZONE_REACH_M, logged
      for (const e of roadEdges) {
        const n = perpendicularFoot(c, e.points, true);
        if (n && n.d <= ZONE_REACH_M && (!road || lexLess([e.props.link ? 1 : 0, n.d], road.rank))) road = { e, n, rank: [e.props.link ? 1 : 0, n.d] };
      }
      if (road) log(`${cw.id}: on the carriageway, nearest centreline ${road.n.d.toFixed(1)} m away (${road.e.props.source_ref ?? road.e.id})`);
    }
    if (!road) {
      log(`${cw.id}: no road within ${ROAD_REACH_M} m, skipped`);
      skipped.push(cw.id);
      continue;
    }
    chosenZone.set(cw.id, road.e.props.source_ref);
    const a0 = road.e.points[road.n.seg];
    const b0 = road.e.points[road.n.seg + 1];
    const len = dist(a0, b0) || 1;
    const u = [(b0[0] - a0[0]) / len, (b0[1] - a0[1]) / len];
    const toFoot = [road.n.q[0] - c[0], road.n.q[1] - c[1]];
    const footLen = Math.hypot(toFoot[0], toFoot[1]);
    const n = road.n.clamped && footLen > 0.05 ? [toFoot[0] / footLen, toFoot[1] / footLen] : [-u[1], u[0]];
    // the line through the centroid along n; start where it meets the centreline, march out to the kerbs
    const t0 = (road.n.q[0] - c[0]) * n[0] + (road.n.q[1] - c[1]) * n[1];
    const at = (t) => [c[0] + n[0] * t, c[1] + n[1] * t];
    // carriageway: road polygons (and lots when the crossing lies in a car park), never inside an A003 strip, and no
    // further than the crossing polygon's own extent across the road + CLIP_MARGIN_M (an intersection zone continues
    // past the kerb line of the arm the crossing spans)
    const across = ring.map((p) => (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1]);
    const tMin = Math.min(...across) - CLIP_MARGIN_M;
    const tMax = Math.max(...across) + CLIP_MARGIN_M;
    const useLots = lotGrid.contains(road.n.q) || lotGrid.contains(c);
    const inRoad = (p) => (roadGrid.contains(p) || (useLots && lotGrid.contains(p))) && !stripGrid.contains(p);
    // contiguous carriageway runs along the line inside the window; the run holding (or nearest to) the centreline
    // crossing gives the kerbs; with none (the polygon lies wholly under A003 outlines) the zebra's own extent
    const runsAlong = [];
    for (let t = tMin; t <= tMax + 1e-9; t += MARCH_M) {
      const ok = inRoad(at(t));
      if (ok && runsAlong.length && runsAlong.at(-1).open) runsAlong.at(-1).t1 = t;
      else if (ok) runsAlong.push({ t0: t, t1: t, open: true });
      else if (runsAlong.length) runsAlong.at(-1).open = false;
    }
    const tc = Math.min(tMax, Math.max(tMin, t0));
    const run = runsAlong.map((r) => ({ ...r, gap: tc < r.t0 ? r.t0 - tc : tc > r.t1 ? tc - r.t1 : 0 })).sort((x, y) => x.gap - y.gap || (y.t1 - y.t0) - (x.t1 - x.t0))[0];
    const kerbSource = run && run.t1 - run.t0 >= 1 ? "road_polygon" : "crossing_polygon";
    let tA = kerbSource === "road_polygon" ? run.t0 : tMin + CLIP_MARGIN_M;
    let tB = kerbSource === "road_polygon" ? run.t1 : tMax - CLIP_MARGIN_M;
    // the crossing must cross the vehicle centreline it belongs to (conflict with the cars on it): a span that stops
    // short of the centreline (zebra digitised beside it) is carried across it
    const centrelineGap = t0 < tA ? tA - t0 : t0 > tB ? t0 - tB : 0;
    if (t0 <= tA) tA = t0 - CENTRELINE_OVERSHOOT_M;
    if (t0 >= tB) tB = t0 + CENTRELINE_OVERSHOOT_M;
    const a = at(tA);
    const b = at(tB);
    const extentAlong = ring.map((p) => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1]);
    const width = Math.max(...extentAlong) - Math.min(...extentAlong);
    const endA = `CWN_${cw.id.slice(3)}_A`;
    const endB = `CWN_${cw.id.slice(3)}_B`;
    const ends = [];
    for (const [p, id] of [[a, endA], [b, endB]]) {
      // the strip at the kerb (the march stopped on its outline) gives the centreline to snap to
      const strip = stripGrid.polygons.map((st) => ({ st, d: inRings(p, st.rings) ? 0 : ringsDistance(p, st.rings) })).filter((x) => x.d <= STRIP_REACH_M).sort((x, y) => x.d - y.d)[0]?.st;
      const nodeOpts = { nodeId: `SWN_${cw.id}_${id.at(-1)}`, nodeProps: { kind: "sidewalk", inserted_for: cw.id } };
      let snap = (strip && graph.snap(p, STRIP_SNAP_M, { ...nodeOpts, filter: (e) => sidewalkEdge(e) && e.sidewalk_id === strip.id && !e.link }))
        || graph.snap(p, SNAP_M, { ...nodeOpts, filter: sidewalkEdge });
      // both kerbs on one sidewalk node would make a loop: the second end stays a crossing end of its own
      if (snap && ends.length && ends[0].node === snap.id) snap = null;
      if (snap) {
        ends.push({ node: snap.id, p, snapped: true });
        if (graph.nodes.get(snap.id).inserted_for === cw.id) nodes.push(snap.id);
        continue;
      }
      graph.addNode(id, p, { kind: "crossing_end", crosswalk_id: cw.id });
      nodes.push(id);
      ends.push({ node: id, p, snapped: false });
      const near = graph.nearestOnEdges(p, CONNECT_M, sidewalkEdge);
      if (near) {
        const target = graph.snap(p, CONNECT_M, { filter: sidewalkEdge, nodeId: `SWN_${cw.id}_${id.at(-1)}c`, nodeProps: { kind: "sidewalk", inserted_for: cw.id } });
        graph.addEdge({
          id: `EDGE_CWC_${cw.id.slice(3)}_${id.at(-1)}`, from: id, to: target.id, points: [p, graph.nodes.get(target.id).p], kind: "shared_path",
          source: "derived_from_vehicle_network", source_ref: `${cw.id} end`, estimated: true, derived: true, authoritative: false, confidence: 0.2,
          gap_reason: `crossing end without A003 within ${SNAP_M} m`, crosswalk_id: cw.id, road_id: road.e.props.road_id ?? null,
        });
        connectors += 1;
      } else {
        log(`${cw.id}: crossing end ${id} has no sidewalk within ${CONNECT_M} m (left for the fallback joins)`);
      }
    }
    if (ends.every((e) => e.snapped)) attachedBoth.add(cw.id);
    const points = [];
    const startNode = graph.nodes.get(ends[0].node).p;
    const endNode = graph.nodes.get(ends[1].node).p;
    points.push(startNode);
    if (dist(startNode, a) > 0.05) points.push(a);
    if (dist(endNode, b) > 0.05) points.push(b);
    points.push(endNode);
    const edge = {
      id: `EDGE_${cw.id}`, from: ends[0].node, to: ends[1].node, points, kind: "crosswalk", crosswalk_id: cw.id, road_id: road.e.props.road_id ?? null,
      width_m: round(width, 2), crossing_length_m: round(dist(a, b), 2), kerb_source: kerbSource, centreline_gap_m: round(centrelineGap, 2), source: "ortho-traced", source_ref: `crosswalks_wgs84.geojson#${cw.id}`,
      authoritative: true, derived: false, estimated: false, confidence: 0.7, road_edge: road.e.id, road_seg: road.n.seg,
      conflict_polygon: [...ring, ring[0]].map((p) => p.map((v) => round(v))), kerb: [a, b].map((p) => p.map((v) => round(v))),
    };
    graph.addEdge(edge);
    edges.push(edge);
  }
  // cross-check 1: the previous builder's zone -> crossing map
  const mismatches = [];
  for (const [zone, cwId] of Object.entries(crosswalkByZone)) {
    if (!seen.has(cwId)) continue;
    const got = chosenZone.get(cwId);
    const ring = cwRing.get(cwId);
    const touches = (zoneRings.get(zone) ?? []).some((rings) => ring.some((p) => inRings(p, rings) || ringsDistance(p, rings) <= 3));
    if (got !== zone && !touches) mismatches.push(`${zone} -> ${cwId}: crossing lies on ${got ?? "no road"}, not within 3 m of ${zone}`);
  }
  for (const m of mismatches) log(`CROSSWALK_BY_ZONE mismatch: ${m}`);
  // cross-check 2: dropped kerbs vs crossings reaching a sidewalk on both ends
  const kerbDiff = [];
  if (kerbTouched) {
    const kerbs = new Set(kerbTouched);
    for (const id of [...seen].sort()) {
      if (kerbs.has(id) && !attachedBoth.has(id)) kerbDiff.push(`${id}: dropped kerb, crossing end without a sidewalk node`);
      if (!kerbs.has(id) && attachedBoth.has(id)) kerbDiff.push(`${id}: both ends on sidewalks, no dropped kerb`);
    }
    for (const m of kerbDiff) log(`kerb-join difference: ${m}`);
  }
  const stats = {
    crossings: crosswalks.length, edges: edges.length, skipped: skipped.length, skippedIds: skipped, connectors, mismatches: mismatches.length, kerbDifferences: kerbDiff.length,
    bothEndsOnSidewalk: attachedBoth.size, meanSpanM: edges.length ? round(edges.reduce((s, e) => s + e.crossing_length_m, 0) / edges.length, 2) : 0,
  };
  return { edges, nodes, warnings, stats, mismatches, kerbDiff };
}

export const statsLine = (s) => `crossings ${s.crossings}: edges ${s.edges}, skipped ${s.skipped}${s.skippedIds.length ? ` (${s.skippedIds.join(", ")})` : ""}, estimated connectors ${s.connectors}, CROSSWALK_BY_ZONE mismatches ${s.mismatches}, kerb-join differences ${s.kerbDifferences}; both ends on sidewalk nodes ${s.bothEndsOnSidewalk}, mean kerb-to-kerb ${s.meanSpanM} m`;

// Angle (deg) between the crossing's kerb-to-kerb line and the road segment it crosses.
export function crossingAngle(edge, roadPoints) {
  const [a, b] = edge.kerb;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const seg = edge.road_seg ?? nearestOnLine(mid, roadPoints).seg;
  const r0 = roadPoints[seg];
  const r1 = roadPoints[seg + 1];
  const u = [r1[0] - r0[0], r1[1] - r0[1]];
  const v = [b[0] - a[0], b[1] - a[1]];
  const cos = Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

void segmentNearest;
void lineLength;

// ---------------------------------------------------------------- CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const { loadNetworkContext } = await import("./context.mjs");
  const { buildSidewalks } = await import("./sidewalks.mjs");
  const ctx = await loadNetworkContext();
  const placeholders = JSON.parse(ctx.elementsText).sidewalk_placeholders ?? [];
  const sidewalks = buildSidewalks({ walkways: ctx.walkways, roadSegments: ctx.roadSegments, placeholders, warn: () => {} });
  const graph = NetGraph.fromSidewalks(sidewalks);
  const result = buildCrossings({ crosswalks: ctx.crossings, roads: ctx.roads, graph, strips: sidewalks.strips, kerbTouched: ctx.kerbs.touched });
  console.log(statsLine(result.stats));
  const angles = result.edges.map((e) => crossingAngle(e, ctx.roads.edges.find((f) => f.id === e.road_edge).geometry.coordinates));
  console.log(`angle to the road centreline: max |90 - a| = ${Math.max(...angles.map((a) => Math.abs(90 - a))).toFixed(2)} deg; every emitted crossing end on a node: ${result.edges.every((e) => graph.nodes.has(e.from) && graph.nodes.has(e.to))}`);
  const previewPath = arg("--preview");
  if (previewPath) {
    const { renderPreview } = await import("./preview.mjs");
    await renderPreview({
      layers: [
        ...ctx.roads.polygons.map((p) => ({ class: p.class, rings: p.rings })),
        ...sidewalks.strips.map((s) => ({ class: "sidewalk", rings: s.rings })),
        ...ctx.crossings.map((c) => ({ class: "crossing", rings: [c.ring] })),
      ],
      edges: [
        ...ctx.roads.edges.map((f) => ({ kind: "allowed_road", points: f.geometry.coordinates })),
        ...graph.edges.map((e) => ({ kind: e.kind, points: e.points, estimated: e.estimated })),
      ],
      nodes: result.nodes.map((id) => graph.nodes.get(id)),
      out: path.resolve(previewPath),
      window: arg("--window"),
    });
    console.log(`preview ${previewPath}`);
  }
}

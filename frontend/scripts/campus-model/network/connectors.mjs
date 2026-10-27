#!/usr/bin/env bun
// POI connectors (plan uhf-ground-roads-routing todo 19): building entrances, gates, external roads and parking onto
// the pedestrian graph (sidewalks, crossings and the estimated fallback of todos 15-18). Simulation frame.
//
//   bun scripts/campus-model/network/connectors.mjs [--stats] [--preview <png>] [--window <name>]
//
// Every POI keeps its id and node id but gets its own node (no two nodes share a position, tolerance 0.01 m):
//   building entrances  on the building apron: the footprint outline point nearest the derived entrance hint of
//                       backend/simulation/data/building_entrances.json, APRON_STEP_M outside it (position estimated)
//   gates / external /  the point nearest the old POI position (within PLACE_M) that lies on the surface its agents
//   parking             use: walkable (sidewalk, crossing, plaza or apron) for people, road or car park for cars, both
//                       when both are allowed
// A connector runs from the POI node to the nearest pedestrian node: straight when >= 95 % of its 0.5 m samples lie
// in walkable polygons and none in a building footprint; else around the apron ring and then straight; when nothing
// is reachable within REACH_M, an estimated connector (confidence 0.2) and the warning `<id> entrance unreachable
// within 50 m`; any connector whose 0.5 m samples are < 95 % walkable is labelled estimated too. Vehicle-side links (vehicle_gate, parking_connection, scooter_parking_connection) are added by
// buildNetwork.mjs (todo 20). building_entrances.json is not edited: `snapped_node` is reported per entrance.
import path from "node:path";
import { PolygonGrid, UnionFind, dist, inRings, lineLength, round, sampleLine, segmentNearest } from "./geom.mjs";

export const REACH_M = 50;
export const PLACE_M = 30;
export const APRON_STEP_M = 0.8;
export const STRAIGHT_SHARE = 0.95;
const APRON_RING_M = 0.55;
const KIND_FOR = { building: "building_entrance", gate: "pedestrian_gate", external: "pedestrian_gate", parking: "parking_walk", scooter_parking: "parking_walk" };

// Walkable polygons for people (also the trace oracle classes written by buildNetwork): A003 strips (sidewalk), the
// crossing polygons (crossing), OSM plazas, rims and building aprons (plaza), and paving supplements marked walkable
// (network/surfaces.mjs walkablePlaza: a paved courtyard no other walkable layer holds; estimated plaza).
export function walkablePolygons({ strips = [], crossings = [], layers = [] }) {
  return [
    ...strips.map((s) => ({ class: "sidewalk", id: s.id, rings: s.rings })),
    ...crossings.map((c) => ({ class: "crossing", id: c.id, rings: [c.ring] })),
    ...layers.filter((l) => l.cls === "PAVING" && (l.precedence === 2 || l.precedence === 6)).map((l, i) => ({ class: "plaza", id: `${l.precedence === 6 ? "APRON" : "PLAZA"}_${String(i + 1).padStart(4, "0")}`, source_ref: l.source_ref, estimated: Boolean(l.estimated), rings: l.rings })),
    ...layers.filter((l) => l.walkablePlaza).map((l, i) => ({ class: "plaza", id: `PAVEDCOURT_${String(i + 1).padStart(4, "0")}`, source_ref: l.source_ref, estimated: true, rings: l.rings })),
  ];
}

const segmentsCross = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b) && o(a, b, c) !== 0 && o(a, b, d) !== 0;
};

// Ring offset outward by d metres (mitred, mitre capped), for a counter- or clockwise ring.
function offsetRing(ring, d) {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) area += ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1];
  const sign = area > 0 ? 1 : -1;
  const n = ring.length;
  const normal = (a, b) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [((b[1] - a[1]) / l) * sign, (-(b[0] - a[0]) / l) * sign];
  };
  return ring.map((p, i) => {
    const na = normal(ring[(i - 1 + n) % n], p);
    const nb = normal(p, ring[(i + 1) % n]);
    let m = [na[0] + nb[0], na[1] + nb[1]];
    const l = Math.hypot(m[0], m[1]);
    m = l < 1e-9 ? na : [m[0] / l, m[1] / l];
    const cos = Math.max(1 / 3, m[0] * na[0] + m[1] * na[1]);
    return [p[0] + (m[0] * d) / cos, p[1] + (m[1] * d) / cos];
  });
}

function nearestOnRing(p, ring) {
  let best = null;
  for (let i = 0; i < ring.length; i += 1) {
    const r = segmentNearest(p, ring[i], ring[(i + 1) % ring.length]);
    if (!best || r.d < best.d) best = { ...r, seg: i };
  }
  return best;
}

// Path along a closed ring from point a (on segment sa) to point b (on segment sb), the shorter way round.
function ringPath(ring, a, sa, b, sb) {
  const n = ring.length;
  const forward = [a];
  for (let i = sa; i !== sb; i = (i + 1) % n) forward.push(ring[(i + 1) % n]);
  forward.push(b);
  const backward = [a];
  for (let i = sa; i !== sb; i = (i - 1 + n) % n) backward.push(ring[i]);
  backward.push(b);
  return lineLength(forward) <= lineLength(backward) ? forward : backward;
}

// entrances: [{ building_id, entrance_id, node_id, position: [x, z], allowed_types }]; pois: [{ poi_id, kind, node_id,
// allowed_types, p }] (non-building POIs); graph: NetGraph (mutated: POI nodes and connector edges added); walkable:
// walkablePolygons(); roadPolygons: [{ class: road|lot, rings }]; buildings: [{ id, rings }] footprints.
export function buildConnectors({ entrances = [], pois = [], graph, walkable = [], roadPolygons = [], buildings = [], warn = console.warn }) {
  const warnings = [];
  const log = (m) => {
    warnings.push(m);
    warn(m);
  };
  const walkGrid = new PolygonGrid(walkable, 20);
  const roadGrid = new PolygonGrid(roadPolygons.filter((p) => p.class === "road" || p.class === "lot"), 20);
  const footGrid = new PolygonGrid(buildings, 20);
  const isWalkable = (p) => walkGrid.contains(p);
  const inFootprint = (p) => footGrid.contains(p);
  const crossesFootprint = (a, b) => footGrid.candidates([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist(a, b) / 2 + 1)
    .some((poly) => poly.rings.some((ring) => ring.some((r, k) => segmentsCross(a, b, r, ring[(k + 1) % ring.length]))));
  const pedNode = (n) => n.kind === "sidewalk" || n.kind === "crossing_end" || n.kind === "fallback";
  const preferred = (n) => n.kind === "sidewalk" || n.kind === "crossing_end";
  const edges = [];
  const nodes = [];
  const report = [];
  const tooClose = (p) => [...graph.nodes.values()].some((n) => dist(n.p, p) < 0.5);
  // a POI that sits on another node moves 0.6 m away from it (its own node, joined by a connector >= 0.5 m)
  const apart = (p) => {
    const near = graph.nearestNode(p, 0.5);
    if (!near) return p;
    const v = [p[0] - near.node.p[0], p[1] - near.node.p[1]];
    const l = Math.hypot(v[0], v[1]);
    const u = l > 1e-6 ? [v[0] / l, v[1] / l] : [0, 1];
    return [near.node.p[0] + u[0] * 0.6, near.node.p[1] + u[1] * 0.6];
  };

  const sidewalkEdge = (e) => e.kind === "sidewalk" && !e.link;
  // target on the pedestrian graph: the nearest point of a sidewalk centreline (a node is inserted there), else the
  // nearest crossing-end or fallback node; never closer than 0.5 m (the connector keeps the POI its own node)
  const targetFor = (nodeId, p, reach) => {
    const hit = graph.nearestOnEdges(p, reach, sidewalkEdge);
    if (hit && hit.d >= 0.5) return { at: hit.q, take: () => graph.snap(hit.q, 0.01, { filter: sidewalkEdge, nodeId: `SWN_${nodeId}`, nodeProps: { kind: "sidewalk", inserted_for: nodeId } }).id };
    const n = graph.nearestNode(p, reach, (m) => m.id !== nodeId && pedNode(m) && dist(m.p, p) >= 0.5);
    return n ? { at: n.node.p, take: () => n.node.id } : null;
  };
  const connect = (nodeId, p, kind, label, allowed, extra = {}) => {
    const base = { kind, poi: label, ...extra };
    const add = (points, to, flags) => {
      // a connector that leaves the walkable polygons (lawn between an apron and the nearest sidewalk) is not a
      // measured walkway: estimated, like the fallback
      const samples = sampleLine(points, 0.5);
      const walkShare = samples.filter(isWalkable).length / samples.length;
      if (!flags.estimated && walkShare < STRAIGHT_SHARE) flags = { ...flags, source: "derived_from_vehicle_network", estimated: true, derived: true, confidence: 0.3, authoritative: false, gap_reason: `connector leaves the walkable polygons (walkable share ${walkShare.toFixed(2)})` };
      const e = { id: `EDGE_POI_${nodeId}`, from: nodeId, to, points, ...flags, walkable_share: round(walkShare, 3), ...base };
      graph.addEdge(e);
      edges.push(e);
      return e;
    };
    const estimated = (reason) => ({ source: "derived_from_vehicle_network", estimated: true, derived: true, confidence: 0.2, authoritative: false, gap_reason: reason });
    const measured = { source: "GIS-derived", estimated: false, derived: false, confidence: 0.5, authoritative: false };
    const target = targetFor(nodeId, p, REACH_M);
    if (!target) {
      log(`${label} entrance unreachable within ${REACH_M} m`);
      const far = targetFor(nodeId, p, Infinity);
      const to = far.take();
      return add([p, graph.nodes.get(to).p], to, estimated(`no pedestrian node within ${REACH_M} m`));
    }
    const q = target.at;
    const samples = sampleLine([p, q], 0.5);
    const share = samples.filter(isWalkable).length / samples.length;
    const blocked = samples.slice(1, -1).some(inFootprint) || crossesFootprint(p, q);
    if (share >= STRAIGHT_SHARE && !blocked) {
      const to = target.take();
      return add([p, graph.nodes.get(to).p], to, { ...measured, route: "straight", walkable_share: round(share, 3) });
    }
    // around the apron ring of the nearest footprint, then straight to the graph
    const foot = footGrid.candidates(p, 5).map((poly) => ({ poly, d: inRings(p, poly.rings) ? 0 : nearestOnRing(p, poly.rings[0]).d })).sort((a, b) => a.d - b.d)[0];
    if (foot && foot.d <= 3) {
      const ring = offsetRing(foot.poly.rings[0], APRON_RING_M);
      const start = nearestOnRing(p, ring);
      let best = null;
      const perimeter = lineLength([...ring, ring[0]]);
      for (let s = 0; s < perimeter; s += 1) {
        // the ring point s metres along, and its best exit to the graph
        let acc = 0;
        let r = null;
        for (let i = 0; i < ring.length && !r; i += 1) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const l = dist(a, b);
          if (acc + l >= s) r = { q: [a[0] + ((b[0] - a[0]) * (s - acc)) / (l || 1), a[1] + ((b[1] - a[1]) * (s - acc)) / (l || 1)], seg: i };
          acc += l;
        }
        const t = targetFor(nodeId, r.q, REACH_M);
        if (!t || crossesFootprint(r.q, t.at)) continue;
        const pts = [p, ...ringPath(ring, start.q, start.seg, r.q, r.seg), t.at];
        if (sampleLine(pts, 0.5).slice(1, -1).some(inFootprint)) continue;
        const len = lineLength(pts);
        if (len <= REACH_M + perimeter && (!best || len < best.len)) best = { t, pts, len, r };
      }
      if (best) {
        const to = best.t.take();
        best.pts[best.pts.length - 1] = graph.nodes.get(to).p;
        const s2 = sampleLine(best.pts, 0.5);
        return add(best.pts, to, { ...measured, route: "apron_ring", walkable_share: round(s2.filter(isWalkable).length / s2.length, 3) });
      }
    }
    if (!blocked) {
      const to = target.take();
      return add([p, graph.nodes.get(to).p], to, { ...measured, route: "straight", walkable_share: round(share, 3) });
    }
    log(`${label} entrance unreachable within ${REACH_M} m (every way crosses a building)`);
    const to = target.take();
    return add([p, graph.nodes.get(to).p], to, estimated("connector crosses a building footprint"));
  };

  // ---- building entrances
  for (const ent of [...entrances].sort((a, b) => a.node_id.localeCompare(b.node_id))) {
    const hint = ent.position;
    const own = buildings.filter((b) => b.id === ent.building_id || String(b.id).startsWith(`${ent.building_id}.`));
    let p = hint;
    let positionSource = "building_entrances.json hint (no footprint found)";
    if (own.length) {
      let best = null;
      for (const b of own) {
        const r = nearestOnRing(hint, b.rings[0]);
        if (!best || r.d < best.r.d) best = { r, b };
      }
      const ring = offsetRing(best.b.rings[0], APRON_STEP_M);
      p = nearestOnRing(best.r.q, ring).q;
      positionSource = `footprint outline of ${best.b.id} nearest the derived hint, ${APRON_STEP_M} m out on the apron (estimated)`;
    }
    p = apart(p);
    graph.addNode(ent.node_id, p, { kind: "poi", poi_id: ent.building_id, estimated: true, position_source: positionSource });
    nodes.push(ent.node_id);
    const e = connect(ent.node_id, p, "building_entrance", ent.building_id, ent.allowed_types, { entrance_id: ent.entrance_id });
    report.push({ entrance_id: ent.entrance_id, building_id: ent.building_id, node_id: ent.node_id, snapped_node: e.to, connector: e.id, length_m: round(lineLength(e.points), 2), route: e.route ?? "estimated", moved_m: round(dist(hint, p), 2) });
  }
  // ---- gates, external roads and parking
  for (const poi of [...pois].sort((a, b) => a.node_id.localeCompare(b.node_id))) {
    const person = poi.allowed_types.includes("person");
    const car = poi.allowed_types.includes("car");
    const ok = (q) => (!person || isWalkable(q)) && (!car || roadGrid.contains(q));
    let best = null;
    if (!ok(poi.p)) {
      for (let r = 0.5; r <= PLACE_M && !best; r += 0.5) {
        for (let k = 0; k < Math.max(8, Math.round((2 * Math.PI * r) / 0.5)); k += 1) {
          const a = (2 * Math.PI * k) / Math.max(8, Math.round((2 * Math.PI * r) / 0.5));
          const q = [poi.p[0] + r * Math.cos(a), poi.p[1] + r * Math.sin(a)];
          if (ok(q) && !tooClose(q)) {
            best = q;
            break;
          }
        }
      }
    }
    let p = best ?? poi.p;
    const placed = best ? `nearest point within ${PLACE_M} m on ${[person && "walkable", car && "road"].filter(Boolean).join(" + ")} polygons` : ok(poi.p) ? "unchanged (already on its surface)" : `unchanged (no ${[person && "walkable", car && "road"].filter(Boolean).join(" + ")} point within ${PLACE_M} m)`;
    if (!best && !ok(poi.p)) log(`${poi.poi_id}: ${placed}`);
    p = apart(p);
    graph.addNode(poi.node_id, p, { kind: "poi", poi_id: poi.poi_id, estimated: true, position_source: placed });
    nodes.push(poi.node_id);
    if (person) {
      const e = connect(poi.node_id, p, KIND_FOR[poi.kind] ?? "pedestrian_gate", poi.poi_id, poi.allowed_types);
      report.push({ node_id: poi.node_id, poi_id: poi.poi_id, snapped_node: e.to, connector: e.id, length_m: round(lineLength(e.points), 2), route: e.route ?? "estimated", moved_m: round(dist(poi.p, p), 2) });
    } else {
      report.push({ node_id: poi.node_id, poi_id: poi.poi_id, snapped_node: null, connector: null, length_m: 0, route: "vehicle side only (todo 20)", moved_m: round(dist(poi.p, p), 2) });
    }
  }
  // ---- coincident nodes
  const all = [...graph.nodes.values()];
  let coincident = 0;
  for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) if (dist(all[i].p, all[j].p) <= 0.01) coincident += 1;
  const stats = {
    entrances: report.filter((r) => r.entrance_id).length, pois: report.filter((r) => !r.entrance_id).length,
    estimated: edges.filter((e) => e.estimated).length, maxConnectorM: round(Math.max(0, ...edges.map((e) => lineLength(e.points))), 2),
    apronRoutes: edges.filter((e) => e.route === "apron_ring").length, coincident,
  };
  return { nodes, edges, report, warnings, stats };
}

export const statsLine = (s) => `entrances ${s.entrances} connected, POIs ${s.pois} connected, estimated ${s.estimated}, apron-ring routes ${s.apronRoutes}, max connector ${s.maxConnectorM} m, coincident nodes ${s.coincident}`;

// Entrances and non-building POIs of the legacy network files.
export function poiInputs(entrancesJson, network) {
  const entrances = entrancesJson.buildings.flatMap((b) => b.entrances.map((e) => ({ building_id: b.building_id, entrance_id: e.entrance_id, node_id: e.node_id, position: [e.position[0], e.position[2]], allowed_types: e.allowed_types })));
  const entranceNodes = new Set(entrances.map((e) => e.node_id));
  const pois = network.features
    .filter((f) => f.properties.feature_type === "poi" && !entranceNodes.has(f.properties.node_id))
    .map((f) => ({ poi_id: f.properties.poi_id ?? f.id, kind: f.properties.kind, node_id: f.properties.node_id, allowed_types: f.properties.allowed_types, p: f.geometry.coordinates }));
  return { entrances, pois };
}

// ---------------------------------------------------------------- CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const { loadNetworkContext, readJson, PATHS } = await import("./context.mjs");
  const { buildSidewalks } = await import("./sidewalks.mjs");
  const { buildCrossings } = await import("./crossings.mjs");
  const { buildFallback } = await import("./fallback.mjs");
  const { NetGraph } = await import("./graph.mjs");
  const ctx = await loadNetworkContext();
  const placeholders = JSON.parse(ctx.elementsText).sidewalk_placeholders ?? [];
  const sidewalks = buildSidewalks({ walkways: ctx.walkways, roadSegments: ctx.roadSegments, placeholders, warn: () => {} });
  const graph = NetGraph.fromSidewalks(sidewalks);
  buildCrossings({ crosswalks: ctx.crossings, roads: ctx.roads, graph, strips: sidewalks.strips, kerbTouched: ctx.kerbs.touched, warn: () => {} });
  const walkable = walkablePolygons({ strips: sidewalks.strips, crossings: ctx.crossings, layers: ctx.layers });
  const { entrances, pois } = poiInputs(await readJson(PATHS.entrances), ctx.oldNetwork);
  const allPois = [...entrances.map((e) => ({ id: e.building_id, p: e.position })), ...pois.map((p) => ({ id: p.poi_id, p: p.p }))];
  buildFallback({ roads: ctx.roads, graph, coverage: sidewalks.coverage, pois: allPois, plazas: walkable.filter((w) => w.class === "plaza"), buildings: ctx.buildings, warn: () => {} });
  const result = buildConnectors({ entrances, pois, graph, walkable, roadPolygons: ctx.roads.polygons, buildings: ctx.buildings });
  console.log(statsLine(result.stats));
  for (const r of result.report) console.log(`  ${r.node_id} ${r.poi_id ?? r.building_id}: -> ${r.snapped_node} ${r.length_m} m (${r.route}), moved ${r.moved_m} m`);
  const previewPath = arg("--preview");
  if (previewPath) {
    const { renderPreview } = await import("./preview.mjs");
    await renderPreview({
      layers: [...ctx.roads.polygons.map((p) => ({ class: p.class, rings: p.rings })), ...walkable.map((w) => ({ class: w.class, rings: w.rings }))],
      edges: [...ctx.roads.edges.map((f) => ({ kind: "allowed_road", points: f.geometry.coordinates })), ...graph.edges.map((e) => ({ kind: e.kind, points: e.points, estimated: e.estimated }))],
      nodes: result.nodes.map((id) => graph.nodes.get(id)),
      points: result.nodes.map((id) => graph.nodes.get(id).p),
      out: path.resolve(previewPath),
      window: arg("--window"),
    });
    console.log(`preview ${previewPath}`);
  }
  process.exit(result.stats.coincident > 0 ? 1 : 0);
}

// Walkable paving plazas (PAVEDCOURT_*, network/surfaces.mjs walkablePlaza) that no person edge crosses get a plaza node
// inside and estimated pedestrian links (kind sidewalk: people only) to the nearest person nodes, one on each side
// where one exists within PLAZA_REACH_M (two links at least 90 deg apart) in the main person component (most POIs),
// so routes can cross the plaza. A link never
// cuts a building footprint; network/walkways.mjs re-draws a link that touches a road, lot or building, as for every
// estimated person edge.
const PLAZA_REACH_M = 80;
const PERSON_LINK_KINDS = new Set(["sidewalk", "crosswalk", "shared_path", "pedestrian_gate", "building_entrance", "parking_walk"]);
export function plazaLinks({ graph, walkable = [], roadPolygons = [], buildings = [] }) {
  const footGrid = new PolygonGrid(buildings, 20);
  const roadGrid = new PolygonGrid(roadPolygons.filter((p) => p.class === "road" || p.class === "lot"), 20);
  const cutsFootprint = (a, b) => footGrid.candidates([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist(a, b) / 2 + 1)
    .some((poly) => poly.rings.some((ring) => ring.some((r, k) => segmentsCross(a, b, r, ring[(k + 1) % ring.length]))));
  const out = [];
  for (const plaza of walkable.filter((w) => /^PAVEDCOURT_/.test(w.id ?? ""))) {
    const person = graph.edges.filter((e) => PERSON_LINK_KINDS.has(e.kind));
    if (person.some((e) => sampleLine(e.points, 0.5).some((q) => inRings(q, plaza.rings)))) continue;
    // an interior point: the 0.5 m grid point inside the plaza nearest its vertex mean, off buildings and roads
    const pts = plaza.rings[0];
    const c = [pts.reduce((t, q) => t + q[0], 0) / pts.length, pts.reduce((t, q) => t + q[1], 0) / pts.length];
    const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
    let at = null;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5) {
      const q = [x, z];
      if (!inRings(q, plaza.rings) || footGrid.contains(q) || roadGrid.contains(q)) continue;
      if (!at || dist(q, c) < dist(at, c)) at = q;
    }
    if (!at) continue;
    // only nodes of the main person component (the one holding the most POIs, then the most nodes): buildNetwork keeps
    // that one and prunes the others, with any link into them
    const uf = new UnionFind();
    for (const e of person) uf.union(e.from, e.to);
    const ends = new Set(person.flatMap((e) => [e.from, e.to]));
    const score = new Map();
    for (const id of ends) score.set(uf.find(id), (score.get(uf.find(id)) ?? 0) + (graph.nodes.get(id)?.kind === "poi" ? 1e6 : 1));
    const main = [...score.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const cands = [...ends].filter((id) => uf.find(id) === main).map((id) => graph.nodes.get(id)).filter((n) => n && n.kind !== "poi" && dist(n.p, at) <= PLAZA_REACH_M && dist(n.p, at) >= 0.5 && !cutsFootprint(at, n.p))
      .sort((m, n) => dist(m.p, at) - dist(n.p, at) || m.id.localeCompare(n.id));
    if (!cands.length) continue;
    const first = cands[0];
    const dir = (n) => Math.atan2(n.p[1] - at[1], n.p[0] - at[0]);
    const second = cands.find((n) => Math.abs(((dir(n) - dir(first) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) >= Math.PI / 2);
    const nodeId = `PLAZA_${plaza.id}`;
    graph.addNode(nodeId, at, { kind: "plaza", estimated: true, position_source: `inside ${plaza.id} (${plaza.source_ref}; estimated)` });
    [first, second].filter(Boolean).forEach((n, k) => {
      const e = { id: `EDGE_${nodeId}_${k + 1}`, from: nodeId, to: n.id, points: [at, n.p], kind: "sidewalk", source: "derived", derived: true, estimated: true, confidence: 0.3, authoritative: false, surface: "plaza", gap_reason: `walkable plaza ${plaza.id} joined to the nearest person node${second ? "s on two sides" : ""} (estimated)` };
      graph.addEdge(e);
      out.push(e);
    });
  }
  return { edges: out, stats: { plazas: new Set(out.map((e) => e.from)).size, links: out.length } };
}

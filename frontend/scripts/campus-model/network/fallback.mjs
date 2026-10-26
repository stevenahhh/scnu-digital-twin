#!/usr/bin/env bun
// Fallback `shared_path` edges only where no NGII A003 sidewalk exists (plan uhf-ground-roads-routing todo 18, draft
// D-4). Every fallback edge is `estimated: true`, `derived: true`, `confidence: 0.2`, `authoritative: false`,
// `source: "derived_from_vehicle_network"`: never a measured sidewalk. Simulation frame.
//
//   bun scripts/campus-model/network/fallback.mjs [--stats] [--preview <png>] [--window <name>] [--write]
//       [--max-run-share <percent>]   (exit 1 listing the retained runs when their share of the person network is above)
//
// Candidates:
//   road runs   every interior road edge (network/roads.mjs) sampled every SAMPLE_M; a sample is uncovered when no
//               sidewalk centreline lies within COVER_M and the A003 coverage is false at its nearest road-polygon edge
//               point; contiguous uncovered runs >= MIN_RUN_M become edges ON the road centreline (no buffered
//               polygon), `gap_reason: "no NGII A003 within 15 m"`, joined at each end to the nearest sidewalk or
//               crossing node within COVER_M; a run that lies inside a plaza or building-apron polygon gets
//               `surface: "plaza"`.
//   mouth joins sidewalk dead ends to the nearest node of another sidewalk component within COVER_M (a sidewalk cut at a
//               side-road mouth that has no crossing polygon).
//   island joins remaining person components to the main one by the shortest straight join <= ISLAND_M that crosses
//               no building footprint.
// Minimality: candidates are dropped greedily (longest first) while every essential node (sidewalk, crossing and POI
// anchor) stays in the component it had with all candidates present. Every uncovered run (kept or dropped) is listed in
// backend/simulation/data/sidewalk_gaps.geojson for human follow-up.
import path from "node:path";
import { simulationToTm } from "../../../src/geo/epsg5186.mjs";
import { LineGrid, PolygonGrid, UnionFind, dist, inRings, lineLength, nearestOnLine, round, sampleLine, segmentNearest, subLine } from "./geom.mjs";

export const SAMPLE_M = 2;
export const COVER_M = 15;
export const MIN_RUN_M = 10;
export const ISLAND_M = 40;
export const PERIMETER_REACH_M = 150;
export const LEAD = "NGII 1:1,000 sheet O6 / field survey";
const ESTIMATED = { source: "derived_from_vehicle_network", derived: true, estimated: true, confidence: 0.2, authoritative: false };

const segmentsCross = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b) && o(a, b, c) !== 0;
};

// roads: buildRoads() result; graph: NetGraph after crossings (mutated: retained candidates are added); coverage:
// sidewalks.coverage; pois: [{ id, p }] that must stay reachable; plazas: [{ rings }] (plaza and apron polygons);
// buildings: [{ rings }] footprints the island joins may not cross.
export function buildFallback({ roads, graph, coverage = () => false, pois = [], plazas = [], buildings = [], warn = console.warn }) {
  const warnings = [];
  const log = (m) => {
    warnings.push(m);
    warn(m);
  };
  const walkableNode = (n) => n.kind === "sidewalk" || n.kind === "crossing_end";
  const sidewalkLines = graph.edges.filter((e) => e.kind === "sidewalk").map((e) => ({ points: e.points, id: e.id }));
  if (!sidewalkLines.length) log("A003 missing entirely: every interior road edge is a fallback candidate");
  const swGrid = new LineGrid(sidewalkLines, 20);
  const roadPolys = new PolygonGrid(roads.polygons.filter((p) => p.class === "road" || p.class === "lot"), 20);
  const plazaGrid = new PolygonGrid(plazas, 20);
  const buildingGrid = new PolygonGrid(buildings, 20);
  const kerbPoint = (p) => {
    let best = null;
    for (const poly of roadPolys.candidates(p, 20)) {
      for (const ring of poly.rings) for (let i = 0; i + 1 < ring.length; i += 1) {
        const r = segmentNearest(p, ring[i], ring[i + 1]);
        if (!best || r.d < best.d) best = r;
      }
    }
    return best?.q ?? p;
  };
  const uncovered = (p) => !swGrid.nearest(p, COVER_M) && !coverage(...kerbPoint(p));

  // ---- 1. road runs (interior edges are candidates; perimeter OSM edges near the campus are only listed as gaps)
  const runs = [];
  const interiorPts = roads.edges.flatMap((f) => f.geometry.coordinates);
  const box = interiorPts.length ? [Math.min(...interiorPts.map((p) => p[0])) - PERIMETER_REACH_M, Math.min(...interiorPts.map((p) => p[1])) - PERIMETER_REACH_M, Math.max(...interiorPts.map((p) => p[0])) + PERIMETER_REACH_M, Math.max(...interiorPts.map((p) => p[1])) + PERIMETER_REACH_M] : null;
  const perimeter = (roads.perimeter?.edges ?? [])
    .filter((e) => box && e.points.some((p) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3]))
    .map((e) => ({ id: e.id, geometry: { coordinates: e.points }, properties: { road_id: e.road_id ?? null, from_node: e.from, to_node: e.to, osm_way: e.osm_way }, perimeter: true }));
  for (const f of [...roads.edges, ...perimeter]) {
    const pts = f.geometry.coordinates;
    const total = lineLength(pts);
    if (total < 1e-6) continue;
    const n = Math.max(1, Math.round(total / SAMPLE_M));
    const flags = [];
    for (let k = 0; k <= n; k += 1) {
      const s = (total * k) / n;
      const p = subLine(pts, s, s)[0] ?? pts.at(-1);
      flags.push({ s, p, open: uncovered(p) });
    }
    for (let i = 0; i < flags.length;) {
      if (!flags[i].open) { i += 1; continue; }
      let j = i;
      while (j + 1 < flags.length && flags[j + 1].open) j += 1;
      // the run reaches back to the last covered sample on each side, so it meets the covered stretch
      const s0 = flags[Math.max(0, i - 1)].s;
      const s1 = flags[Math.min(flags.length - 1, j + 1)].s;
      if (flags[j].s - flags[i].s >= MIN_RUN_M - 1e-9) runs.push({ road: f, s0, s1, points: subLine(pts, s0, s1), atStart: s0 <= 1e-9, atEnd: s1 >= total - 1e-9, perimeter: Boolean(f.perimeter) });
      i = j + 1;
    }
  }
  // ---- candidate graph (a working copy)
  const work = graph.clone();
  const candidates = [];
  const posKey = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const fbNodeAt = new Map();
  let fbCount = 0;
  const fbNode = (p, roadNode) => {
    const key = roadNode ? `road:${roadNode}` : posKey(p);
    if (fbNodeAt.has(key)) return fbNodeAt.get(key);
    const id = roadNode ? `FBN_${roadNode}` : `FBN_${String((fbCount += 1)).padStart(4, "0")}`;
    work.addNode(id, p, { kind: "fallback" });
    fbNodeAt.set(key, id);
    return id;
  };
  runs.forEach((run, i) => {
    if (run.perimeter) return;
    const props = run.road.properties;
    const a = fbNode(run.points[0], run.atStart ? props.from_node : null);
    const b = fbNode(run.points.at(-1), run.atEnd ? props.to_node : null);
    const plazaShare = sampleLine(run.points, 1).filter((p) => plazaGrid.contains(p)).length / sampleLine(run.points, 1).length;
    const edge = {
      id: `EDGE_FB_${String(i + 1).padStart(4, "0")}`, from: a, to: b, points: run.points, kind: "shared_path", ...ESTIMATED,
      road_id: props.road_id ?? null, source_ref: run.road.id, gap_reason: "no NGII A003 within 15 m", ...(plazaShare >= 0.5 ? { surface: "plaza" } : {}),
    };
    work.addEdge(edge);
    run.edge = edge;
    candidates.push({ type: "run", edges: [edge], length: lineLength(run.points), run });
  });
  // joins of run ends that are not at an intersection shared with another run
  const joinCount = new Map();
  const joinEdge = (from, to, reason, extra = {}) => {
    const n = (joinCount.get(from) ?? 0) + 1;
    joinCount.set(from, n);
    const e = { id: `EDGE_FBJ_${from}_${n}`, from, to, points: [work.nodes.get(from).p, work.nodes.get(to).p], kind: "shared_path", ...ESTIMATED, gap_reason: reason, ...extra };
    work.addEdge(e);
    return e;
  };
  for (const c of candidates.filter((x) => x.type === "run")) {
    for (const end of [c.edges[0].from, c.edges[0].to]) {
      const node = work.nodes.get(end);
      const near = work.nearestNode(node.p, COVER_M, walkableNode);
      if (near && near.d > 0.01) c.edges.push(joinEdge(end, near.node.id, "fallback run end joined to the nearest sidewalk node", { road_id: c.edges[0].road_id }));
    }
  }
  // ---- 2. mouth joins: sidewalk dead ends to another sidewalk component within COVER_M
  const degree = new Map();
  for (const e of work.edges) for (const n of [e.from, e.to]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const comp0 = work.components((e) => e.kind === "sidewalk" || e.kind === "crosswalk");
  for (const node of [...work.nodes.values()].filter((n) => (n.kind === "sidewalk" || n.kind === "crossing_end") && (degree.get(n.id) ?? 0) <= 1).sort((a, b) => a.id.localeCompare(b.id))) {
    const own = comp0.get(node.id) ?? node.id;
    const near = work.nearestNode(node.p, COVER_M, (m) => walkableNode(m) && (comp0.get(m.id) ?? m.id) !== own);
    if (!near) continue;
    const e = joinEdge(node.id, near.node.id, node.kind === "crossing_end" ? "crossing end without A003, joined to the nearest sidewalk" : "sidewalk gap without a crossing polygon (side-road mouth)");
    candidates.push({ type: "mouth", edges: [e], length: lineLength(e.points) });
  }
  // ---- 3. island joins
  const personEdge = () => true;
  const essentials = [...work.nodes.values()].filter(walkableNode).map((n) => n.id);
  const anchors = pois.map((poi) => ({ poi, node: work.nearestNode(poi.p, 50, (n) => walkableNode(n))?.node.id ?? work.nearestNode(poi.p, 80)?.node.id ?? null }));
  for (const a of anchors) if (!a.node) log(`POI ${a.poi.id}: no person node within 80 m`);
  for (let guard = 0; guard < 200; guard += 1) {
    const comp = work.components(personEdge);
    const label = (id) => comp.get(id) ?? id;
    const sizes = new Map();
    for (const e of work.edges) sizes.set(label(e.from), (sizes.get(label(e.from)) ?? 0) + lineLength(e.points));
    for (const a of anchors) if (a.node) sizes.set(label(a.node), (sizes.get(label(a.node)) ?? 0) + 1e6);
    const main = [...sizes.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const islandNodes = [...work.nodes.values()].filter((n) => (walkableNode(n) || n.kind === "fallback") && label(n.id) !== main && (comp.has(n.id) || walkableNode(n)));
    if (!islandNodes.length) break;
    const mainNodes = [...work.nodes.values()].filter((n) => label(n.id) === main);
    let best = null;
    for (const a of islandNodes) {
      for (const b of mainNodes) {
        const d = dist(a.p, b.p);
        if (d > ISLAND_M || (best && d >= best.d)) continue;
        const crosses = buildingGrid.candidates([(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2], d / 2 + 1).some((poly) => poly.rings.some((ring) => ring.some((r, k) => segmentsCross(a.p, b.p, r, ring[(k + 1) % ring.length]))));
        if (!crosses) best = { a, b, d };
      }
    }
    if (!best) break;
    const e = joinEdge(best.a.id, best.b.id, "isolated sidewalk joined to the main network (no A003 between)");
    candidates.push({ type: "island", edges: [e], length: best.d });
  }
  // ---- 4. minimality
  const partition = (removed) => {
    const uf = new UnionFind();
    for (const e of work.edges) if (!removed.has(e)) uf.union(e.from, e.to);
    return uf;
  };
  const full = partition(new Set());
  const keyNodes = [...new Set([...essentials, ...anchors.map((a) => a.node).filter(Boolean)])];
  const fullLabel = new Map(keyNodes.map((n) => [n, full.find(n)]));
  const groups = new Map();
  for (const n of keyNodes) {
    const g = fullLabel.get(n);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(n);
  }
  const removed = new Set();
  const order = [...candidates].sort((a, b) => b.length - a.length || a.edges[0].id.localeCompare(b.edges[0].id));
  const dropped = [];
  for (const c of order) {
    for (const e of c.edges) removed.add(e);
    const uf = partition(removed);
    const intact = [...groups.values()].every((members) => members.every((m) => uf.find(m) === uf.find(members[0])));
    if (intact) dropped.push(c);
    else for (const e of c.edges) removed.delete(e);
  }
  const keptCandidates = candidates.filter((c) => !dropped.includes(c));
  // retained edges into the real graph (nodes they need first)
  const keptEdges = keptCandidates.flatMap((c) => c.edges).filter((e) => !removed.has(e));
  for (const e of keptEdges) for (const id of [e.from, e.to]) if (!graph.nodes.has(id)) graph.addNode(id, work.nodes.get(id).p, { kind: work.nodes.get(id).kind });
  // a run end join may have pointed at a node that only exists in `work` because a split happened there: none happen here
  for (const e of keptEdges) graph.addEdge(e);
  const personLength = graph.edges.reduce((s, e) => s + lineLength(e.points), 0);
  const keptLength = keptEdges.reduce((s, e) => s + lineLength(e.points), 0);
  const gaps = runs.map((run) => ({
    road_id: run.road.properties.road_id ?? null, road_edge: run.road.id, road_kind: run.perimeter ? "perimeter (OSM, ODbL)" : "interior", length_m: round(lineLength(run.points), 1), points: run.points,
    retained: keptCandidates.some((c) => c.run === run), lead: LEAD,
  }));
  const comps = graph.components();
  const compSizes = new Map();
  for (const e of graph.edges) compSizes.set(comps.get(e.from), (compSizes.get(comps.get(e.from)) ?? 0) + lineLength(e.points));
  const mainComp = [...compSizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const [c, l] of compSizes) if (c !== mainComp) log(`person component at ${c} (${l.toFixed(0)} m) stays apart: no join <= ${ISLAND_M} m that crosses no building`);
  const stats = {
    runs: runs.length, retainedRuns: keptCandidates.filter((c) => c.type === "run").length, retainedM: round(keptLength, 1),
    sharePct: personLength ? round((100 * keptLength) / personLength, 2) : 0, dropped: dropped.length,
    mouthJoins: keptCandidates.filter((c) => c.type === "mouth").length, islandJoins: keptCandidates.filter((c) => c.type === "island").length,
    personComponents: new Set(comps.values()).size, gapRuns: gaps.length, gapM: round(gaps.reduce((s, g) => s + g.length_m, 0), 1),
  };
  log(`retained ${stats.retainedRuns} runs, ${stats.retainedM} m (all fallback edges, ${stats.sharePct} % of person network length); dropped ${stats.dropped}`);
  return { edges: keptEdges, gaps, stats, warnings, retained: keptCandidates };
}

export const statsLine = (s) => `retained ${s.retainedRuns} runs, ${s.retainedM} m (${s.sharePct} % of person network length), dropped ${s.dropped}; mouth joins ${s.mouthJoins}, island joins ${s.islandJoins}; uncovered runs ${s.gapRuns} (${s.gapM} m); person components ${s.personComponents}`;

export function gapsCollection(gaps) {
  return {
    type: "FeatureCollection",
    metadata: {
      generator: "frontend/scripts/campus-model/network/fallback.mjs", coordinate_system: "local meters, x=east, z=north (D4 anchor; src/geo/epsg5186.mjs)",
      description: "road runs with no NGII A003 sidewalk within 15 m (sidewalk gaps); `retained` runs carry estimated shared_path edges", lead: LEAD,
    },
    features: gaps.map((g, i) => ({
      type: "Feature", id: `GAP_${String(i + 1).padStart(3, "0")}`, geometry: { type: "LineString", coordinates: g.points.map((p) => p.map((v) => round(v))) },
      properties: { id: `GAP_${String(i + 1).padStart(3, "0")}`, road_id: g.road_id, road_edge: g.road_edge, road_kind: g.road_kind, length_m: g.length_m, retained: g.retained, lead: g.lead, estimated: true, epsg5186: g.points.map(([x, z]) => simulationToTm({ x, z }).map((v) => round(v))) },
    })),
  };
}

void inRings;
void nearestOnLine;

// ---------------------------------------------------------------- CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const { loadNetworkContext, REPO } = await import("./context.mjs");
  const { buildSidewalks } = await import("./sidewalks.mjs");
  const { buildCrossings } = await import("./crossings.mjs");
  const { NetGraph } = await import("./graph.mjs");
  const { simulationToWgs84 } = await import("../../../src/geo/epsg5186.mjs");
  const ctx = await loadNetworkContext();
  const placeholders = JSON.parse(ctx.elementsText).sidewalk_placeholders ?? [];
  const sidewalks = buildSidewalks({ walkways: ctx.walkways, roadSegments: ctx.roadSegments, placeholders, warn: () => {} });
  const graph = NetGraph.fromSidewalks(sidewalks);
  buildCrossings({ crosswalks: ctx.crossings, roads: ctx.roads, graph, kerbTouched: ctx.kerbs.touched, warn: () => {} });
  const pois = ctx.oldNetwork.features.filter((f) => f.properties.feature_type === "poi").map((f) => ({ id: f.properties.poi_id ?? f.id, p: f.geometry.coordinates }));
  const plazas = ctx.layers.filter((l) => (l.precedence === 2 || l.precedence === 6) && l.cls === "PAVING").map((l) => ({ rings: l.rings }));
  const result = buildFallback({ roads: ctx.roads, graph, coverage: sidewalks.coverage, pois, plazas, buildings: ctx.buildings, warn: () => {} });
  console.log(statsLine(result.stats));
  const south = result.gaps.filter((g) => {
    const [x, z] = g.points[Math.floor(g.points.length / 2)];
    return simulationToWgs84({ x, z })[1] < 34.9662;
  });
  console.log(`gaps with a centroid south of latitude 34.9662: ${south.length}`);
  const previewPath = arg("--preview");
  if (previewPath) {
    const { renderPreview } = await import("./preview.mjs");
    await renderPreview({
      layers: [...ctx.roads.polygons.map((p) => ({ class: p.class, rings: p.rings })), ...sidewalks.strips.map((s) => ({ class: "sidewalk", rings: s.rings })), ...ctx.crossings.map((c) => ({ class: "crossing", rings: [c.ring] }))],
      edges: [...ctx.roads.edges.map((f) => ({ kind: "allowed_road", points: f.geometry.coordinates })), ...graph.edges.map((e) => ({ kind: e.kind, points: e.points, estimated: e.estimated }))],
      points: pois.map((p) => p.p),
      out: path.resolve(previewPath),
      window: arg("--window"),
    });
    console.log(`preview ${previewPath}`);
  }
  if (args.includes("--write")) {
    const out = path.join(REPO, "backend/simulation/data/sidewalk_gaps.geojson");
    await Bun.write(out, `${JSON.stringify(gapsCollection(result.gaps), null, 2)}\n`);
    console.log(`written ${path.relative(REPO, out)} (${result.gaps.length} runs)`);
  }
  const maxShare = arg("--max-run-share");
  if (maxShare !== null && result.stats.sharePct > Number(maxShare)) {
    console.error(`fallback share ${result.stats.sharePct} % > --max-run-share ${maxShare} %; retained runs:`);
    for (const c of result.retained) console.error(`  ${c.type} ${c.edges.map((e) => e.id).join("+")} ${round(c.length, 1)} m${c.run ? ` on ${c.run.road.id} (${c.run.road.properties.road_id ?? "no RD_"})` : ""}`);
    process.exit(1);
  }
}

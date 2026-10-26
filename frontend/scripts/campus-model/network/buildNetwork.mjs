#!/usr/bin/env bun
// Separated pedestrian / vehicle transport network (plan uhf-ground-roads-routing todo 20): composes the A003 sidewalks
// (todo 15), the crossings (todo 16), the vehicle centrelines (todo 17), the estimated fallback (todo 18) and the POI
// connectors (todo 19) into backend/simulation/data/campus_transport_network.geojson, add-only against the previous
// file (every top-level key and every per-feature property name of each feature_type is kept; the builder fails when
// one is missing), plus the trace-oracle polygons walkable_polygons.geojson (sidewalk | crossing | plaza) and
// road_polygons.geojson (road | lot). Simulation frame: metres east/north of the D4 anchor in EPSG:5186 TM.
//
//   bun run network:build                 (= bun scripts/campus-model/network/buildNetwork.mjs)
//   bun scripts/campus-model/network/buildNetwork.mjs [--dry-run] [--extra-edges <geojson>]
//
// The first run copies the previous network byte for byte to campus_transport_network.derived-v1.geojson (the
// baseline of todo 25 and the PR images). Perimeter edges come from backend/simulation/data/osm/perimeter_roads.geojson
// (ODbL; metadata.licence_ref points at it). coordinate_transform.json gains `epsg5186_anchor` (add-only).
// Then: cd backend && ../.venv/bin/python -m simulation.tools.validate_network && ../.venv/bin/python -m
// simulation.tools.build_conflict_areas.
import path from "node:path";
import { D4_ANCHOR_TM } from "../../../src/geo/epsg5186.mjs";
import { LineGrid, PolygonGrid, UnionFind, dist, lineLength, round, sampleLine, segmentNearest } from "./geom.mjs";

const PERSON_KINDS = new Set(["sidewalk", "crosswalk", "shared_path", "pedestrian_gate", "building_entrance", "parking_walk"]);
const SPEED = { sidewalk: 12, crosswalk: 10, shared_path: 12, building_entrance: 8, pedestrian_gate: 12, parking_walk: 12, vehicle_gate: 12, parking_connection: 12, scooter_parking_connection: 12 };
const LEGACY_KIND = { allowed_road: "road", shared_path: "shared_path_derived", vehicle_gate: "gate_vehicle", scooter_parking_connection: "scooter_parking" };
const PERI_MERGE_M = 0.5;
const PERI_LINK_M = 15;
const PERI_T_M = 1;
const PERI_LINK_FAR_M = 40; // a longer join is taken only when it stays on road polygons
const KERB_REACH_M = 2;
const NODE_MERGE_M = 0.001;

// Property names per feature_type (and top-level keys) of a FeatureCollection.
export function propertyNames(fc) {
  const out = {};
  for (const f of fc.features) {
    const t = f.properties.feature_type ?? "edge";
    out[t] ??= new Set();
    for (const k of Object.keys(f.properties)) out[t].add(k);
  }
  return out;
}

// Structural checks before anything is written: superset of the old property names per feature_type and top-level
// keys, unique ids, edge endpoints present, allowed_types equal to the policy of the kind.
export function checkCollection(fc, old, policy) {
  const errors = [];
  for (const key of Object.keys(old)) if (key !== "features" && !(key in fc)) errors.push(`top-level key ${key} missing`);
  for (const key of Object.keys(old.metadata ?? {})) if (!(key in (fc.metadata ?? {}))) errors.push(`metadata.${key} missing`);
  // every property name the old file used per feature_type is still used, and a feature kept under its old id keeps
  // every property it had
  const oldNames = propertyNames(old);
  const newNames = propertyNames(fc);
  for (const [t, names] of Object.entries(oldNames)) for (const k of names) if (!newNames[t]?.has(k)) errors.push(`${t} property ${k} missing from every feature`);
  const oldById = new Map(old.features.map((f) => [`${f.properties.feature_type}:${f.id}`, f]));
  for (const f of fc.features) {
    const before = oldById.get(`${f.properties.feature_type}:${f.id}`);
    if (before) for (const k of Object.keys(before.properties)) if (!(k in f.properties)) errors.push(`${f.id}: property ${k} missing`);
  }
  const ids = new Set();
  const nodes = new Set();
  for (const f of fc.features) {
    if (ids.has(`${f.properties.feature_type}:${f.id}`)) errors.push(`duplicate id ${f.id}`);
    ids.add(`${f.properties.feature_type}:${f.id}`);
    if (f.properties.feature_type === "node") nodes.add(f.id);
  }
  for (const f of fc.features.filter((x) => x.properties.feature_type === "edge")) {
    const p = f.properties;
    if (!p.from_node || !p.to_node) errors.push(`${f.id}: from_node/to_node missing`);
    else if (!nodes.has(p.from_node) || !nodes.has(p.to_node)) errors.push(`${f.id}: unknown node ${p.from_node} / ${p.to_node}`);
    const rule = policy.kinds[p.kind];
    if (!rule) errors.push(`${f.id}: unknown kind ${p.kind}`);
    else if ([...rule.allowed_types].sort().join() !== [...(p.allowed_types ?? [])].sort().join()) errors.push(`${f.id}: allowed_types ${p.allowed_types} != policy ${rule.allowed_types}`);
    if (Boolean(p.derived) !== Boolean(p.estimated)) errors.push(`${f.id}: derived ${p.derived} but estimated ${p.estimated}`);
  }
  return errors;
}

const nullNode = { poi_id: null, road_id: null, source_route_id: null };

// roads: buildRoads() result (interior features + perimeter); graph: NetGraph of the pedestrian side after crossings,
// fallback and connectors; pois: the old POI features; kerbPieces: [{ points, height_m }] (simulation frame);
// policy: mobility_policy.json; old: the previous network FC (property names and metadata keys).
export function assembleNetwork({ roads, graph, pois, kerbPieces = [], policy, old, roadPolygons = null, sidewalkPolygons = [], perimeterRef = "backend/simulation/data/osm/perimeter_roads.geojson", log = console.log }) {
  const nodes = new Map(); // id -> { id, p, props }
  const edges = []; // { id, from, to, points, props }
  const addNode = (id, p, props) => {
    if (nodes.has(id)) throw new Error(`duplicate node id ${id}`);
    nodes.set(id, { id, p, props });
  };
  // ---- vehicle side: interior
  for (const f of roads.nodes) addNode(f.id, f.geometry.coordinates, { ...nullNode, ...f.properties, road_id: f.id.startsWith("ND_") ? f.id : null });
  for (const f of roads.edges) edges.push({ id: f.id, from: f.properties.from_node, to: f.properties.to_node, points: f.geometry.coordinates, props: { ...f.properties } });
  // ---- vehicle side: perimeter (OSM, ODbL), coincident run ends merged, run ends joined to the interior within 15 m
  const peri = roads.perimeter ?? { nodes: [], edges: [] };
  const puf = new UnionFind();
  for (let i = 0; i < peri.nodes.length; i += 1) for (let j = i + 1; j < peri.nodes.length; j += 1) if (dist(peri.nodes[i].p, peri.nodes[j].p) <= PERI_MERGE_M) puf.union(peri.nodes[i].id, peri.nodes[j].id);
  const periRep = (id) => puf.find(id);
  // only the parts of a perimeter edge that lie on the road polygons (the strips traced inside the model extent) are
  // kept: outside them there is no road surface to check a car against
  const roadGrid = roadPolygons ? new PolygonGrid(roadPolygons, 20) : null;
  const onRoadPt = (q) => !roadGrid || roadGrid.contains(q);
  const sidewalkGrid = new PolygonGrid(sidewalkPolygons, 20);
  const carSurface = (q) => roadGrid.contains(q) && !sidewalkGrid.contains(q);
  const periNode = (nid, p) => {
    if (!nodes.has(nid)) addNode(nid, p, { ...nullNode, kind: "road_end", source: "OSM-derived", confidence: 0.5, derived: true, authoritative: false, estimated: true });
    return nid;
  };
  let clipped = 0;
  for (const e of peri.edges) {
    const dense = sampleLine(e.points, 1);
    const inside = dense.map(onRoadPt);
    let k = 0;
    for (let i = 0; i < dense.length;) {
      if (!inside[i]) { i += 1; continue; }
      let j = i;
      while (j + 1 < dense.length && inside[j + 1]) j += 1;
      const part = dense.slice(i, j + 1);
      if (lineLength(part) >= 5) {
        const a = i === 0 ? periNode(periRep(e.from), peri.nodes.find((n) => n.id === periRep(e.from))?.p ?? part[0]) : periNode(`${e.id.replace("EDGE_OSM_", "PERI_")}_${k}a`, part[0]);
        const b = j === dense.length - 1 ? periNode(periRep(e.to), peri.nodes.find((n) => n.id === periRep(e.to))?.p ?? part.at(-1)) : periNode(`${e.id.replace("EDGE_OSM_", "PERI_")}_${k}b`, part.at(-1));
        if (i === 0) part[0] = nodes.get(a).p;
        if (j === dense.length - 1) part[part.length - 1] = nodes.get(b).p;
        edges.push({
          id: k === 0 && i === 0 && j === dense.length - 1 ? e.id : `${e.id}_${k}`, from: a, to: b, points: part,
          props: { kind: "allowed_road", legacy_kind: "road", allowed_types: ["car", "scooter"], bidirectional: true, speed_limit: 30, road_ids: e.road_id ? [e.road_id] : [], road_id: e.road_id, crosswalk_id: null, lanes: e.lanes, lanes_source: e.lanes_source, width_m: e.width_m, width_source: e.width_source, source: "OSM-derived", source_ref: e.osm_way, external_ids: { osm_way: e.osm_way }, confidence: 0.5, authoritative: false, derived: true, estimated: true, licence_ref: perimeterRef },
        });
        k += 1;
      } else clipped += 1;
      i = j + 1;
    }
  }
  // OSM ways meet mid-way (a connector ends on a vertex inside the arterial run): split the run there
  const periEdges = () => edges.filter((e) => e.props.source === "OSM-derived");
  for (let guard = 0; guard < 400; guard += 1) {
    const deg = new Map();
    for (const e of periEdges()) for (const n of [e.from, e.to]) deg.set(n, (deg.get(n) ?? 0) + 1);
    let hit = null;
    for (const [nid, d] of deg) {
      if (d !== 1) continue;
      const p = nodes.get(nid).p;
      for (const e of periEdges()) {
        if (e.from === nid || e.to === nid) continue;
        for (let i = 0; i + 1 < e.points.length; i += 1) {
          const r = segmentNearest(p, e.points[i], e.points[i + 1]);
          if (r.d <= PERI_T_M && dist(r.q, e.points[0]) > 0.5 && dist(r.q, e.points.at(-1)) > 0.5 && (!hit || r.d < hit.d)) hit = { nid, e, i, d: r.d };
        }
      }
      if (hit) break;
    }
    if (!hit) break;
    const { nid, e, i } = hit;
    const p = nodes.get(nid).p;
    const k = edges.indexOf(e);
    edges.splice(k, 1, { ...e, id: `${e.id}a${guard}`, to: nid, points: [...e.points.slice(0, i + 1), p] }, { ...e, id: `${e.id}b${guard}`, from: nid, points: [p, ...e.points.slice(i + 1)] });
  }
  const interiorIds = roads.nodes.map((f) => f.id);
  const degree = new Map();
  for (const e of edges) for (const n of [e.from, e.to]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const onRoad = (a, b) => !roadGrid || sampleLine([a, b], 0.5).filter((q) => roadGrid.contains(q)).length / sampleLine([a, b], 0.5).length >= 0.95;
  for (const n of [...nodes.values()].filter((x) => x.props.source === "OSM-derived" && degree.get(x.id) === 1)) {
    let best = null;
    for (const id of interiorIds) {
      const d = dist(nodes.get(id).p, n.p);
      if ((d <= PERI_LINK_M || (d <= PERI_LINK_FAR_M && onRoad(n.p, nodes.get(id).p))) && (!best || d < best.d)) best = { id, d };
    }
    if (!best || best.d < 0.01) continue;
    edges.push({ id: `EDGE_OSMLINK_${n.id}`, from: n.id, to: best.id, points: [n.p, nodes.get(best.id).p], props: { kind: "allowed_road", legacy_kind: "road", allowed_types: ["car", "scooter"], bidirectional: true, speed_limit: 20, road_ids: [], road_id: null, crosswalk_id: null, source: "OSM-derived", source_ref: `${n.id} -> ${best.id}`, confidence: 0.3, authoritative: false, derived: true, estimated: true, gap_reason: "perimeter road end joined to the campus road network", licence_ref: perimeterRef } });
  }
  // ---- pedestrian side
  const rename = new Map(); // FBN_<road node> -> the road node itself (same position)
  for (const n of graph.nodes.values()) {
    const base = n.id.startsWith("FBN_") ? n.id.slice(4) : null;
    if (base && nodes.has(base) && dist(nodes.get(base).p, n.p) <= 0.01) {
      rename.set(n.id, base);
      continue;
    }
    const kind = n.kind === "poi" ? null : n.kind === "crossing_end" ? "crosswalk" : n.kind;
    const poiFeature = n.kind === "poi" ? pois.find((f) => f.properties.node_id === n.id) : null;
    const oldNode = n.kind === "poi" ? old.features.find((f) => f.properties.feature_type === "node" && f.id === n.id) : null;
    addNode(n.id, n.p, {
      ...nullNode, kind: kind ?? oldNode?.properties.kind ?? poiFeature?.properties.kind ?? "poi", poi_id: n.poi_id ?? null, road_id: n.sidewalk_id ?? n.crosswalk_id ?? null,
      source: n.kind === "sidewalk" ? "NGII-A003" : n.kind === "fallback" ? "derived_from_vehicle_network" : n.kind === "crossing_end" ? "ortho-traced" : "GIS-derived",
      confidence: n.kind === "fallback" ? 0.2 : 0.5, derived: n.kind === "fallback", authoritative: n.kind === "sidewalk" || n.kind === "crossing_end", estimated: n.kind === "fallback" || Boolean(n.estimated),
      ...(n.position_source ? { position_source: n.position_source } : {}), ...(n.inserted_for ? { inserted_for: n.inserted_for } : {}),
    });
  }
  const id = (n) => rename.get(n) ?? n;
  for (const e of graph.edges) {
    const { id: eid, from, to, points, kind, ...rest } = e;
    delete rest.poi;
    const roadIds = kind === "crosswalk" ? [e.crosswalk_id, e.road_id].filter(Boolean) : kind === "sidewalk" ? [e.sidewalk_id] : e.road_id ? [e.road_id] : [];
    edges.push({ id: eid, from: id(from), to: id(to), points, props: { ...rest, kind, legacy_kind: LEGACY_KIND[kind] ?? kind, allowed_types: [...policy.kinds[kind].allowed_types], bidirectional: true, speed_limit: SPEED[kind] ?? 10, road_ids: roadIds, crosswalk_id: e.crosswalk_id ?? null, road_id: e.road_id ?? null } });
  }
  // ---- vehicle-side POI links, to the car component of the campus roads (the largest)
  const carUf = new UnionFind();
  const carLen = new Map();
  for (const e of edges.filter((x) => x.props.allowed_types.includes("car"))) carUf.union(e.from, e.to);
  // measured campus roads decide (the OSM perimeter can be longer)
  for (const e of edges.filter((x) => x.props.allowed_types.includes("car") && x.props.source !== "OSM-derived")) carLen.set(carUf.find(e.from), (carLen.get(carUf.find(e.from)) ?? 0) + lineLength(e.points));
  const carMain = [...carLen.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const cars = new Set();
  for (const e of edges) if (e.props.allowed_types.includes("car") && carUf.find(e.from) === carMain) { cars.add(e.from); cars.add(e.to); }
  for (const f of pois) {
    const allowed = f.properties.allowed_types ?? [];
    const kind = f.properties.kind;
    const node = nodes.get(f.properties.node_id);
    if (!node) continue;
    const link = kind === "parking" ? "parking_connection" : kind === "scooter_parking" ? "scooter_parking_connection" : (kind === "gate" || kind === "external") && allowed.includes("car") ? "vehicle_gate" : null;
    if (!link) continue;
    let best = null;
    // a car POI joins a road node that itself lies on car surface (not an OSM run end outside the road polygons)
    const carNodeOk = (cid) => !roadGrid || !allowed.includes("car") || carSurface(nodes.get(cid).p);
    for (const cid of cars) {
      const d = dist(nodes.get(cid).p, node.p);
      if (carNodeOk(cid) && (!best || d < best.d)) best = { cid, d };
    }
    if (!best) continue;
    const pts = best.d < 0.5 ? [node.p, [node.p[0] + 0.5, node.p[1]]] : [node.p, nodes.get(best.cid).p];
    if (best.d < 0.5) throw new Error(`${node.id} coincides with ${best.cid}`);
    // (W4 b) a POI shared by cars and people gets its own vehicle anchor: cars start, dwell and leave on the road or
    // lot (inside a road/lot polygon, off the sidewalk), people at the POI node on walkable ground
    if (allowed.includes("person") && allowed.includes("car") && roadGrid) {
      // the anchor starts the longest stretch next to the road node that lies wholly on car surface
      const along = sampleLine([node.p, nodes.get(best.cid).p], 0.25);
      let at = along.length;
      while (at > 0 && carSurface(along[at - 1])) at -= 1;
      const vid = `${node.id}_V`;
      if (at + 2 < along.length && dist(along[at + 2], nodes.get(best.cid).p) >= 0.5) {
        addNode(vid, along[at + 2], { ...nullNode, kind: "vehicle_anchor", poi_id: f.id, source: "GIS-derived", confidence: 0.3, derived: true, authoritative: false, estimated: true, position_source: `first point on the road/lot polygon along the vehicle access of ${f.id} (estimated)` });
        f.properties.vehicle_node_id = vid;
        pts[0] = along[at + 2];
        edges.push({ id: `EDGE_POIV_${node.id}`, from: best.cid, to: vid, points: pts.slice().reverse(), props: { kind: link, legacy_kind: LEGACY_KIND[link] ?? link, allowed_types: [...policy.kinds[link].allowed_types], bidirectional: true, speed_limit: SPEED[link], road_ids: [], road_id: null, crosswalk_id: null, source_ref: `${f.id} vehicle access`, source: "GIS-derived", confidence: 0.3, authoritative: false, derived: true, estimated: true, gap_reason: "vehicle anchor of a POI shared with pedestrians", road_share: 1, poi_id: f.id } });
      } else {
        // no road/lot surface between the POI and the road network: cars use the road node itself
        f.properties.vehicle_node_id = best.cid;
      }
      continue;
    }
    // a link that leaves the road polygons is an estimate of the access, not a measured carriageway
    const linkSamples = sampleLine(pts, 0.5);
    const roadShare = roadGrid ? linkSamples.filter((q) => roadGrid.contains(q)).length / linkSamples.length : 1;
    const flags = roadShare >= 0.95
      ? { source: "GIS-derived", confidence: 0.4, authoritative: false, derived: false, estimated: false }
      : { source: "derived_from_vehicle_network", confidence: 0.3, authoritative: false, derived: true, estimated: true, gap_reason: `vehicle access leaves the road polygons (road share ${roadShare.toFixed(2)})` };
    edges.push({ id: `EDGE_POIV_${node.id}`, from: best.cid, to: node.id, points: pts.slice().reverse(), props: { kind: link, legacy_kind: LEGACY_KIND[link] ?? link, allowed_types: [...policy.kinds[link].allowed_types], bidirectional: true, speed_limit: SPEED[link], road_ids: [], road_id: null, crosswalk_id: null, source_ref: `${f.id} vehicle access`, ...flags, road_share: Number(roadShare.toFixed(3)), poi_id: f.id } });
  }
  // ---- scooter access: a POI scooters may use but only reach over sidewalks (scooters are not allowed there) gets an
  // estimated shared path to the nearest node of the main road network (scooters ride the roads and shared paths)
  {
    const uf = new UnionFind();
    const scooterEdges = edges.filter((e) => e.props.allowed_types.includes("scooter"));
    for (const e of scooterEdges) uf.union(e.from, e.to);
    const mainRoot = uf.find([...cars][0]);
    for (const f of pois) {
      const node = nodes.get(f.properties.node_id);
      if (!node || !(f.properties.allowed_types ?? []).includes("scooter") || uf.find(node.id) === mainRoot) continue;
      let best = null;
      for (const cid of cars) {
        const d = dist(nodes.get(cid).p, node.p);
        if (d >= 0.5 && (!best || d < best.d)) best = { cid, d };
      }
      if (!best) continue;
      // scooter-only (people cross the carriageway only at crossings): an estimated scooter lane to the road node
      edges.push({ id: `EDGE_POIS_${node.id}`, from: node.id, to: best.cid, points: [node.p, nodes.get(best.cid).p], props: { kind: "scooter_lane", legacy_kind: "scooter_lane", allowed_types: [...policy.kinds.scooter_lane.allowed_types], bidirectional: true, speed_limit: 12, road_ids: [], road_id: null, crosswalk_id: null, source: "derived_from_vehicle_network", source_ref: `${f.id} scooter access`, confidence: 0.2, authoritative: false, derived: true, estimated: true, gap_reason: "scooter access to a POI reached only over sidewalks (scooters may not use them)", poi_id: f.id } });
      uf.union(node.id, best.cid);
    }
  }
  // ---- prune: keep the person and car components that hold the POIs
  const pruned = { person: [], car: [] };
  for (const agent of ["person", "car"]) {
    const uf = new UnionFind();
    const active = edges.filter((e) => e.props.allowed_types.includes(agent));
    for (const e of active) uf.union(e.from, e.to);
    const poiNodes = pois.filter((f) => (f.properties.allowed_types ?? []).includes(agent)).map((f) => (agent === "car" ? f.properties.vehicle_node_id ?? f.properties.node_id : f.properties.node_id)).filter((n) => nodes.has(n));
    const score = new Map();
    for (const e of active) if (e.props.source !== "OSM-derived") score.set(uf.find(e.from), (score.get(uf.find(e.from)) ?? 0) + lineLength(e.points));
    for (const n of poiNodes) score.set(uf.find(n), (score.get(uf.find(n)) ?? 0) + 1e7);
    const main = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const drop = new Set(active.filter((e) => uf.find(e.from) !== main).map((e) => e));
    for (const e of drop) {
      if (agent === "car" || e.props.allowed_types.every((t) => t === agent || (agent === "person" && t === "scooter"))) {
        pruned[agent].push(e.id);
        edges.splice(edges.indexOf(e), 1);
      }
    }
  }
  const used = new Set(edges.flatMap((e) => [e.from, e.to]));
  for (const n of [...nodes.keys()]) if (!used.has(n) && !pois.some((f) => f.properties.node_id === n)) nodes.delete(n);
  // ---- kerb heights on sidewalk edges (nearest kerb piece within 2 m)
  const kerbGrid = new LineGrid(kerbPieces, 10);
  for (const e of edges.filter((x) => x.props.kind === "sidewalk")) {
    let best = null;
    for (const p of sampleLine(e.points, 2)) {
      const hit = kerbGrid.nearest(p, KERB_REACH_M);
      if (hit && (!best || hit.d < best.d)) best = hit;
    }
    if (best) e.props.kerb_height_m = best.line.height_m;
  }
  // ---- coincident nodes (0.001 m) merged into the lexically first id
  const all = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const merge = new Map();
  const cell = new Map();
  for (const n of all) {
    const key = `${Math.round(n.p[0] / NODE_MERGE_M)},${Math.round(n.p[1] / NODE_MERGE_M)}`;
    if (cell.has(key)) merge.set(n.id, cell.get(key));
    else cell.set(key, n.id);
  }
  for (const [from] of merge) nodes.delete(from);
  for (const e of edges) {
    e.from = merge.get(e.from) ?? e.from;
    e.to = merge.get(e.to) ?? e.to;
  }
  for (const f of pois) if (f.properties.vehicle_node_id) f.properties.vehicle_node_id = merge.get(f.properties.vehicle_node_id) ?? f.properties.vehicle_node_id;
  // ---- features
  const nodeFeatures = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)).map((n) => ({ type: "Feature", id: n.id, geometry: { type: "Point", coordinates: n.p.map((v) => round(v)) }, properties: { id: n.id, feature_type: "node", ...n.props } }));
  const edgeFeatures = edges.filter((e) => !(e.from === e.to && lineLength(e.points) < 0.05)).sort((a, b) => a.id.localeCompare(b.id)).map((e) => {
    const { epsg5186, ...props } = e.props;
    void epsg5186;
    const lengthM = lineLength(e.points);
    return {
      type: "Feature", id: e.id, geometry: { type: "LineString", coordinates: e.points.map((p) => p.map((v) => round(v))) },
      properties: {
        id: e.id, feature_type: "edge", from_node: e.from, to_node: e.to, source_id: e.id, sidewalk_id: props.sidewalk_id ?? null, surface: props.surface ?? null, external_ids: props.external_ids ?? null,
        ...props, length_m: round(lengthM, 2),
        ...(props.width_m == null ? { width_m: undefined } : {}),
      },
    };
  });
  for (const f of edgeFeatures) for (const k of Object.keys(f.properties)) if (f.properties[k] === undefined) delete f.properties[k];
  const poiFeatures = pois.map((f) => {
    const n = nodes.get(f.properties.node_id);
    return { ...f, geometry: { type: "Point", coordinates: (n?.p ?? f.geometry.coordinates).map((v) => round(v)) }, properties: { ...f.properties, ...(n ? { position_source: n.props.position_source ?? null } : {}) } };
  }).sort((a, b) => a.id.localeCompare(b.id));
  // ---- provenance summary
  const length = (pred) => round(edgeFeatures.filter((f) => pred(f.properties)).reduce((s, f) => s + f.properties.length_m, 0), 1);
  const bySource = {};
  for (const f of edgeFeatures) bySource[f.properties.source] = round((bySource[f.properties.source] ?? 0) + f.properties.length_m, 1);
  const personTotal = length((p) => p.allowed_types.includes("person"));
  const personEst = length((p) => p.allowed_types.includes("person") && p.estimated);
  const carTotal = length((p) => p.allowed_types.includes("car"));
  const carEst = length((p) => p.allowed_types.includes("car") && p.estimated);
  const provenance = {
    length_m_by_source: bySource,
    person: { length_m: personTotal, estimated_m: personEst, estimated_share_pct: personTotal ? round((100 * personEst) / personTotal, 2) : 0 },
    car: { length_m: carTotal, estimated_m: carEst, estimated_share_pct: carTotal ? round((100 * carEst) / carTotal, 2) : 0 },
    note: "estimated = fallback shared paths where NGII A003 is missing, estimated connectors, gap bridges between road zones and OSM perimeter roads (추정)",
  };
  const metadata = {
    ...old.metadata,
    schema_version: old.metadata?.schema_version ?? 1,
    coordinate_system: old.metadata?.coordinate_system ?? "local meters, x=east, z=north",
    source_of_truth: true,
    authoritative_geometry_available: true,
    status: "Separated pedestrian / vehicle network: sidewalks from NGII A003 outlines, crossings from the digitised CW polygons, vehicle centrelines from the road-zone polygons; estimated edges (A003 gaps, connectors, perimeter OSM roads) carry estimated: true.",
    generated_from: "frontend/scripts/campus-model/network/buildNetwork.mjs (plan uhf-ground-roads-routing todo 20)",
    generator: "frontend/scripts/campus-model/network/buildNetwork.mjs",
    frame: "simulation (m east/north of the D4 anchor in EPSG:5186 TM)",
    epsg5186_anchor: { E: round(D4_ANCHOR_TM[0], 4), N: round(D4_ANCHOR_TM[1], 4) },
    licence_ref: { perimeter_edges: perimeterRef, licence: "ODbL 1.0, (c) OpenStreetMap contributors (perimeter edges only)" },
    provenance_summary: provenance,
  };
  const collection = { ...Object.fromEntries(Object.keys(old).filter((k) => k !== "features").map((k) => [k, old[k]])), type: "FeatureCollection", metadata, features: [...nodeFeatures, ...edgeFeatures, ...poiFeatures] };
  const kinds = {};
  for (const f of edgeFeatures) kinds[f.properties.kind] = (kinds[f.properties.kind] ?? 0) + 1;
  const stats = {
    nodes: nodeFeatures.length, edges: edgeFeatures.length, pois: poiFeatures.length, kinds,
    personNodes: new Set(edgeFeatures.filter((f) => f.properties.allowed_types.includes("person")).flatMap((f) => [f.properties.from_node, f.properties.to_node])).size,
    personEdges: edgeFeatures.filter((f) => f.properties.allowed_types.includes("person")).length,
    carNodes: new Set(edgeFeatures.filter((f) => f.properties.allowed_types.includes("car")).flatMap((f) => [f.properties.from_node, f.properties.to_node])).size,
    carEdges: edgeFeatures.filter((f) => f.properties.allowed_types.includes("car")).length,
    authoritative: edgeFeatures.filter((f) => f.properties.authoritative && !f.properties.derived).length,
    estimated: edgeFeatures.filter((f) => f.properties.estimated).length,
    pruned: { person: pruned.person.length, car: pruned.car.length }, provenance,
  };
  log(`pruned outside the main components: person ${pruned.person.length} edges, car ${pruned.car.length} edges`);
  return { collection, stats, pruned };
}

// Largest keep-right offset per car edge that keeps a car body (half width 0.9 m, estimated, plus 0.1 m) on the road or
// lot surface and off the sidewalk: the smaller side clearance of the centreline, every 2 m, rays at 0.1 m steps.
export const HALF_CAR_M = 0.9;
export function addLaneClearance(features, { roadPolygons, sidewalkPolygons = [] }) {
  const roadGrid = new PolygonGrid(roadPolygons, 20);
  const sidewalkGrid = new PolygonGrid(sidewalkPolygons, 20);
  const car = (q) => roadGrid.contains(q) && !sidewalkGrid.contains(q);
  const clearance = (q, n) => {
    if (!car(q)) return 0;
    let d = 0;
    while (d < 8 && car([q[0] + n[0] * (d + 0.1), q[1] + n[1] * (d + 0.1)])) d += 0.1;
    return d;
  };
  let capped = 0;
  for (const f of features) {
    const p = f.properties;
    if (p.feature_type !== "edge" || !p.allowed_types.includes("car")) continue;
    const pts = f.geometry.coordinates;
    let min = Infinity;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const [a, b] = [pts[i], pts[i + 1]];
      const l = dist(a, b);
      if (l < 1e-6) continue;
      const n = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
      for (const q of sampleLine([a, b], 2)) min = Math.min(min, clearance(q, n), clearance(q, [-n[0], -n[1]]));
    }
    if (!Number.isFinite(min)) continue;
    p.lane_offset_cap_m = round(Math.max(0, min - HALF_CAR_M - 0.1), 2);
    capped += 1;
  }
  return capped;
}

// Trace-oracle polygons (simulation frame).
export function polygonCollections({ walkable, roadPolygons }) {
  const poly = (p, i, prefix) => ({
    type: "Feature", id: p.id ?? `${prefix}_${String(i + 1).padStart(4, "0")}`,
    geometry: { type: "Polygon", coordinates: p.rings.map((r) => [...r, r[0]].map((q) => q.map((v) => round(v)))) },
    properties: { id: p.id ?? `${prefix}_${String(i + 1).padStart(4, "0")}`, class: p.class, ...(p.source_ref ? { source_ref: String(p.source_ref) } : {}), ...(p.name ? { name: p.name } : {}), estimated: Boolean(p.estimated) },
  });
  const meta = (what) => ({ generator: "frontend/scripts/campus-model/network/buildNetwork.mjs", coordinate_system: "local meters, x=east, z=north (D4 anchor; src/geo/epsg5186.mjs)", description: what });
  const seen = new Map();
  const unique = (fs) => fs.map((f) => {
    const n = (seen.get(f.id) ?? 0) + 1;
    seen.set(f.id, n);
    if (n > 1) { f.id = `${f.id}#${n}`; f.properties.id = f.id; }
    return f;
  });
  return {
    walkable: { type: "FeatureCollection", metadata: meta("walkable polygons for the separation trace: sidewalk (NGII A003 strips), crossing (CW polygons, painted zebras, estimated kerb approaches), crossing_estimated (estimated unmarked crossings, 추정), walkway_estimated (estimated walkway strips, 추정), plaza (OSM plazas, rims and building aprons; aprons estimated)"), features: unique(walkable.map((p, i) => poly(p, i, "WALK"))) },
    road: { type: "FeatureCollection", metadata: meta("road polygons for the separation trace: road (road zones, arterial/connector strips traced to the A003 kerbs, estimated gap bridges), lot (car parks), island (main-gate traffic islands, estimated; subtracted from the carriageway: a point inside an island is not road)"), features: unique(roadPolygons.map((p, i) => poly(p, i, "ROAD"))) },
  };
}

// Estimated walkway strips for the ground stage (network/surfaces.mjs draws them with the paver material), EPSG:5186.
export function walkwaySurfaces(strips, toTm, crossings = []) {
  return {
    metadata: {
      generator: "frontend/scripts/campus-model/network/walkways.mjs (via buildNetwork.mjs)", coordinate_system: "EPSG:5186 (Korea 2000 / Central Belt 2010)",
      description: "estimated walkway strips (1.5 m paved shoulder/path, 추정) where an estimated pedestrian edge crosses open ground, and estimated crossings (3 m, 추정, routing/walkable only, not drawn in the model) where it must cross a road with no CW polygon or painted zebra; not NGII A003 sidewalks or measured crossings",
      estimated: true,
    },
    strips: strips.map((s) => ({ id: s.id, source_ref: s.source_ref, estimated: true, rings: s.rings.map((ring) => ring.map(([x, z]) => toTm({ x, z }).map((v) => round(v)))) })),
    // estimated crossings (3 m, no CW polygon and no painted zebra; 추정): routing / walkable polygons only, not drawn
    crossings: crossings.map((s) => ({ id: s.id, source_ref: s.source_ref, estimated: true, rings: s.rings.map((ring) => ring.map(([x, z]) => toTm({ x, z }).map((v) => round(v)))) })),
  };
}

// Add-only `epsg5186_anchor` in coordinate_transform.json (text edit that keeps the hand formatting).
export function addAnchor(text) {
  if (JSON.parse(text).epsg5186_anchor) return text;
  const at = text.indexOf('\n  "sumo_origin"');
  if (at < 0) throw new Error("coordinate_transform.json: sumo_origin line not found");
  const out = `${text.slice(0, at)}\n  "epsg5186_anchor": {"E": ${round(D4_ANCHOR_TM[0], 4)}, "N": ${round(D4_ANCHOR_TM[1], 4)}},${text.slice(at)}`;
  JSON.parse(out);
  return out;
}

// ---------------------------------------------------------------- CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const { loadNetworkContext, readJson, PATHS, REPO } = await import("./context.mjs");
  const { buildSidewalks } = await import("./sidewalks.mjs");
  const { buildCrossings } = await import("./crossings.mjs");
  const { buildFallback } = await import("./fallback.mjs");
  const { buildConnectors, poiInputs, walkablePolygons } = await import("./connectors.mjs");
  const { NetGraph } = await import("./graph.mjs");
  const { buildWalkways, statsLine: walkwayStats } = await import("./walkways.mjs");
  const { simulationToTm } = await import("../../../src/geo/epsg5186.mjs");
  const DATA = path.join(REPO, "backend/simulation/data");
  const baselineFile = Bun.file(PATHS.baseline);
  const ctx = await loadNetworkContext();
  const old = ctx.oldNetwork;
  const policy = await readJson(path.join(REPO, "backend/simulation/config/mobility_policy.json"));
  const placeholders = JSON.parse(ctx.elementsText).sidewalk_placeholders ?? [];
  const quiet = () => {};
  const sidewalks = buildSidewalks({ walkways: ctx.walkways, roadSegments: ctx.roadSegments, placeholders, warn: quiet });
  const graph = NetGraph.fromSidewalks(sidewalks);
  const crossings = buildCrossings({ crosswalks: ctx.crossings, roads: ctx.roads, graph, strips: sidewalks.strips, kerbTouched: ctx.kerbs.touched, warn: quiet });
  const walkable = walkablePolygons({ strips: sidewalks.strips, crossings: ctx.crossings, layers: ctx.layers });
  // painted zebras of the orthophoto that no CW polygon covers are crossings too (people cross only at crossings)
  const { photoCrossings, zebraGroups } = await import("./photoCrossings.mjs");
  const { lonLatToSim } = await import("./context.mjs");
  const painted = photoCrossings({ groups: zebraGroups(await readJson(path.join(REPO, "frontend/scripts/campus-model/data/photo/markings.geojson")), lonLatToSim), crossings: ctx.crossings, roadPolygons: ctx.roads.polygons });
  walkable.push(...painted.polygons);
  console.log(`painted zebra crossings without a CW polygon: ${painted.stats.crossings} added (skipped: ${painted.stats.fewBars} < 4 bars, ${painted.stats.inCw} in a CW polygon, ${painted.stats.offRoad} off the road)`);
  const { entrances, pois } = poiInputs(await readJson(PATHS.entrances), old);
  const fallback = buildFallback({ roads: ctx.roads, graph, coverage: sidewalks.coverage, pois: [...entrances.map((e) => ({ id: e.building_id, p: e.position })), ...pois.map((p) => ({ id: p.poi_id, p: p.p }))], plazas: walkable.filter((w) => w.class === "plaza"), buildings: ctx.buildings, warn: quiet });
  const connectors = buildConnectors({ entrances, pois, graph, walkable, roadPolygons: ctx.roads.polygons, buildings: ctx.buildings, warn: quiet });
  const walkways = buildWalkways({ graph, walkable, roadPolygons: ctx.roads.polygons, buildings: ctx.buildings, warn: console.warn });
  console.log(walkwayStats(walkways.stats));
  for (const u of walkways.stats.unresolved) console.log(`  unresolved ${JSON.stringify(u)}`);
  for (const u of walkways.stats.sidewalkOnVehicle) console.log(`  measured on carriageway ${JSON.stringify(u)}`);
  const poiFeatures = old.features.filter((f) => f.properties.feature_type === "poi");
  // main-gate traffic islands (data/photo/gate-structures.geojson): subtracted from the carriageway for every car check
  const { loadIslands, routeAroundIslands, islandPolygons } = await import("./gateIslands.mjs");
  const islands = loadIslands(await readJson(path.join(REPO, "frontend/scripts/campus-model/data/photo/gate-structures.geojson")), lonLatToSim);
  const islandPolys = islandPolygons(islands);
  const sidewalkPolygons = walkable.filter((w) => w.class === "sidewalk");
  const notCarriageway = [...sidewalkPolygons, ...islandPolys];
  const { collection, stats } = assembleNetwork({ roads: ctx.roads, graph, pois: poiFeatures, kerbPieces: ctx.kerbs.pieces, policy, old, roadPolygons: ctx.roads.polygons, sidewalkPolygons: notCarriageway });
  const islandRoutes = routeAroundIslands(collection.features, islands);
  console.log(`gate islands: ${islands.length}; car edges split round them: ${islandRoutes.split.map((r) => `${r.edge} ${r.from_m}-${r.to_m} m (gaps ${r.forwardGapM} / ${r.reverseGapM} m)`).join(", ") || "none"}${islandRoutes.unresolved.length ? `; UNRESOLVED ${JSON.stringify(islandRoutes.unresolved)}` : ""}`);
  console.log(`lane offset caps on ${addLaneClearance(collection.features, { roadPolygons: ctx.roads.polygons, sidewalkPolygons: notCarriageway })} car edges`);
  if (arg("--extra-edges")) collection.features.push(...(await readJson(arg("--extra-edges"))).features);
  const errors = checkCollection(collection, old, policy);
  console.log(`sidewalks: ${sidewalks.stats.strips} strips, ${sidewalks.stats.edges} edges; crossings: ${crossings.stats.edges} edges (${crossings.stats.connectors} estimated end connectors); fallback: ${fallback.stats.retainedRuns} runs ${fallback.stats.retainedM} m; connectors: ${connectors.stats.entrances} entrances, ${connectors.stats.pois} POIs (${connectors.stats.estimated} estimated)`);
  console.log(`network: ${stats.nodes} nodes, ${stats.edges} edges, ${stats.pois} POIs; person ${stats.personNodes} nodes / ${stats.personEdges} edges, car ${stats.carNodes} nodes / ${stats.carEdges} edges; authoritative ${stats.authoritative}, estimated ${stats.estimated}`);
  console.log(`edges by kind ${JSON.stringify(stats.kinds)}`);
  console.log(`length by source ${JSON.stringify(stats.provenance.length_m_by_source)}`);
  console.log(`estimated share: person ${stats.provenance.person.estimated_m} of ${stats.provenance.person.length_m} m (${stats.provenance.person.estimated_share_pct} %), car ${stats.provenance.car.estimated_m} of ${stats.provenance.car.length_m} m (${stats.provenance.car.estimated_share_pct} %)`);
  if (errors.length) {
    console.error(`validation failed (${errors.length}):`);
    for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
    console.error("nothing written");
    process.exit(1);
  }
  if (args.includes("--dry-run")) {
    console.log("dry run: nothing written");
    process.exit(0);
  }
  if (!(await baselineFile.exists())) {
    await Bun.write(PATHS.baseline, Bun.file(PATHS.network));
    console.log(`baseline copied: ${path.relative(REPO, PATHS.baseline)}`);
  }
  const { walkable: walkFc, road: roadFc } = polygonCollections({ walkable: [...walkable, ...walkways.approaches, ...walkways.strips, ...walkways.crossings], roadPolygons: [...ctx.roads.polygons, ...islandPolys] });
  await Bun.write(PATHS.network, `${JSON.stringify(collection)}\n`);
  await Bun.write(path.join(DATA, "walkable_polygons.geojson"), `${JSON.stringify(walkFc)}\n`);
  await Bun.write(path.join(DATA, "road_polygons.geojson"), `${JSON.stringify(roadFc)}\n`);
  await Bun.write(PATHS.estimatedWalkways, `${JSON.stringify(walkwaySurfaces(walkways.strips, simulationToTm, walkways.crossings))}\n`);
  const transformPath = path.join(DATA, "coordinate_transform.json");
  await Bun.write(transformPath, addAnchor(await Bun.file(transformPath).text()));
  console.log(`written campus_transport_network.geojson, walkable_polygons.geojson (${walkFc.features.length}), road_polygons.geojson (${roadFc.features.length}), coordinate_transform.json epsg5186_anchor`);
}

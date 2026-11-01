#!/usr/bin/env bun
// Vehicle centreline graph from the road-zone polygons and the RD_ registry.
//
//   bun scripts/campus-model/network/roads.mjs [--stats] [--preview <png>] [--write] [--zones <geojson>] [--no-layers]
//
// Provenance: the zone parsing, the intersection-zone classification (names containing 교차로 / 사거리 / 삼거리) and the
// CROSSWALK_BY_ZONE map are ported from backend/build_routes_from_road_zones.py, introduced in commit b0969e2
// ("교통 시뮬레이션 및 VWorld 연동", later removed; `git show b0969e2:backend/build_routes_from_road_zones.py`).
// That builder's topology (zone-midpoint kNN k=3 <= 85 m + a Prim tree, its lines 54-70) is NOT kept: the centreline of
// every road-zone polygon comes from network/skeleton.mjs, the nodes are intersection zones and skeleton branch points,
// and a polygon whose end lies inside (or within 1 m of) another zone is joined to that zone.
//
// Output (simulation frame, metres east/north of the D4 anchor, src/geo/epsg5186.mjs): interior edges `source:
// "road-zone-measured"`; OSM arterial/connector lines outside the road zones become perimeter edges (`OSM-derived`,
// ODbL) that are written ONLY to backend/simulation/data/osm/perimeter_roads.geojson. OSM topology is never used inside
// the campus (the parts of an OSM line that fall inside a road zone are dropped).
//
// Road polygons for the trace oracle: the road zones, plus the todo 8 layers of network/surfaces.mjs (`buildRoads({ layers
// })`, { ASPHALT: [{ id, rings }], LOT: [...] } in the simulation frame, see network/context.mjs roadLayers): the
// arterial / connector strips traced out to the surveyed kerbs and the parking lots. The CLI loads them (about 25 s;
// `--no-layers` skips them). Without layers the arterial strips are quads around the OSM line with the RD_ segment
// width (OSM width tag, else 3.5 m per lane) and no separate car-park polygons exist.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulationToTm, wgs84ToSimulation } from "../../../src/geo/epsg5186.mjs";
import { Raster } from "../lib/raster.mjs";
import { encodePng } from "../lib/png.mjs";
import { skeletonize } from "./skeleton.mjs";
import { addToElementsFile, ID_SCHEME } from "./roadIds.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const PATHS = {
  roadZones: path.join(REPO, "docs/assets/data/road_zones_wgs84.geojson"),
  roadSegments: path.join(REPO, "backend/simulation/data/road_segments.geojson"),
  network: path.join(REPO, "backend/simulation/data/campus_transport_network.geojson"),
  elements: path.join(REPO, "common/data/common_elemetns.json"),
  elementsCopy: path.join(REPO, "backend/simulation/data/source/common_elemetns.json"),
  osmGround: path.join(HERE, "../data/osm-ground.json"),
  perimeter: path.join(REPO, "backend/simulation/data/osm/perimeter_roads.geojson"),
  graph: path.join(HERE, "../data/network/roads.json"),
};

// Zone name -> crossing id, from backend/build_routes_from_road_zones.py (b0969e2). Consumed by crossings.mjs (todo 16).
export const CROSSWALK_BY_ZONE = {
  "공대3호관삼거리": "CW_019",
  "공학교차로": "CW_022",
  "대학본부사거리": "CW_012",
  "박물관삼거리": "CW_006",
  "사과대사거리": "CW_018",
  "사범대학1호관삼거리": "CW_023",
  "산단1주차장": "CW_003",
  "산단2주차장": "CW_002",
  "산단3주차장": "CW_001",
  "약대사거리": "CW_016",
  "인예대삼거리": "CW_017",
  "정문앞길": "CW_007",
  "중앙교차로": "CW_014",
  "학생회관삼거리": "CW_015",
};
export const LICENCE = "ODbL 1.0, (c) OpenStreetMap contributors";
export const isIntersectionName = (name) => /교차로|사거리|삼거리/.test(name ?? "");
export const isLotName = (name) => /주차장/.test(name ?? "");

const END_EXTEND_FACTOR = 2.5; // an end may be extended to the polygon boundary over at most 2.5 x its radius + 2 m
const LINK_REACH_M = 1.0; // an end within this distance of another zone polygon is joined to it
const MERGE_M = 2.0; // a link target this close to an existing node reuses the node
const MAX_BRIDGE_M = 15; // gaps between untouching zone polygons bridged as estimated edges
const ND_MATCH_M = 10;
const RD_REACH_M = 6;
const SAMPLE_M = 1;
const INSET_M = 0.1;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- geometry
const toSim = ([lon, lat]) => {
  const p = wgs84ToSimulation(lon, lat);
  return [p.x, p.z];
};

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function inRings(p, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function segmentNearest(p, a, b) {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)) : 0;
  const q = [a[0] + t * ex, a[1] + t * ey];
  return { t, q, d: dist(p, q) };
}

const ringsDistance2 = (ring, rings) => Math.min(...ring.map((p) => ringsDistance(p, rings)));
const ringsDistance = (p, rings) => {
  let best = Infinity;
  for (const ring of rings) for (let i = 0; i + 1 < ring.length; i += 1) best = Math.min(best, segmentNearest(p, ring[i], ring[i + 1]).d);
  return best;
};

function rayHit(p, d, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i += 1) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[i + 1];
      const ex = bx - ax;
      const ey = by - ay;
      const den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - p[0]) * ey - (ay - p[1]) * ex) / den;
      const u = ((ax - p[0]) * d[1] - (ay - p[1]) * d[0]) / den;
      if (t > 1e-9 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
  }
  return best;
}

const lineLength = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]), 0);

// Points every `step` metres along a polyline (both ends included).
function sampleLine(pts, step = SAMPLE_M) {
  const out = [pts[0]];
  let carry = step;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const len = dist(pts[i], pts[i + 1]);
    for (let s = carry; s < len; s += step) {
      const t = s / len;
      out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
      carry = s + step;
    }
    carry -= len;
  }
  out.push(pts.at(-1));
  return out;
}

// True when every 0.25 m sample of a-b lies inside one of the polygons (ring sets).
const segmentInside = (a, b, ringSets) => {
  const n = Math.max(1, Math.ceil(dist(a, b) / 0.25));
  for (let k = 0; k <= n; k += 1) {
    const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
    if (!ringSets.some((rings) => inRings(p, rings))) return false;
  }
  return true;
};

// Midpoint of the closest pair of boundary points of two rings.
function touchPoint(ringA, ringB) {
  let best = null;
  for (const [ring, other] of [[ringA, ringB], [ringB, ringA]]) {
    for (const p of ring) {
      for (let i = 0; i + 1 < other.length; i += 1) {
        const s = segmentNearest(p, other[i], other[i + 1]);
        if (!best || s.d < best.d) best = { d: s.d, mid: [(p[0] + s.q[0]) / 2, (p[1] + s.q[1]) / 2] };
      }
    }
  }
  return best.mid;
}

// ---------------------------------------------------------------- zones
export function parseZones(roadZones) {
  const parts = [];
  for (const f of [...roadZones.features].sort((a, b) => String(a.properties.FEATURE_ID).localeCompare(String(b.properties.FEATURE_ID)))) {
    const name = f.properties.ZONE_NAME;
    polygonsOf(f.geometry).forEach((poly, k) => {
      const rings = poly.map((ring) => ring.map(toSim));
      const xs = rings[0].map((p) => p[0]);
      const ys = rings[0].map((p) => p[1]);
      parts.push({
        index: parts.length,
        featureId: f.properties.FEATURE_ID,
        name,
        part: k,
        rings,
        holes: rings.slice(1),
        bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        kind: isIntersectionName(name) ? "intersection" : isLotName(name) ? "lot" : "road",
      });
    });
  }
  return parts;
}

const inBox = (p, box, pad = 0) => p[0] >= box[0] - pad && p[0] <= box[2] + pad && p[1] >= box[1] - pad && p[1] <= box[3] + pad;

class PolygonIndex {
  constructor(polygons) {
    this.polygons = polygons.map((poly) => {
      const pts = poly.rings[0];
      return { ...poly, box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
    });
  }

  contains(p) {
    return this.polygons.some((poly) => inBox(p, poly.box) && inRings(p, poly.rings));
  }
}

// ---------------------------------------------------------------- graph
class Graph {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.parent = [];
  }

  addNode(p, props = {}) {
    this.nodes.push({ p, ...props });
    this.parent.push(this.nodes.length - 1);
    return this.nodes.length - 1;
  }

  find(n) {
    let r = n;
    while (this.parent[r] !== r) r = this.parent[r];
    for (let x = n; this.parent[x] !== r;) {
      const next = this.parent[x];
      this.parent[x] = r;
      x = next;
    }
    return r;
  }

  merge(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }

  addEdge(from, to, points, props = {}) {
    this.edges.push({ from, to, points, ...props });
    return this.edges.length - 1;
  }

  // Splits edge `index` at segment `seg` (between points seg and seg + 1) at point `p`; returns the new node.
  split(index, seg, p) {
    const e = this.edges[index];
    const node = this.addNode(p, { kind: "junction" });
    const first = { ...e, to: node, points: [...e.points.slice(0, seg + 1), p] };
    const second = { ...e, from: node, points: [p, ...e.points.slice(seg + 1)] };
    this.edges.splice(index, 1, first, second);
    return node;
  }
}

function edgeDirectionAtEnd(points) {
  // unit vector pointing out of the last point, measured over the last 2 m
  const end = points.at(-1);
  let acc = 0;
  for (let i = points.length - 1; i > 0; i -= 1) {
    acc += dist(points[i], points[i - 1]);
    if (acc >= 2 || i === 1) {
      const d = [end[0] - points[i - 1][0], end[1] - points[i - 1][1]];
      const l = Math.hypot(d[0], d[1]);
      return l < 1e-9 ? null : [d[0] / l, d[1] / l];
    }
  }
  return null;
}

// ---------------------------------------------------------------- builder
// roadZones: GeoJSON FC (lon/lat); roadSegments: road_segments.geojson FC (simulation frame); elements: the `elements`
// array of common_elemetns.json; network: the current transport network FC (ND_ matching only); osmLines: osm-ground.json
// osm.lines; layers: optional todo 8 layers.
export function buildRoads({ roadZones, roadSegments = { features: [] }, elements = [], network = null, osmLines = [], layers = null }) {
  const warnings = [];
  const parts = parseZones(roadZones);
  const graph = new Graph();
  const partNodes = new Map(); // part index -> node ids it owns
  const rdByName = new Map(elements.filter((e) => /^RD_\d{3}$/.test(e.element_id)).map((e) => [e.name, e.element_id]));

  // ---- 1. per-polygon centrelines
  for (const part of parts) {
    const ownNodes = [];
    partNodes.set(part.index, ownNodes);
    const sk = skeletonize(part.rings);
    const radiusAt = (p) => sk.distanceAt(p[0], p[1]);
    // pole of the skeleton = the sample with the largest inscribed radius
    const samples = sk.graph.edges.flatMap((e) => sampleLine(e.points, 0.5));
    if (!samples.length) samples.push(...sk.graph.nodes);
    let pole = samples[0];
    for (const s of samples) if (!pole || radiusAt(s) > radiusAt(pole)) pole = s;
    if (!pole) {
      // a blob thinning collapses to one pixel: take the point with the largest inscribed radius
      for (let x = part.bbox[0]; x <= part.bbox[2]; x += 0.5) {
        for (let y = part.bbox[1]; y <= part.bbox[3]; y += 0.5) if (!pole || radiusAt([x, y]) > radiusAt(pole)) pole = [x, y];
      }
    }
    if (!pole || radiusAt(pole) <= 0) {
      warnings.push(`${part.featureId} ${part.name}: no interior point, polygon skipped`);
      continue;
    }
    part.pole = pole;
    part.radius = radiusAt(pole);
    if (part.kind === "intersection") {
      const n = graph.addNode(pole, { part: part.index, kind: "intersection" });
      part.poleNode = n;
      ownNodes.push(n);
      continue;
    }
    if (!sk.graph.edges.length) {
      const n = graph.addNode(pole, { part: part.index, kind: "road_end" });
      part.poleNode = n;
      ownNodes.push(n);
      warnings.push(`${part.featureId} ${part.name}: polygon too small for a centreline, single node`);
      continue;
    }
    const idMap = sk.graph.nodes.map((p) => graph.addNode(p, { part: part.index, kind: "junction" }));
    ownNodes.push(...idMap);
    const degree = new Map();
    for (const e of sk.graph.edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    for (const e of sk.graph.edges) {
      const points = e.points.map((p) => p.slice());
      // extend dead ends to the polygon boundary along their own direction
      for (const end of [0, 1]) {
        const node = end === 0 ? e.from : e.to;
        if (degree.get(node) !== 1 || e.from === e.to) continue;
        const oriented = end === 1 ? points : points.slice().reverse();
        const dir = edgeDirectionAtEnd(oriented);
        if (!dir) continue;
        const tip = oriented.at(-1);
        const hit = rayHit(tip, dir, part.rings);
        if (hit === Infinity || hit > END_EXTEND_FACTOR * radiusAt(tip) + 2) continue;
        const extended = [tip[0] + dir[0] * (hit - INSET_M), tip[1] + dir[1] * (hit - INSET_M)];
        if (end === 1) points.push(extended);
        else points.unshift(extended);
        graph.nodes[idMap[node]].p = extended;
      }
      graph.addEdge(idMap[e.from], idMap[e.to], points, { part: part.index });
    }
  }
  // recompute node kinds from the final degree (extension moved the points, so use ids)
  const degreeOf = () => {
    const d = new Map();
    for (const e of graph.edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1);
      d.set(e.to, (d.get(e.to) ?? 0) + 1);
    }
    return d;
  };

  // ---- 2. link ends to the zone they run into
  const ends = graph.nodes.map((n, id) => ({ n, id })).filter(({ n }) => n.kind !== "intersection");
  const d0 = degreeOf();
  for (const { n, id } of ends) {
    if (d0.get(id) !== 1) continue;
    const own = parts[n.part];
    const hits = parts
      .filter((q) => q.index !== own.index && inBox(n.p, q.bbox, LINK_REACH_M))
      .map((q) => ({ q, d: inRings(n.p, q.rings) ? 0 : ringsDistance(n.p, q.rings) }))
      .filter((h) => h.d <= LINK_REACH_M);
    if (!hits.length) continue;
    const inter = hits.filter((h) => h.q.kind === "intersection" && h.q.poleNode !== undefined).sort((a, b) => dist(n.p, a.q.pole) - dist(n.p, b.q.pole))[0];
    if (inter) {
      if (segmentInside(n.p, inter.q.pole, [own.rings, inter.q.rings])) graph.addEdge(id, inter.q.poleNode, [n.p, inter.q.pole], { part: null, link: true, inherits: id });
      continue;
    }
    // nearest point on the skeleton of a road/lot polygon we run into
    let best = null;
    for (const h of hits) {
      graph.edges.forEach((e, ei) => {
        if (e.part !== h.q.index || e.link) return;
        for (let i = 0; i + 1 < e.points.length; i += 1) {
          const s = segmentNearest(n.p, e.points[i], e.points[i + 1]);
          if (!best || s.d < best.d) best = { ...s, ei, seg: i };
        }
      });
      for (const nid of partNodes.get(h.q.index) ?? []) {
        const dn = dist(n.p, graph.nodes[nid].p);
        if (!best || dn < best.d) best = { d: dn, node: nid };
      }
    }
    if (!best) continue;
    if (best.node === undefined) {
      const e = graph.edges[best.ei];
      const ends2 = [e.points[best.seg], e.points[best.seg + 1]];
      const nearNode = [[e.from, e.points[0]], [e.to, e.points.at(-1)]].find(([, p]) => dist(p, best.q) <= MERGE_M);
      if (nearNode) best.node = nearNode[0];
      else {
        void ends2;
        best.node = graph.split(best.ei, best.seg, best.q);
        graph.nodes[best.node].part = e.part;
        partNodes.get(e.part).push(best.node);
      }
    }
    if (best.d <= MERGE_M && dist(n.p, graph.nodes[best.node].p) <= MERGE_M) {
      graph.merge(best.node, id);
      graph.nodes[id].merged = true;
    } else if (segmentInside(n.p, graph.nodes[best.node].p, hits.map((h) => h.q.rings).concat([own.rings]))) {
      graph.addEdge(id, best.node, [n.p, graph.nodes[best.node].p], { part: null, link: true, inherits: id });
    }
  }
  // second pass: polygons that touch but are still in different components are joined by the shortest straight link
  // that stays inside the two polygons (attach points: pole, nodes and every metre of the centrelines)
  const attachPoints = (part) => {
    const pts = [];
    graph.edges.forEach((e, ei) => {
      if (e.part !== part.index || e.link) return;
      for (let i = 0; i + 1 < e.points.length; i += 1) {
        const n = Math.max(1, Math.ceil(dist(e.points[i], e.points[i + 1])));
        for (let k = i === 0 ? 0 : 1; k <= n; k += 1) {
          const t = k / n;
          const p = [e.points[i][0] + (e.points[i + 1][0] - e.points[i][0]) * t, e.points[i][1] + (e.points[i + 1][1] - e.points[i][1]) * t];
          pts.push({ p, ei, seg: i, node: i === 0 && k === 0 ? e.from : i === e.points.length - 2 && k === n ? e.to : undefined });
        }
      }
    });
    if (part.poleNode !== undefined) pts.push({ p: graph.nodes[part.poleNode].p, node: part.poleNode });
    return pts;
  };
  const adjacent = [];
  for (const a of parts) {
    for (const b of parts) {
      if (b.index <= a.index || a.bbox[0] > b.bbox[2] + 1 || b.bbox[0] > a.bbox[2] + 1 || a.bbox[1] > b.bbox[3] + 1 || b.bbox[1] > a.bbox[3] + 1) continue;
      const gap = Math.min(ringsDistance2(a.rings[0], b.rings), ringsDistance2(b.rings[0], a.rings));
      if (gap <= LINK_REACH_M) adjacent.push([a, b]);
    }
  }
  const comps = () => {
    const root = new Map();
    const find = (x) => { let r = x; while (root.get(r) !== r) r = root.get(r); return r; };
    graph.nodes.forEach((_, i) => root.set(graph.find(i), graph.find(i)));
    for (const e of graph.edges) root.set(find(graph.find(e.from)), find(graph.find(e.to)));
    return (n) => find(graph.find(n));
  };
  for (let guard = 0; guard < 500; guard += 1) {
    const same = comps();
    let best = null;
    for (const [a, b] of adjacent) {
      const pa = attachPoints(a);
      const pb = attachPoints(b);
      if (!pa.length || !pb.length) continue;
      const ca = new Set(pa.map((x) => (x.node !== undefined ? same(x.node) : same(graph.edges[x.ei].from))));
      const cb = new Set(pb.map((x) => (x.node !== undefined ? same(x.node) : same(graph.edges[x.ei].from))));
      if ([...ca].some((c) => cb.has(c))) continue;
      const pairs = [];
      for (const x of pa) for (const y of pb) pairs.push([dist(x.p, y.p), x, y]);
      pairs.sort((u, v) => u[0] - v[0]);
      let found = false;
      for (const [d2, x, y] of pairs) {
        if (best && d2 >= best.d) break;
        if (segmentInside(x.p, y.p, [a.rings, b.rings])) { best = { d: d2, x, y, a, b }; found = true; break; }
      }
      if (!found) {
        // polygons that only touch along a point or a short edge: route through the middle of the closest boundary pair
        const t = touchPoint(a.rings[0], b.rings[0]);
        const viaPairs = [];
        for (const x of pa) for (const y of pb) viaPairs.push([dist(x.p, t) + dist(t, y.p), x, y]);
        viaPairs.sort((u, v) => u[0] - v[0]);
        for (const [d2, x, y] of viaPairs) {
          if (best && d2 >= best.d) break;
          if (segmentInside(x.p, t, [a.rings, b.rings]) && segmentInside(t, y.p, [a.rings, b.rings])) { best = { d: d2, x, y, a, b, via: t }; break; }
        }
      }
    }
    if (!best) break;
    const attach = (att) => {
      if (att.node !== undefined) return att.node;
      const e = graph.edges[att.ei];
      const near = [[e.from, e.points[0]], [e.to, e.points.at(-1)]].find(([, q]) => dist(q, att.p) <= 0.01);
      if (near) return near[0];
      const n = graph.split(att.ei, att.seg, att.p);
      graph.nodes[n].part = e.part;
      partNodes.get(e.part).push(n);
      return n;
    };
    // attach the edge-based point first; its split shifts the other one's edge index, so recompute that one after
    let nx;
    let ny;
    if (best.y.node === undefined && best.x.node === undefined && best.x.ei < best.y.ei) {
      ny = attach(best.y);
      nx = attach(best.x);
    } else {
      nx = attach(best.x);
      if (best.y.node === undefined && best.x.node === undefined && best.x.ei < best.y.ei) best.y.ei += 1;
      ny = attach(best.y);
    }
    graph.addEdge(nx, ny, best.via ? [graph.nodes[nx].p, best.via, graph.nodes[ny].p] : [graph.nodes[nx].p, graph.nodes[ny].p], { part: null, link: true, inherits: nx });
  }

  // third pass: components whose polygons do not touch (the digitised zones leave gaps of a few metres) are joined by
  // the shortest straight bridge up to MAX_BRIDGE_M, flagged estimated: it is the only place a car edge leaves a measured polygon
  const bridges = [];
  const gapCache = new Map();
  for (let guard = 0; guard < 100; guard += 1) {
    const same = comps();
    const pts = parts.flatMap((part) => attachPoints(part).map((x) => ({ ...x, part, comp: same(x.node !== undefined ? x.node : graph.edges[x.ei].from) })));
    const counts = new Map();
    for (const x of pts) counts.set(x.comp, (counts.get(x.comp) ?? 0) + 1);
    if (counts.size <= 1) break;
    const smallest = [...counts.entries()].sort((u, v) => u[1] - v[1] || u[0] - v[0]);
    let best = null;
    for (const [comp] of smallest.slice(0, -1)) {
      for (const x of pts.filter((q) => q.comp === comp)) {
        for (const y of pts) {
          if (y.comp === comp) continue;
          const key = `${Math.min(x.part.index, y.part.index)}:${Math.max(x.part.index, y.part.index)}`;
          if (!gapCache.has(key)) gapCache.set(key, Math.min(ringsDistance2(x.part.rings[0], y.part.rings), ringsDistance2(y.part.rings[0], x.part.rings)));
          const gap = gapCache.get(key);
          const d2 = dist(x.p, y.p);
          if (gap <= MAX_BRIDGE_M && (!best || gap < best.gap - 1e-9 || (Math.abs(gap - best.gap) < 1e-9 && d2 < best.d))) best = { d: d2, gap, x, y };
        }
      }
      if (best) break;
    }
    if (!best) break;
    const attach = (att) => {
      if (att.node !== undefined) return att.node;
      const e = graph.edges[att.ei];
      const near = [[e.from, e.points[0]], [e.to, e.points.at(-1)]].find(([, q]) => dist(q, att.p) <= 0.01);
      if (near) return near[0];
      const n = graph.split(att.ei, att.seg, att.p);
      graph.nodes[n].part = e.part;
      partNodes.get(e.part).push(n);
      return n;
    };
    const first = best.x.node === undefined && best.y.node === undefined && best.x.ei > best.y.ei ? best.x : best.y;
    const second = first === best.x ? best.y : best.x;
    const nf = attach(first);
    if (first.node === undefined && second.node === undefined && first.ei < second.ei) second.ei += 1;
    const ns = attach(second);
    const [nx, ny] = first === best.x ? [nf, ns] : [ns, nf];
    const widthOf = (x) => 2 * ringsDistance(x.p, x.part.rings);
    const width = Math.max(2, Math.min(widthOf(best.x), widthOf(best.y)));
    graph.addEdge(nx, ny, [graph.nodes[nx].p, graph.nodes[ny].p], { part: null, link: true, bridge: { gap: best.gap, length: best.d, width, from: best.x.part.name, to: best.y.part.name }, inherits: nx });
    bridges.push(best.d);
  }

  // ---- 3. holes: edges of a part around its hole become one-way, counter-clockwise (right-hand traffic)
  for (const part of parts.filter((p) => p.holes.length)) {
    const hole = part.holes[0];
    const c = [hole.reduce((s, p) => s + p[0], 0) / hole.length, hole.reduce((s, p) => s + p[1], 0) / hole.length];
    const own = graph.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.part === part.index);
    const ring = [];
    for (const { e, i } of own) {
      const bridge = (() => {
        if (e.from === e.to) return false;
        const seen = new Set([e.from]);
        const queue = [e.from];
        while (queue.length) {
          const x = queue.pop();
          for (const { e: f, i: j } of own) {
            if (j === i) continue;
            for (const [u, v] of [[f.from, f.to], [f.to, f.from]]) if (u === x && !seen.has(v)) { seen.add(v); queue.push(v); }
          }
        }
        return !seen.has(e.to);
      })();
      if (!bridge) ring.push(i);
    }
    const turn = (pts) => {
      let sum = 0;
      for (let k = 0; k + 1 < pts.length; k += 1) {
        const a = [pts[k][0] - c[0], pts[k][1] - c[1]];
        const b = [pts[k + 1][0] - c[0], pts[k + 1][1] - c[1]];
        sum += Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
      }
      return sum;
    };
    const rebuilt = [];
    for (const i of ring) {
      const e = graph.edges[i];
      if (e.from === e.to) {
        const total = lineLength(e.points);
        let acc = 0;
        let cut = 1;
        while (cut < e.points.length - 1 && acc + dist(e.points[cut - 1], e.points[cut]) < total / 2) {
          acc += dist(e.points[cut - 1], e.points[cut]);
          cut += 1;
        }
        const mid = graph.addNode(e.points[cut], { part: part.index, kind: "junction" });
        partNodes.get(part.index).push(mid);
        rebuilt.push({ i, replace: [{ ...e, to: mid, points: e.points.slice(0, cut + 1) }, { ...e, from: mid, points: e.points.slice(cut) }] });
      } else {
        rebuilt.push({ i, replace: [{ ...e }] });
      }
    }
    for (const { i, replace } of rebuilt) {
      graph.edges[i] = null;
      for (const r of replace) {
        const ccw = turn(r.points) >= 0;
        graph.edges.push(ccw ? { ...r, oneway: true } : { ...r, from: r.to, to: r.from, points: r.points.slice().reverse(), oneway: true });
      }
    }
    graph.edges = graph.edges.filter(Boolean);
  }

  // ---- 4. collapse merged nodes, drop unused ones, number
  const rep = (n) => graph.find(n);
  const used = new Set();
  const finalEdges = [];
  for (const e of graph.edges) {
    const from = rep(e.from);
    const to = rep(e.to);
    const pts = e.points.map((p) => p.slice());
    pts[0] = graph.nodes[from].p;
    pts[pts.length - 1] = graph.nodes[to].p;
    if (from === to && pts.length < 3) continue;
    finalEdges.push({ ...e, from, to, points: pts });
  }
  for (const e of finalEdges) { used.add(e.from); used.add(e.to); }
  for (const p of parts) for (const n of partNodes.get(p.index) ?? []) if (rep(n) === n && graph.nodes[n].kind !== undefined && p.kind !== "road" && p.poleNode === n) used.add(n);
  for (const p of parts) if (p.poleNode !== undefined && rep(p.poleNode) === p.poleNode) used.add(p.poleNode);

  // ---- 5. RD_ segment per edge
  const segments = roadSegments.features
    .filter((f) => f.properties.kind === "interior" && f.geometry)
    .map((f) => ({ props: f.properties, lines: f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates }));
  const rdOf = (points, partIndex) => {
    const zoneId = partIndex === null ? null : parts[partIndex].featureId;
    const votes = new Map();
    for (const s of sampleLine(points, 1)) {
      let best = null;
      for (const seg of segments) {
        for (const line of seg.lines) {
          for (let i = 0; i + 1 < line.length; i += 1) {
            const near = segmentNearest(s, line[i], line[i + 1]);
            if (near.d <= RD_REACH_M && (!best || near.d < best.d - 1e-9 || (Math.abs(near.d - best.d) < 1e-9 && seg.props.road_zone === zoneId))) best = { d: near.d, seg };
          }
        }
      }
      if (best) votes.set(best.seg, (votes.get(best.seg) ?? 0) + 1);
    }
    let winner = null;
    for (const [seg, n] of votes) {
      if (!winner || n > winner.n || (n === winner.n && seg.props.road_zone === zoneId)) winner = { seg, n };
    }
    return winner?.seg.props ?? segments.find((sg) => sg.props.road_zone === zoneId)?.props ?? null;
  };

  // ---- 6. polygons (trace oracle) and the periphery
  const polygons = [];
  for (const p of parts) {
    const id = rdByName.get(p.name) ?? p.featureId;
    polygons.push({ id, name: p.name, zone: p.featureId, class: p.kind === "lot" ? "lot" : "road", rings: p.rings });
  }
  const zoneIndex = new PolygonIndex(parts.map((p) => ({ rings: p.rings })));
  const perimeterEdges = [];
  const perimeterNodes = [];
  const perimeterSegments = new Map(roadSegments.features.filter((f) => f.properties.kind === "perimeter").map((f) => [f.properties.external_ids?.osm_way, f.properties]));
  let peri = 0;
  for (const line of [...osmLines].filter((l) => l.kind === "arterial" || l.kind === "connector").sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))) {
    const props = perimeterSegments.get(line.id) ?? null;
    const sim = line.line.map(toSim);
    const dense = sampleLine(sim, 1);
    const keep = dense.map((p) => !zoneIndex.contains(p));
    let k = 0;
    for (let i = 0; i < dense.length;) {
      if (!keep[i]) { i += 1; continue; }
      let j = i;
      while (j + 1 < dense.length && keep[j + 1]) j += 1;
      const run = dense.slice(i, j + 1);
      if (run.length >= 3) {
        const width = props?.width_m ?? (Number.isFinite(Number.parseFloat(line.tags?.width)) ? Number.parseFloat(line.tags.width) : null);
        const lanes = props?.lanes ?? 1;
        const widthM = width ?? 3.5 * lanes;
        peri += 1;
        const a = perimeterNodes.length;
        perimeterNodes.push({ id: `PERI_NODE_${String(a + 1).padStart(4, "0")}`, p: run[0] }, { id: `PERI_NODE_${String(a + 2).padStart(4, "0")}`, p: run.at(-1) });
        perimeterEdges.push({
          id: `EDGE_OSM_${line.id.replace("way/", "")}_${k}`, from: perimeterNodes[a].id, to: perimeterNodes[a + 1].id, points: run,
          road_id: props?.id ?? null, lanes, lanes_source: props?.lanes_source ?? "assumed", width_m: widthM, width_source: width ? props?.width_source ?? "osm_tag" : "lanes_x_3.5m",
          osm_way: line.id, osm_kind: line.kind, highway: line.tags?.highway ?? null,
        });
        k += 1;
        if (!layers?.ASPHALT) {
          for (let m = 0; m + 1 < run.length; m += 1) {
            const dx = run[m + 1][0] - run[m][0];
            const dy = run[m + 1][1] - run[m][1];
            const l = Math.hypot(dx, dy) || 1;
            const nx = (-dy / l) * (widthM / 2);
            const ny = (dx / l) * (widthM / 2);
            const q = (a2, b2) => [a2[0] + b2[0], a2[1] + b2[1]];
            polygons.push({ id: props?.id ?? line.id, name: line.tags?.name ?? null, zone: null, class: "road", rings: [[q(run[m], [nx, ny]), q(run[m + 1], [nx, ny]), q(run[m + 1], [-nx, -ny]), q(run[m], [-nx, -ny]), q(run[m], [nx, ny])]] });
          }
        }
      }
      i = j + 1;
    }
  }
  for (const layer of ["ASPHALT", "LOT"]) {
    for (const poly of layers?.[layer] ?? []) polygons.push({ id: poly.id, name: null, zone: null, class: layer === "LOT" ? "lot" : "road", rings: poly.rings, ...(poly.estimated ? { estimated: true } : {}) });
  }

  // ---- 7. ND_ ids
  const d = new Map();
  for (const e of finalEdges) {
    d.set(e.from, (d.get(e.from) ?? 0) + 1);
    d.set(e.to, (d.get(e.to) ?? 0) + 1);
  }
  const ownElement = (e) => e.note === "allocated by network/roads.mjs";
  const ndElements = elements.filter((e) => /^ND_\d{3}$/.test(e.element_id) && !ownElement(e));
  const zoneName = new Map(roadZones.features.map((f) => [`campus_${String(f.properties.FEATURE_ID).toLowerCase()}`, f.properties.ZONE_NAME]));
  const oldNodes = (network?.features ?? []).filter((f) => f.properties.feature_type === "node" && f.geometry?.type === "Point");
  const intersectionNodes = [...used].filter((n) => graph.nodes[n].kind === "intersection" || d.get(n) >= 3 || graph.nodes[n].kind === "junction" && d.get(n) >= 3);
  const ndOf = new Map();
  const taken = new Set();
  const matches = [];
  for (const nd of ndElements) {
    const olds = oldNodes.filter((f) => zoneName.get(f.properties.source_route_id) === nd.name || f.properties.road_id === nd.element_id).map((f) => f.geometry.coordinates);
    for (const n of intersectionNodes) {
      const dd = Math.min(Infinity, ...olds.map((o) => dist(o, graph.nodes[rep(n)].p)));
      if (dd <= ND_MATCH_M) matches.push({ nd: nd.element_id, n, d: dd });
    }
  }
  for (const m of matches.sort((a, b) => a.d - b.d || a.nd.localeCompare(b.nd))) {
    if (ndOf.has(m.n) || taken.has(m.nd)) continue;
    ndOf.set(m.n, m.nd);
    taken.add(m.nd);
  }
  let nextNd = Math.max(0, ...ndElements.map((e) => Number(e.element_id.slice(3)))) + 1;
  const allocated = [];
  for (const n of [...intersectionNodes].sort((a, b) => graph.nodes[a].p[0] - graph.nodes[b].p[0] || graph.nodes[a].p[1] - graph.nodes[b].p[1])) {
    if (ndOf.has(n)) continue;
    const id = `ND_${String(nextNd).padStart(3, "0")}`;
    nextNd += 1;
    ndOf.set(n, id);
    allocated.push({ element_id: id, name: `도로 교차점 ${id}`, element_type: "intersection", zone_id: null, geometry: null, source: "network/roads.mjs", note: "allocated by network/roads.mjs" });
  }

  // ---- 8. features
  let endCounter = 0;
  const nodeId = new Map();
  const nodeFeatures = [];
  for (const n of [...used].sort((a, b) => graph.nodes[a].p[0] - graph.nodes[b].p[0] || graph.nodes[a].p[1] - graph.nodes[b].p[1])) {
    const isND = ndOf.has(n);
    const id = isND ? ndOf.get(n) : `ROAD_END_${String((endCounter += 1)).padStart(3, "0")}`;
    nodeId.set(n, id);
    nodeFeatures.push({
      type: "Feature", id, geometry: { type: "Point", coordinates: graph.nodes[n].p.map((v) => round(v)) },
      properties: {
        id, feature_type: "node", kind: isND ? "intersection" : "road_end", source: "road-zone-measured", source_ref: parts[graph.nodes[n].part]?.name ?? null,
        confidence: 0.8, derived: false, authoritative: true, estimated: false, nd_matched: isND && ndElements.some((e) => e.element_id === id),
        epsg5186: simulationToTm({ x: graph.nodes[n].p[0], z: graph.nodes[n].p[1] }).map((v) => round(v)),
      },
    });
  }
  const tmLine = (pts) => pts.map(([x, z]) => simulationToTm({ x, z }).map((v) => round(v)));
  const edgeFeatures = finalEdges.map((e, i) => {
    const ownerPart = e.part ?? (e.inherits !== undefined && e.inherits !== null ? graph.nodes[e.inherits]?.part ?? null : null);
    const seg = rdOf(e.points, ownerPart);
    const part = ownerPart === null ? null : parts[ownerPart];
    const zoneLabel = part?.name ?? null;
    const id = `EDGE_ROAD_${String(i + 1).padStart(4, "0")}`;
    const crosswalk = zoneLabel ? CROSSWALK_BY_ZONE[zoneLabel] ?? null : null;
    const widths = e.points.length ? sampleLine(e.points, 2).map((p) => 2 * (part ? (skeletonRadius(part, p)) : 0)).filter((w) => w > 0) : [];
    const measured = widths.length ? widths.sort((a, b) => a - b)[widths.length >> 1] : null;
    return {
      type: "Feature", id,
      geometry: { type: "LineString", coordinates: e.points.map((p) => p.map((v) => round(v))) },
      properties: {
        id, feature_type: "edge", kind: "allowed_road", legacy_kind: "road", allowed_types: ["car", "scooter"],
        from_node: nodeId.get(e.from), to_node: nodeId.get(e.to), bidirectional: !e.oneway, oneway: Boolean(e.oneway),
        speed_limit: part?.kind === "lot" ? 10 : crosswalk || part?.kind === "intersection" ? 15 : 25,
        road_ids: seg ? [seg.id] : [], road_id: seg?.id ?? null, crosswalk_id: crosswalk, source_id: id,
        lanes: seg?.lanes ?? 1, lanes_source: seg?.lanes_source ?? "assumed",
        width_m: seg?.width_m ?? (measured === null ? null : round(measured, 2)), width_source: seg?.width_m != null ? seg.width_source : measured === null ? "none" : "skeleton_median",
        source: "road-zone-measured", source_ref: zoneLabel ?? (part ? part.featureId : null), zone_id: part?.featureId ?? null,
        confidence: 0.8, authoritative: true, derived: false, estimated: false,
        ...(e.bridge ? {
          source: "derived_from_vehicle_network", source_ref: `${e.bridge.from} - ${e.bridge.to}`, confidence: 0.2, authoritative: false, derived: true, estimated: true,
          gap_reason: `road-zone polygons ${e.bridge.gap.toFixed(1)} m apart (bridge ${e.bridge.length.toFixed(1)} m between centrelines)`, width_m: round(e.bridge.width, 2), width_source: "min_of_neighbour_zones", lanes: 1, lanes_source: "assumed",
        } : {}),
        link: Boolean(e.link), length_m: round(lineLength(e.points), 2), epsg5186: tmLine(e.points),
      },
    };
  });
  // each bridge is also an (estimated) road polygon so the trace oracle sees one consistent road surface
  for (const f of edgeFeatures.filter((x) => x.properties.gap_reason)) {
    const [a, b] = [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)];
    const l = dist(a, b) || 1;
    const nx = (-(b[1] - a[1]) / l) * (f.properties.width_m / 2);
    const ny = ((b[0] - a[0]) / l) * (f.properties.width_m / 2);
    polygons.push({ id: f.id, name: null, zone: null, class: "road", estimated: true, source_ref: "gap_bridge", rings: [[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny], [a[0] + nx, a[1] + ny]]] });
  }
  // radius helper needs the polygon rings of the part
  function skeletonRadius(part, p) {
    if (!inRings(p, part.rings)) return 0;
    return ringsDistance(p, part.rings);
  }

  // ---- 9. stats
  const comp = new Map();
  const find = (x) => { let r = x; while (comp.get(r) !== r) r = comp.get(r); return r; };
  for (const n of used) comp.set(n, n);
  for (const e of finalEdges) comp.set(find(e.from), find(e.to));
  const components = new Set([...used].map(find)).size;
  const index = new PolygonIndex(polygons);
  let total = 0;
  let inside = 0;
  const outside = [];
  for (const f of edgeFeatures) {
    for (const s of sampleLine(f.geometry.coordinates, SAMPLE_M)) {
      total += 1;
      if (index.contains(s)) inside += 1;
      else if (outside.length < 20) outside.push({ edge: f.id, at: s.map((v) => round(v, 2)) });
    }
  }
  const matched = nodeFeatures.filter((f) => f.properties.nd_matched).length;
  const stats = {
    zones: parts.length, nodes: nodeFeatures.length, ndMatched: matched, ndTotal: ndElements.length, ndAllocated: allocated.length,
    interiorEdges: edgeFeatures.length, perimeterEdges: perimeterEdges.length, insideRoadPct: total ? (100 * inside) / total : 0,
    samples: total, outsideSamples: outside, carComponents: components, rdUnmatched: edgeFeatures.filter((f) => !f.properties.road_id).length,
    perimeterRuns: peri, bridges: bridges.length, bridgeLengthM: round(bridges.reduce((u, v) => u + v, 0), 1),
  };
  return {
    nodes: nodeFeatures, edges: edgeFeatures, polygons, allocated, warnings, stats,
    perimeter: { nodes: perimeterNodes, edges: perimeterEdges },
  };
}

export const statsLine = (s) => `zones ${s.zones}, nodes ${s.nodes} (matched ${s.ndMatched} of ${s.ndTotal} ND_), interior edges ${s.interiorEdges}, perimeter edges ${s.perimeterEdges}, inside-road ${s.insideRoadPct.toFixed(1)} %, car components ${s.carComponents}`;
export const exitCodeFor = (s) => (s.insideRoadPct < 100 || s.carComponents > 1 ? 1 : 0);

// ODbL isolation: the only file that holds OSM-derived edges.
export function perimeterCollection(result) {
  const nodeById = new Map(result.perimeter.nodes.map((n) => [n.id, n]));
  return {
    type: "FeatureCollection",
    metadata: {
      licence: LICENCE, generator: "frontend/scripts/campus-model/network/roads.mjs",
      source: "OpenStreetMap arterial and connector ways (data/osm-ground.json), clipped to the outside of the campus road zones",
      coordinate_system: "local meters, x=east, z=north (D4 anchor; src/geo/epsg5186.mjs)", estimated: "OSM-derived geometry, not surveyed",
    },
    features: [
      ...result.perimeter.nodes.map((n) => ({ type: "Feature", id: n.id, geometry: { type: "Point", coordinates: n.p.map((v) => round(v)) }, properties: { id: n.id, feature_type: "node", kind: "road_end", source: "OSM-derived", authoritative: false, estimated: true, derived: true } })),
      ...result.perimeter.edges.map((e) => ({
        type: "Feature", id: e.id, geometry: { type: "LineString", coordinates: e.points.map((p) => p.map((v) => round(v))) },
        properties: {
          id: e.id, feature_type: "edge", kind: "allowed_road", legacy_kind: "road", allowed_types: ["car", "scooter"], from_node: e.from, to_node: e.to, bidirectional: true,
          road_ids: e.road_id ? [e.road_id] : [], road_id: e.road_id, lanes: e.lanes, lanes_source: e.lanes_source, width_m: e.width_m, width_source: e.width_source,
          source: "OSM-derived", source_ref: e.osm_way, external_ids: { osm_way: e.osm_way }, osm_kind: e.osm_kind, highway: e.highway,
          authoritative: false, derived: true, estimated: true, confidence: 0.5, length_m: round(lineLength(e.points), 2), epsg5186: e.points.map(([x, z]) => simulationToTm({ x, z }).map((v) => round(v))),
        },
      })),
    ].filter((f) => f.properties.feature_type === "edge" || nodeById.has(f.id)),
  };
}

// ---------------------------------------------------------------- preview (vector only: no photo pixels)
export function renderPreview(result, out, widthPx = 2000) {
  const pts = result.polygons.filter((p) => p.zone).flatMap((p) => p.rings[0]);
  const minX = Math.min(...pts.map((p) => p[0])) - 10;
  const maxX = Math.max(...pts.map((p) => p[0])) + 10;
  const minY = Math.min(...pts.map((p) => p[1])) - 10;
  const maxY = Math.max(...pts.map((p) => p[1])) + 10;
  const scale = widthPx / (maxX - minX);
  const heightPx = Math.ceil((maxY - minY) * scale);
  const raster = new Raster(widthPx, heightPx);
  raster.fillPolygon([[[0, 0], [widthPx, 0], [widthPx, heightPx], [0, heightPx]]], () => [245, 245, 242]);
  const px = ([x, y]) => [(x - minX) * scale, (maxY - y) * scale];
  for (const poly of result.polygons) raster.fillPolygon(poly.rings.map((r) => r.map(px)), () => (poly.class === "lot" ? [170, 170, 180] : [190, 190, 190]));
  const line = (a, b, color, thick = 1) => {
    const [x0, y0] = px(a);
    const [x1, y1] = px(b);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let s = 0; s <= steps; s += 1) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      for (let dx = -thick; dx <= thick; dx += 1) for (let dy = -thick; dy <= thick; dy += 1) raster.set(x + dx, y + dy, color);
    }
  };
  for (const e of result.perimeter.edges) for (let i = 0; i + 1 < e.points.length; i += 1) line(e.points[i], e.points[i + 1], [230, 150, 20], 1);
  for (const f of result.edges) {
    const c = f.geometry.coordinates;
    for (let i = 0; i + 1 < c.length; i += 1) line(c[i], c[i + 1], f.properties.oneway ? [20, 90, 200] : f.properties.estimated ? [230, 150, 20] : [40, 40, 45], 1);
  }
  for (const n of result.nodes) {
    const [cx, cy] = px(n.geometry.coordinates);
    for (let dx = -3; dx <= 3; dx += 1) for (let dy = -3; dy <= 3; dy += 1) raster.set(Math.round(cx) + dx, Math.round(cy) + dy, n.properties.kind === "intersection" ? [210, 40, 40] : [40, 150, 60]);
  }
  return encodePng(widthPx, heightPx, 3, raster.data);
}

// ---------------------------------------------------------------- CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const zonesPath = arg("--zones") ?? PATHS.roadZones;
  const read = async (p) => {
    const file = Bun.file(p);
    if (!(await file.exists())) {
      console.error(`roads.mjs: input not found: ${p}`);
      process.exit(2);
    }
    return JSON.parse(await file.text());
  };
  const roadZones = await read(zonesPath);
  const [roadSegments, network, osmGround] = await Promise.all([PATHS.roadSegments, PATHS.network, PATHS.osmGround].map(read));
  const elementsText = await Bun.file(PATHS.elements).text();
  const { elements } = JSON.parse(elementsText);
  let layers = null;
  if (!args.includes("--no-layers")) {
    const { loadSurfaceContext, roadLayers } = await import("./context.mjs");
    layers = roadLayers((await loadSurfaceContext({ log: () => {} })).layers);
    console.log(`road layers: ${layers.ASPHALT.length} arterial/connector strip polygons, ${layers.LOT.length} lot polygons (network/surfaces.mjs)`);
  }
  const baseline = Bun.file(path.join(REPO, "backend/simulation/data/campus_transport_network.derived-v1.geojson"));
  const ndNetwork = (await baseline.exists()) ? JSON.parse(await baseline.text()) : network;
  const result = buildRoads({ roadZones, roadSegments, elements, network: ndNetwork, osmLines: osmGround.osm.lines, layers });
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  console.log(statsLine(result.stats));
  if (result.stats.outsideSamples.length) console.log(`outside-road samples (first ${result.stats.outsideSamples.length}): ${JSON.stringify(result.stats.outsideSamples)}`);
  console.log(`gap bridges ${result.stats.bridges} (${result.stats.bridgeLengthM} m, estimated, polygons < ${MAX_BRIDGE_M} m apart); ND_ allocated ${result.stats.ndAllocated}; edges without an RD_ segment ${result.stats.rdUnmatched}; perimeter runs ${result.stats.perimeterRuns}`);
  const previewPath = arg("--preview");
  if (previewPath) {
    await Bun.write(previewPath, await renderPreview(result, previewPath));
    console.log(`preview ${previewPath}`);
  }
  if (args.includes("--write")) {
    await Bun.write(PATHS.perimeter, `${JSON.stringify(perimeterCollection(result), null, 2)}\n`);
    await Bun.write(PATHS.graph, `${JSON.stringify({
      metadata: { generator: "frontend/scripts/campus-model/network/roads.mjs", coordinate_system: "simulation frame (m east/north of the D4 anchor in EPSG:5186 TM)", stats: { ...result.stats, outsideSamples: undefined } },
      nodes: result.nodes, edges: result.edges,
      polygons: result.polygons.map((p) => ({ id: p.id, name: p.name, zone: p.zone, class: p.class, rings: p.rings.map((r) => r.map((q) => q.map((v) => round(v)))) })),
    })}\n`);
    const { text, added } = addToElementsFile(elementsText, { newElements: result.allocated, idScheme: ID_SCHEME, placeholders: [] });
    await Bun.write(PATHS.elements, text);
    await Bun.write(PATHS.elementsCopy, text);
    console.log(`written perimeter_roads.geojson, data/network/roads.json; elements +${added.length} ND_ (add-only)`);
  }
  process.exit(exitCodeFor(result.stats));
}

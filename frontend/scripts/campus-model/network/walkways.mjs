#!/usr/bin/env bun
// Estimated walkways (plan uhf-ground-roads-routing W4 (a)-(c)): people walk on sidewalks, crossings and paved ground,
// never on the carriageway. Every ESTIMATED person edge (fallback shared paths, joins, crossing-end and POI connectors)
// whose line touches a road/lot or a building is re-drawn by a grid search (0.5 m cells) that may only use sidewalk,
// crossing, plaza and open ground, never the carriageway; open-ground stretches of any person edge get an estimated
// walkway strip (class walkway_estimated, 1.5 m wide paved shoulder/path, 추정) that the trace oracle counts as
// walkable and the ground stage draws with the paver material. Person nodes that sit on the carriageway or in a
// building (fallback nodes on road centrelines, POI anchors on a road) move to the nearest free ground. Crosswalk edges
// keep their measured line; the short stretch between the painted crossing polygon and the kerb gets an estimated
// crossing-approach polygon (class crossing, estimated). Simulation frame (metres east/north of the D4 anchor).
//
// Nothing here relaxes the separation: road and lot cells are never walkable; an estimated edge with no carriageway-free
// route inside the search window keeps its shortest carriageway crossing, reported (stats.unresolved); when it is still
// needed after the drop step (POIs stay connected only through it) that stretch becomes an ESTIMATED crossing polygon
// (class crossing_estimated, 추정), counted only under the measured+estimated definition.
import { PolygonGrid, UnionFind, dist, lineLength, round, sampleLine } from "./geom.mjs";

export const CELL_M = 0.5;
export const STRIP_HALF_WIDTH_M = 0.75; // 1.5 m estimated walkway (추정)
export const APPROACH_MAX_M = 4; // longest kerb-to-paint stretch covered by an estimated crossing approach
export const APPROACH_HALF_WIDTH_M = 1.0;
// an estimated crossing where a needed estimated path crosses a road with no measured or painted crossing (추정):
// 3 m wide, over the shortest carriageway stretch the search found, 0.4 m onto each kerb
export const ESTIMATED_CROSSING_HALF_WIDTH_M = 1.5;
const KERB_OVERLAP_M = 0.4;
// a painted crossing polygon digitised shorter than the carriageway it marks: the crossing line continues to the
// opposite kerb, covered by an estimated crossing extension (only along a measured crosswalk edge, never elsewhere)
export const EXTENSION_MAX_M = 15;
const SAMPLE_M = 0.2;
// a route that must cross the carriageway without a crossing polygon takes the shortest stretch on it
const CARRIAGEWAY_COST = 1000;
const RELOCATE_REACH_M = 30;
// an edge with no route at all that is the only link of a group of nodes is replaced by the shortest walkable link
// (no carriageway, no building) from that group to the rest of the person graph, searched up to this distance
const REJOIN_REACH_M = 80;
// A plaza link (connectors.mjs plazaLinks, EDGE_PLAZA_*) whose carriageway-free route is missing or a detour (longer than
// PLAZA_DETOUR_FACTOR x or PLAZA_DETOUR_EXTRA_M over the straight line) stays straight when it ends at a crossing and
// crosses at most PLAZA_KERB_GAP_M of carriageway on the way (the road polygon between the footway and the zebra);
// otherwise it is dropped: it was only the second side of a through route.
const PLAZA_DETOUR_FACTOR = 2;
const PLAZA_DETOUR_EXTRA_M = 30;
const PLAZA_KERB_GAP_M = 8;
const PERSON_KINDS = new Set(["sidewalk", "crosswalk", "shared_path", "pedestrian_gate", "building_entrance", "parking_walk"]);

export const CLS = Object.freeze({ OPEN: 1, PLAZA: 2, SIDEWALK: 3, CROSSING: 4, VEHICLE: 5, BUILDING: 6 });
const WALK_COST = { [CLS.OPEN]: 1.6, [CLS.PLAZA]: 1.1, [CLS.SIDEWALK]: 1, [CLS.CROSSING]: 1 };

// Surface class at a point with the trace oracle's precedence: a building blocks; crossing and measured sidewalk are
// walkable over a road zone; road and lot are vehicle surface over plaza and open ground.
export function surfaceClassifier({ walkable = [], roadPolygons = [], buildings = [] }) {
  const walk = new PolygonGrid(walkable.filter((w) => ["crossing", "crossing_estimated", "sidewalk", "plaza"].includes(w.class)), 20);
  const vehicle = new PolygonGrid(roadPolygons.filter((r) => r.class === "road" || r.class === "lot"), 20);
  const blocks = new PolygonGrid(buildings, 20);
  return (p) => {
    if (blocks.contains(p)) return CLS.BUILDING;
    if (walk.contains(p, (w) => w.class === "crossing" || w.class === "crossing_estimated")) return CLS.CROSSING;
    if (walk.contains(p, (w) => w.class === "sidewalk")) return CLS.SIDEWALK;
    if (vehicle.contains(p)) return CLS.VEHICLE;
    if (walk.contains(p)) return CLS.PLAZA;
    return CLS.OPEN;
  };
}

class Heap {
  constructor() { this.items = []; }
  push(cost, value) {
    const a = this.items;
    a.push([cost, value]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.items.length; }
}

// Grid of cell classes, computed on demand and cached.
export class SurfaceGrid {
  constructor(classify, cell = CELL_M) {
    this.classify = classify;
    this.cell = cell;
    this.cache = new Map();
  }
  key(i, j) { return (i + 100000) * 400000 + (j + 100000); }
  centre(i, j) { return [(i + 0.5) * this.cell, (j + 0.5) * this.cell]; }
  index(p) { return [Math.floor(p[0] / this.cell), Math.floor(p[1] / this.cell)]; }
  at(i, j) {
    const k = this.key(i, j);
    let c = this.cache.get(k);
    if (c === undefined) {
      c = this.classify(this.centre(i, j));
      this.cache.set(k, c);
    }
    return c;
  }
  // a walkable cell next to a vehicle surface or a building costs more, so routes keep off the kerb line
  nearBlock(i, j) {
    for (let di = -1; di <= 1; di += 1) for (let dj = -1; dj <= 1; dj += 1) {
      const c = this.at(i + di, j + dj);
      if (c === CLS.VEHICLE || c === CLS.BUILDING) return true;
    }
    return false;
  }

  // Least-cost cell path between two points inside a window; vehicleCost null forbids the carriageway.
  route(a, b, { margin, vehicleCost = null }) {
    const [ai, aj] = this.index(a);
    const [bi, bj] = this.index(b);
    const m = Math.ceil(margin / this.cell);
    const i0 = Math.min(ai, bi) - m, i1 = Math.max(ai, bi) + m, j0 = Math.min(aj, bj) - m, j1 = Math.max(aj, bj) + m;
    const start = this.key(ai, aj), goal = this.key(bi, bj);
    const g = new Map([[start, 0]]);
    const prev = new Map();
    const heap = new Heap();
    const h = (i, j) => Math.hypot(i - bi, j - bj) * this.cell;
    heap.push(h(ai, aj), [ai, aj]);
    const closed = new Set();
    while (heap.size) {
      const [, [i, j]] = heap.pop();
      const k = this.key(i, j);
      if (closed.has(k)) continue;
      closed.add(k);
      if (k === goal) break;
      for (let di = -1; di <= 1; di += 1) for (let dj = -1; dj <= 1; dj += 1) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < i0 || ni > i1 || nj < j0 || nj > j1) continue;
        const nk = this.key(ni, nj);
        if (closed.has(nk)) continue;
        const c = this.at(ni, nj);
        let unit;
        if (nk === goal || nk === start) unit = 1;
        else if (c === CLS.BUILDING) continue;
        else if (c === CLS.VEHICLE) {
          if (vehicleCost === null) continue;
          unit = vehicleCost;
        } else unit = WALK_COST[c] * (this.nearBlock(ni, nj) ? 3 : 1);
        const step = (di && dj ? Math.SQRT2 : 1) * this.cell * unit;
        const cand = g.get(k) + step;
        if (cand < (g.get(nk) ?? Infinity)) {
          g.set(nk, cand);
          prev.set(nk, [i, j]);
          heap.push(cand + h(ni, nj), [ni, nj]);
        }
      }
    }
    if (!g.has(goal)) return null;
    const cells = [[bi, bj]];
    let k = goal;
    while (k !== start) {
      const p = prev.get(k);
      cells.push(p);
      k = this.key(p[0], p[1]);
    }
    cells.reverse();
    return cells.map(([i, j]) => this.centre(i, j));
  }

  // Nearest point (cell centre) within reach whose class is walkable and not next to a vehicle surface or a building
  // when one exists, else the nearest walkable cell.
  nearestFree(p, reach = RELOCATE_REACH_M) {
    const [ci, cj] = this.index(p);
    const r = Math.ceil(reach / this.cell);
    let best = null;
    let fallback = null;
    for (let ring = 0; ring <= r; ring += 1) {
      for (let di = -ring; di <= ring; di += 1) for (let dj = -ring; dj <= ring; dj += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const c = this.at(ci + di, cj + dj);
        if (c === CLS.VEHICLE || c === CLS.BUILDING) continue;
        const q = this.centre(ci + di, cj + dj);
        const d = dist(p, q);
        if (!this.nearBlock(ci + di, cj + dj)) { if (!best || d < best.d) best = { q, d }; }
        else if (!fallback || d < fallback.d) fallback = { q, d };
      }
      // a cell in a later ring can still be nearer by up to one diagonal: stop one ring after the first hit
      if (best && ring * this.cell > best.d + this.cell) break;
    }
    return (best ?? fallback)?.q ?? null;
  }
}

const bad = (c) => c === CLS.VEHICLE || c === CLS.BUILDING;

// Straight-line pull of a cell path: keeps a vertex only where the straight segment would touch a cell class the
// path itself avoided (vehicle or building), checked every SAMPLE_M.
export function pullString(points, classify) {
  if (points.length <= 2) return points;
  // a straight segment never enters a building and never spends more metres on the carriageway than the cell path it
  // replaces (+0.5 m, and none where the cells kept off it): a crossing stays one straight span instead of a staircase of cells, a path beside the road
  // never shortcuts along it
  const onVehicle = [0];
  for (let k = 0; k + 1 < points.length; k += 1) {
    const mid = [(points[k][0] + points[k + 1][0]) / 2, (points[k][1] + points[k + 1][1]) / 2];
    onVehicle.push(onVehicle[k] + (classify(mid) === CLS.VEHICLE ? dist(points[k], points[k + 1]) : 0));
  }
  const segmentOk = (i, j) => {
    let vehicle = 0;
    for (const q of sampleLine([points[i], points[j]], SAMPLE_M)) {
      const c = classify(q);
      if (c === CLS.BUILDING) return false;
      if (c === CLS.VEHICLE) vehicle += SAMPLE_M;
    }
    const path = onVehicle[j] - onVehicle[i];
    return path > 0 ? vehicle <= path + 0.5 : vehicle === 0;
  };
  const out = [points[0]];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1 && !segmentOk(i, j)) j -= 1;
    out.push(points[j]);
    i = j;
  }
  return out;
}

const stripRing = (a, b, half, cap) => {
  const l = dist(a, b) || 1;
  const u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const n = [-u[1], u[0]];
  const a0 = [a[0] - u[0] * cap, a[1] - u[1] * cap];
  const b0 = [b[0] + u[0] * cap, b[1] + u[1] * cap];
  return [
    [a0[0] + n[0] * half, a0[1] + n[1] * half], [b0[0] + n[0] * half, b0[1] + n[1] * half],
    [b0[0] - n[0] * half, b0[1] - n[1] * half], [a0[0] - n[0] * half, a0[1] - n[1] * half],
  ].map((p) => p.map((v) => round(v)));
};

// Runs of consecutive samples (index ranges) along a polyline whose class passes `test`.
function runs(samples, classes, test) {
  const out = [];
  for (let i = 0; i < samples.length;) {
    if (!test(classes[i])) { i += 1; continue; }
    let j = i;
    while (j + 1 < samples.length && test(classes[j + 1])) j += 1;
    out.push([i, j]);
    i = j + 1;
  }
  return out;
}

// graph: NetGraph of the person side (mutated: estimated edges re-drawn, nodes moved); walkable: walkablePolygons();
// roadPolygons: [{ class: road|lot, rings }]; buildings: [{ rings }].
export function buildWalkways({ graph, walkable = [], roadPolygons = [], buildings = [], warn = console.warn }) {
  const classify = surfaceClassifier({ walkable, roadPolygons, buildings });
  const grid = new SurfaceGrid(classify);
  const cellClass = (p) => classify(p);
  const personEdge = (e) => PERSON_KINDS.has(e.kind);
  const stats = { movedNodes: 0, rerouted: 0, rerouteGrowthM: 0, unresolved: [], strips: 0, stripM: 0, approaches: 0, sidewalkOnVehicle: [], crosswalksRedrawn: 0, droppedCrossingEdges: [], estimatedCrossings: [], rejoined: [], plazaLinks: [] };

  // ---- 1. person nodes on the carriageway or in a building move to the nearest free ground
  const personNodes = new Set(graph.edges.filter(personEdge).flatMap((e) => [e.from, e.to]));
  const moved = new Map();
  for (const id of [...personNodes].sort()) {
    const node = graph.nodes.get(id);
    if (!bad(cellClass(node.p))) continue;
    const q = grid.nearestFree(node.p);
    if (!q) {
      warn(`walkways: node ${id} has no free ground within ${RELOCATE_REACH_M} m`);
      continue;
    }
    moved.set(id, { from: node.p, to: q });
    node.p = q;
    node.position_source = `${node.position_source ? `${node.position_source}; ` : ""}moved ${round(dist(moved.get(id).from, q), 2)} m off the carriageway (estimated)`;
    node.estimated = true;
    stats.movedNodes += 1;
  }
  for (const e of graph.edges) {
    if (moved.has(e.from)) e.points = [graph.nodes.get(e.from).p, ...e.points.slice(1)];
    if (moved.has(e.to)) e.points = [...e.points.slice(0, -1), graph.nodes.get(e.to).p];
  }

  // An estimated edge with no route at all (its ends are cut off from each other by buildings and carriageway, e.g. a
  // centreline derived through a building junction) is dropped when its ends stay connected without it; when it is the
  // only link of a group of nodes, the nearest pair (group node, other node) joined by a walkable route replaces it.
  const rejoin = (e) => {
    const rest = graph.edges.filter((x) => personEdge(x) && x !== e);
    const uf = new UnionFind();
    for (const x of rest) uf.union(x.from, x.to);
    if (uf.find(e.from) === uf.find(e.to)) {
      graph.edges.splice(graph.edges.indexOf(e), 1);
      stats.rejoined.push({ edge: e.id, dropped: true });
      return true;
    }
    const all = [...new Set([e.from, e.to, ...rest.flatMap((x) => [x.from, x.to])])];
    const sideA = all.filter((id) => uf.find(id) === uf.find(e.from));
    const sideB = all.filter((id) => uf.find(id) === uf.find(e.to));
    const cutEnd = sideA.length <= sideB.length ? e.from : e.to;
    const cut = cutEnd === e.from ? sideA : sideB;
    const main = all.filter((id) => uf.find(id) !== uf.find(cutEnd));
    const pairs = [];
    for (const u of cut) for (const v of main) {
      const d = dist(graph.nodes.get(u).p, graph.nodes.get(v).p);
      if (d <= REJOIN_REACH_M) pairs.push([d, u, v]);
    }
    pairs.sort((x, y) => x[0] - y[0] || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2]));
    for (const [d, u, v] of pairs) {
      const a = graph.nodes.get(u).p, b = graph.nodes.get(v).p;
      const cells = grid.route(a, b, { margin: Math.max(40, d) });
      if (!cells) continue;
      const points = pullString([a, ...cells.slice(1, -1), b], cellClass).map((q) => q.slice());
      graph.edges.splice(graph.edges.indexOf(e), 1);
      graph.addEdge({ ...e, id: `${e.id}_W`, from: u, to: v, points, placed: "walkway_estimated", gap_reason: `replaces ${e.id} (no walkable route between its ends); nearest walkable link to the rest of the network (estimated)` });
      stats.rejoined.push({ edge: e.id, via: `${e.id}_W`, from: u, to: v, length_m: round(lineLength(points), 1) });
      return true;
    }
    return false;
  };

  // ---- 2. estimated person edges that touch a road/lot or a building are re-drawn on walkable ground
  for (const e of graph.edges.filter((x) => personEdge(x) && x.estimated)) {
    const samples = sampleLine(e.points, SAMPLE_M);
    if (!samples.some((q) => bad(cellClass(q)))) continue;
    const a = graph.nodes.get(e.from).p;
    const b = graph.nodes.get(e.to).p;
    const d = dist(a, b);
    if (e.id.startsWith("EDGE_PLAZA_")) {
      const free = grid.route(a, b, { margin: Math.max(40, 0.6 * d) });
      const freeM = free ? lineLength(free) : Infinity;
      if (freeM > Math.max(PLAZA_DETOUR_FACTOR * d, d + PLAZA_DETOUR_EXTRA_M)) {
        // the least-carriageway route to the crossing, pulled straight: one span where nothing blocks it, else a short
        // polyline round a building or water (buildings passed to buildWalkways include water: never routed across)
        const toCrossing = ["crossing_end", "crosswalk"].includes(graph.nodes.get(e.to)?.kind);
        const routed = toCrossing ? grid.route(a, b, { margin: Math.max(40, 0.6 * d), vehicleCost: CARRIAGEWAY_COST }) : null;
        const line = routed ? pullString([a, ...routed.slice(1, -1), b], cellClass) : [a, b];
        const roadM = sampleLine(line, SAMPLE_M).filter((q) => cellClass(q) === CLS.VEHICLE).length * SAMPLE_M;
        const throughBuilding = sampleLine(line, SAMPLE_M).some((q) => cellClass(q) === CLS.BUILDING);
        if (toCrossing && routed && !throughBuilding && roadM <= PLAZA_KERB_GAP_M) {
          e.points = line.map((q) => q.slice());
          // its road stretch is the kerb strip before the zebra: not offered to 2c (a link the photo shows stays); step 4
          // covers it with an estimated crossing
          e.placed = "walkway_estimated";
          stats.plazaLinks.push({ edge: e.id, kept: line.length > 2 ? `to the crossing via ${line.length - 2} bend(s)` : "straight to the crossing", carriageway_m: round(roadM, 1), detour_m: Number.isFinite(freeM) ? round(freeM, 1) : null });
        } else {
          graph.edges.splice(graph.edges.indexOf(e), 1);
          stats.plazaLinks.push({ edge: e.id, dropped: true, straight_m: round(d, 1), detour_m: Number.isFinite(freeM) ? round(freeM, 1) : null });
        }
        continue;
      }
    }
    let cells = grid.route(a, b, { margin: Math.max(40, 0.6 * d) }) ?? grid.route(a, b, { margin: Math.max(150, d) });
    let crossesVehicle = false;
    if (!cells) {
      cells = grid.route(a, b, { margin: Math.max(40, 0.6 * d), vehicleCost: CARRIAGEWAY_COST });
      crossesVehicle = true;
    }
    if (!cells) {
      if (rejoin(e)) continue;
      warn(`walkways: ${e.id} has no route at all; geometry kept`);
      stats.unresolved.push({ edge: e.id, reason: "no route", length_m: round(lineLength(e.points), 1) });
      continue;
    }
    const before = lineLength(e.points);
    const pulled = pullString([a, ...cells.slice(1, -1), b], cellClass);
    e.points = pulled.map((p) => p.slice());
    e.placed = "walkway_estimated";
    stats.rerouted += 1;
    stats.rerouteGrowthM += lineLength(e.points) - before;
    if (crossesVehicle) {
      const onVehicle = sampleLine(e.points, SAMPLE_M).filter((q) => cellClass(q) === CLS.VEHICLE).length * SAMPLE_M;
      stats.unresolved.push({ edge: e.id, reason: "no carriageway-free route in the search window", vehicle_m: round(onVehicle, 1) });
      e.crosses_carriageway_m = round(onVehicle, 1);
    }
  }

  // every estimated person edge is drawn where people walk: no development-only centreline offset applies to it
  for (const e of graph.edges) if (personEdge(e) && e.estimated && !e.placed) e.placed = "walkway_estimated";

  // ---- 2b. a crosswalk line that leaves its painted polygon over the carriageway (traced line and digitised polygon
  // disagree) is re-drawn through the polygon: the search may cross the carriageway only at a high cost, so the route
  // runs inside the crossing polygon and keeps only the kerb-to-paint stretches on the road
  for (const e of graph.edges.filter((x) => x.kind === "crosswalk")) {
    const samples = sampleLine(e.points, SAMPLE_M);
    const classes = samples.map(cellClass);
    const longest = Math.max(0, ...runs(samples, classes, (c) => c === CLS.VEHICLE).map(([i, j]) => (j - i + 1) * SAMPLE_M));
    if (longest <= APPROACH_MAX_M) continue;
    const a = graph.nodes.get(e.from).p;
    const b = graph.nodes.get(e.to).p;
    const cells = grid.route(a, b, { margin: 20, vehicleCost: 25 });
    if (!cells) continue;
    const redrawn = pullString([a, ...cells.slice(1, -1), b], cellClass).map((p) => p.slice());
    const rs = sampleLine(redrawn, SAMPLE_M);
    const rc = rs.map(cellClass);
    // keep the re-drawn line only when it really stays inside the painted polygon up to the kerbs
    if (Math.max(0, ...runs(rs, rc, (c) => c === CLS.VEHICLE).map(([i, j]) => (j - i + 1) * SAMPLE_M)) > APPROACH_MAX_M) continue;
    e.points = redrawn;
    e.placed = "crossing_polygon";
    stats.crosswalksRedrawn += 1;
  }

  // ---- 2c. (pedestrians cross only at crossing polygons) an estimated edge that still crosses the carriageway is
  // dropped when every POI (where people start, dwell and leave) stays connected to the others without it
  // plaza nodes (connectors.mjs plazaLinks) count as POIs here: a walkable plaza stays joined to the network
  const essential = [...personNodes].filter((id) => ["poi", "plaza"].includes(graph.nodes.get(id)?.kind));
  const label = (edges) => {
    const uf = new UnionFind();
    for (const x of edges) uf.union(x.from, x.to);
    return uf;
  };
  const crossing = graph.edges.filter((x) => x.crosses_carriageway_m).sort((x, y) => y.crosses_carriageway_m - x.crosses_carriageway_m || x.id.localeCompare(y.id));
  const reference = label(graph.edges.filter(personEdge));
  const groupOf = new Map(essential.map((id) => [id, reference.find(id)]));
  for (const e of crossing) {
    const rest = graph.edges.filter((x) => personEdge(x) && x !== e);
    const uf = label(rest);
    const firstOf = new Map();
    const intact = essential.every((id) => {
      const g = groupOf.get(id);
      if (!firstOf.has(g)) firstOf.set(g, id);
      return uf.find(id) === uf.find(firstOf.get(g));
    });
    if (!intact) continue;
    graph.edges.splice(graph.edges.indexOf(e), 1);
    stats.droppedCrossingEdges.push(e.id);
    stats.unresolved = stats.unresolved.filter((u) => u.edge !== e.id);
  }

  // ---- 3. strips on open ground (every person edge), crossing approaches (crosswalk edges)
  const strips = [];
  const approaches = [];
  for (const e of graph.edges.filter(personEdge)) {
    for (let s = 0; s + 1 < e.points.length; s += 1) {
      const seg = [e.points[s], e.points[s + 1]];
      if (sampleLine(seg, SAMPLE_M).some((q) => cellClass(q) === CLS.OPEN)) {
        strips.push({ class: "walkway_estimated", id: `WALKWAY_${e.id}_${s}`, source_ref: e.id, estimated: true, rings: [stripRing(seg[0], seg[1], STRIP_HALF_WIDTH_M, STRIP_HALF_WIDTH_M)] });
        stats.stripM += dist(seg[0], seg[1]);
      }
    }
    const samples = sampleLine(e.points, SAMPLE_M);
    const classes = samples.map(cellClass);
    for (const [i, j] of runs(samples, classes, (c) => c === CLS.VEHICLE)) {
      const length = (j - i + 1) * SAMPLE_M;
      const touchesCrossing = classes[Math.max(0, i - 1)] === CLS.CROSSING || classes[Math.min(classes.length - 1, j + 1)] === CLS.CROSSING;
      if (e.kind === "crosswalk" && touchesCrossing && length <= EXTENSION_MAX_M) {
        const what = length <= APPROACH_MAX_M ? "kerb approach" : "extension to the opposite kerb (painted polygon shorter than the carriageway)";
        // the kerb-to-paint stretch, drawn along its own samples (the line may bend there)
        for (let k = i; k < j || k === i; k += 1) {
          const a = samples[k], b = samples[Math.min(k + 1, j)];
          approaches.push({ class: "crossing", id: `CWAPPROACH_${e.id}_${i}_${k}`, source_ref: `${e.crosswalk_id ?? e.id} ${what}`, estimated: true, rings: [stripRing(a, b, APPROACH_HALF_WIDTH_M, SAMPLE_M)] });
          if (j === i) break;
        }
        stats.approaches += 1;
      } else if (!e.estimated) stats.sidewalkOnVehicle.push({ edge: e.id, kind: e.kind, length_m: round(length, 1), at: samples[i].map((v) => round(v, 1)) });
    }
  }
  // ---- 4. estimated crossings: every estimated person edge still on the carriageway after 2c is needed to keep a POI
  // reachable; its road stretch becomes an estimated crossing polygon (class crossing_estimated, estimated: true), so
  // people cross the road only on a measured, painted or estimated crossing. The route penalty stays: a measured
  // crossing is still preferred wherever one connects.
  const crossings = [];
  for (const e of graph.edges.filter((x) => personEdge(x) && x.estimated)) {
    let onRoad = 0;
    for (let s = 0; s + 1 < e.points.length; s += 1) {
      const seg = [e.points[s], e.points[s + 1]];
      const samples = sampleLine(seg, SAMPLE_M);
      const classes = samples.map(cellClass);
      for (const [i, j] of runs(samples, classes, (c) => c === CLS.VEHICLE)) {
        const a = samples[i], b = samples[j];
        const what = (j - i + 1) * SAMPLE_M < 1 ? "kerb corner clip shorter than 1 m" : "estimated crossing (no CW polygon, no painted zebra)";
        crossings.push({ class: "crossing_estimated", id: `CWEST_${e.id}_${s}_${i}`, source_ref: `${e.id} ${what}; 추정`, estimated: true, rings: [stripRing(a, b, ESTIMATED_CROSSING_HALF_WIDTH_M, KERB_OVERLAP_M)] });
        onRoad += (j - i + 1) * SAMPLE_M;
      }
    }
    if (onRoad > 0) {
      e.crosses_carriageway_m = e.crosses_carriageway_m ?? round(onRoad, 1);
      e.crossing_estimated = true;
      stats.estimatedCrossings.push({ edge: e.id, carriageway_m: round(onRoad, 1) });
    }
  }
  stats.strips = strips.length;
  stats.stripM = round(stats.stripM, 1);
  stats.rerouteGrowthM = round(stats.rerouteGrowthM, 1);
  return { strips, approaches, crossings, moved, stats };
}

// The network build prunes person edges outside the main component after the walkways are drawn; the estimated strips,
// crossing approaches and estimated crossings of a pruned edge go with it, so no walkable surface remains for an edge
// that is not in the network. edgeIds: the ids of the edges kept. Returns the number removed per kind.
export function keepSurfacesOf(walkways, edgeIds) {
  const edgeOf = { strips: (x) => x.source_ref, approaches: (x) => x.id.slice("CWAPPROACH_".length).replace(/_\d+_\d+$/, ""), crossings: (x) => x.id.slice("CWEST_".length).replace(/_\d+_\d+$/, "") };
  const removed = {};
  for (const [key, of] of Object.entries(edgeOf)) {
    const kept = walkways[key].filter((x) => edgeIds.has(of(x)));
    removed[key] = walkways[key].length - kept.length;
    walkways[key] = kept;
  }
  return removed;
}

export const statsLine = (s) => `walkways: ${s.movedNodes} nodes moved off the carriageway, ${s.rerouted} estimated edges re-drawn (+${s.rerouteGrowthM} m), ${s.crosswalksRedrawn} crosswalk lines re-drawn through their polygon, ${s.droppedCrossingEdges.length} carriageway-crossing estimated edges dropped, ${s.plazaLinks.length} plaza detour links (${s.plazaLinks.map((x) => `${x.edge} ${x.dropped ? "dropped" : `${x.kept}, ${x.carriageway_m} m carriageway`}`).join(", ") || "none"}), ${s.rejoined.length} edges without any route replaced by a walkable link${s.rejoined.length ? ` (${s.rejoined.map((r) => (r.dropped ? `${r.edge} dropped` : `${r.edge} -> ${r.via} ${r.from}-${r.to} ${r.length_m} m`)).join(", ")})` : ""}, ${s.strips} estimated walkway strips (${s.stripM} m of line), ${s.approaches} crossing approaches (estimated), ${s.estimatedCrossings.length} estimated crossings on ${s.estimatedCrossings.reduce((t, c) => t + c.carriageway_m, 0).toFixed(1)} m of carriageway, ${s.unresolved.length} unresolved, ${s.sidewalkOnVehicle.length} measured stretches on the carriageway`;

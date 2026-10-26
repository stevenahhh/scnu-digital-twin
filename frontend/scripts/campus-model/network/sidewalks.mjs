#!/usr/bin/env bun
// Sidewalk strips and centrelines from the NGII A003 walkway outlines (plan uhf-ground-roads-routing todo 15, draft D-4:
// A003 first). Simulation frame (metres east/north of the D4 anchor in EPSG:5186 TM); sidewalks.json is written in
// EPSG:5186.
//
//   bun scripts/campus-model/network/sidewalks.mjs [--stats] [--preview <png>] [--window <name>] [--write]
//
// Strips (never offsets or buffers of a road; A003 geometry is used as surveyed):
//   1. every closed A003 ring is one strip polygon (a ring inside another ring of the same feature is its hole);
//   2. the open A003 lines are outline pieces cut at a neighbouring outline or at the data extent. They are first
//      chained end to end (ends within CHAIN_SNAP_M); a chain that closes, or whose two ends are at most
//      CLOSE_GAP_M apart, or whose ends both lie on the same side of the A003 data extent (the clip box), is closed
//      across that cut and becomes a strip (`width_source` as for rings, `outline: "chained"`);
//   3. the remaining open polylines are paired: two pair when their mean separation is in [0.8, 6.0] m, they overlap
//      over > 60 % of the shorter one and the angle is < 15 deg; the strip is the quad strip between them, its
//      centreline the midpoints every 1 m, its width the mean separation (`paired_lines`). Lines left over are logged
//      `unpaired A003 line ufid=<ufid>` and never extrapolated.
// Width: `widt` when > 0, else the rectangle solved from area and perimeter when the skeleton is one unbranched path
// (`area_perimeter`), else the median of 2 x the inscribed radius along the skeleton (`skeleton_median`).
// Centrelines: network/skeleton.mjs per strip, dead ends extended to the strip outline; nodes SWN_#### at junctions,
// ends and where a centreline end lies within SNAP_M of another centreline (snapped); strips that touch (within
// SNAP_M) and are still apart are joined by the shortest link that stays inside the two polygons. Vertices are
// densified to <= 10 m. IDs: SW_### of the strip's lowest ufid (common_elemetns.json sidewalk_placeholders, ascending
// ufid order), `_L` / `_R` when the strip runs parallel to one road segment (side of its travel direction).
import path from "node:path";
import { simulationToTm } from "../../../src/geo/epsg5186.mjs";
import { skeletonize } from "./skeleton.mjs";
import {
  LineGrid, PolygonGrid, UnionFind, densify, dist, inRings, lineLength, nearestOnLine, ringArea, ringsDistance, round, sampleLine, segmentNearest,
} from "./geom.mjs";

export const CHAIN_SNAP_M = 0.3;
export const CLOSE_GAP_M = 6;
export const EXTENT_CUT_M = 40;
export const SNAP_M = 1.0;
export const MAX_EDGE_M = 10;
export const PAIR = { minSep: 0.8, maxSep: 6, overlap: 0.6, angleDeg: 15 };
const MIN_AREA_M2 = 1;
const INSET_M = 0.1;
const isClosedLine = (l) => l.length >= 2 && dist(l[0], l.at(-1)) < 1e-9;

// ---------------------------------------------------------------- strips
function polygonsOfRings(rings) {
  const sorted = [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const polygons = [];
  for (const ring of sorted) {
    const host = polygons.find((poly) => inRings(ring[0], [poly[0]]) && !poly.slice(1).some((h) => inRings(ring[0], [h])));
    if (host) host.push(ring);
    else polygons.push([ring]);
  }
  return polygons;
}

// Chains open lines into closed outlines. lines: [{ ufid, widt, points }]; extent: [x0, y0, x1, y1] of the A003 data.
export function chainLines(lines, extent) {
  const used = new Array(lines.length).fill(false);
  const order = lines.map((l, i) => i).sort((a, b) => lineLength(lines[b].points) - lineLength(lines[a].points) || String(lines[a].ufid).localeCompare(String(lines[b].ufid)));
  const closed = [];
  const open = [];
  const onSide = (p) => {
    const sides = [];
    if (Math.abs(p[0] - extent[0]) < 0.5) sides.push("W");
    if (Math.abs(p[0] - extent[2]) < 0.5) sides.push("E");
    if (Math.abs(p[1] - extent[1]) < 0.5) sides.push("S");
    if (Math.abs(p[1] - extent[3]) < 0.5) sides.push("N");
    return sides;
  };
  for (const seed of order) {
    if (used[seed]) continue;
    used[seed] = true;
    let pts = lines[seed].points.slice();
    const members = [seed];
    let isClosed = dist(pts[0], pts.at(-1)) <= CHAIN_SNAP_M && pts.length > 3;
    for (let grow = 0; grow < 2 && !isClosed; grow += 1) {
      // grow = 0: forward from the end; grow = 1: backward from the start (reverse, grow, reverse back)
      if (grow === 1) pts = pts.slice().reverse();
      for (;;) {
        const end = pts.at(-1);
        const start = pts[0];
        const cands = [];
        lines.forEach((l, i) => {
          if (used[i]) return;
          if (dist(l.points[0], end) <= CHAIN_SNAP_M) cands.push({ i, pts: l.points });
          else if (dist(l.points.at(-1), end) <= CHAIN_SNAP_M) cands.push({ i, pts: l.points.slice().reverse() });
        });
        if (!cands.length) break;
        cands.sort((a, b) => (dist(b.pts.at(-1), start) <= CHAIN_SNAP_M) - (dist(a.pts.at(-1), start) <= CHAIN_SNAP_M) || lineLength(a.pts) - lineLength(b.pts) || a.i - b.i);
        const pick = cands[0];
        used[pick.i] = true;
        members.push(pick.i);
        pts = [...pts, ...pick.pts.slice(1)];
        if (dist(pts.at(-1), pts[0]) <= CHAIN_SNAP_M) {
          isClosed = true;
          break;
        }
      }
      if (grow === 1) pts = pts.slice().reverse();
    }
    let closure = null;
    if (isClosed) closure = "chained";
    else {
      const gap = dist(pts[0], pts.at(-1));
      const sharedSide = onSide(pts[0]).some((s) => onSide(pts.at(-1)).includes(s));
      if (lineLength(pts) > 4 * gap && gap <= CLOSE_GAP_M) closure = "cut";
      else if (sharedSide && gap <= EXTENT_CUT_M && lineLength(pts) > 2 * gap) closure = "data_extent";
    }
    const ufids = [...new Set(members.map((i) => lines[i].ufid))];
    if (closure) {
      const ring = pts.slice();
      if (dist(ring[0], ring.at(-1)) > 1e-9) ring.push(ring[0]);
      closed.push({ ring: ring.slice(0, -1), ufids, widt: lines[members[0]].widt, closure, members });
    } else {
      open.push({ points: pts, ufids, widt: lines[members[0]].widt, members });
    }
  }
  return { closed, open };
}

// Overlap of polyline b onto a: samples of a every 1 m whose nearest point on b is interior and within maxSep.
function overlapOf(a, b) {
  const samples = sampleLine(a, 1);
  const hits = [];
  for (let k = 0; k < samples.length; k += 1) {
    const p = samples[k];
    const n = nearestOnLine(p, b);
    if (n.d > PAIR.maxSep) continue;
    const endHit = (n.seg === 0 && n.t <= 1e-6) || (n.seg === b.length - 2 && n.t >= 1 - 1e-6);
    if (endHit) continue;
    const prev = samples[Math.max(0, k - 1)];
    const next = samples[Math.min(samples.length - 1, k + 1)];
    const da = [next[0] - prev[0], next[1] - prev[1]];
    const db = [b[n.seg + 1][0] - b[n.seg][0], b[n.seg + 1][1] - b[n.seg][1]];
    const cos = Math.abs(da[0] * db[0] + da[1] * db[1]) / ((Math.hypot(...da) * Math.hypot(...db)) || 1);
    hits.push({ k, p, q: n.q, d: n.d, s: n.s, angle: (Math.acos(Math.min(1, cos)) * 180) / Math.PI });
  }
  return { samples: samples.length, hits };
}

export function pairLines(lines) {
  const candidates = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const [a, b] = lineLength(lines[i].points) <= lineLength(lines[j].points) ? [lines[i], lines[j]] : [lines[j], lines[i]];
      const o = overlapOf(a.points, b.points);
      if (!o.hits.length) continue;
      const share = o.hits.length / o.samples;
      const sep = o.hits.reduce((s, h) => s + h.d, 0) / o.hits.length;
      const angle = o.hits.reduce((s, h) => s + h.angle, 0) / o.hits.length;
      if (share > PAIR.overlap && sep >= PAIR.minSep && sep <= PAIR.maxSep && angle < PAIR.angleDeg) candidates.push({ a, b, share, sep, hits: o.hits });
    }
  }
  candidates.sort((x, y) => y.share - x.share || x.sep - y.sep);
  const taken = new Set();
  const pairs = [];
  for (const c of candidates) {
    if (taken.has(c.a) || taken.has(c.b)) continue;
    taken.add(c.a);
    taken.add(c.b);
    pairs.push(c);
  }
  return { pairs, unpaired: lines.filter((l) => !taken.has(l)) };
}

// Rectangle width from area and perimeter (exact for a rectangle), else 2A/P.
export function areaPerimeterWidth(area, perimeter) {
  const h = perimeter / 2;
  const disc = h * h - 4 * area;
  return disc >= 0 ? (h - Math.sqrt(disc)) / 2 : (2 * area) / perimeter;
}

function rayHit(p, d, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den;
      const u = ((a[0] - p[0]) * d[1] - (a[1] - p[1]) * d[0]) / den;
      if (t > 1e-9 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
  }
  return best;
}

function directionAtEnd(points) {
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

// Centreline graph of one strip polygon: { nodes: [[x, y]], edges: [{ from, to, points }], width, widthSource }.
export function stripCentreline(strip, { pixelM = 0.125 } = {}) {
  const rings = strip.rings;
  const area = Math.abs(ringArea(rings[0])) - rings.slice(1).reduce((s, r) => s + Math.abs(ringArea(r)), 0);
  const perimeter = rings.reduce((s, r) => s + lineLength([...r, r[0]]), 0);
  if (strip.centreline) {
    // paired lines: the midpoints are the centreline
    const points = keepInside(strip.centreline, rings);
    return { nodes: [points[0], points.at(-1)], edges: [{ from: 0, to: 1, points }], width: strip.pairWidth, widthSource: "paired_lines", area, perimeter };
  }
  const sk = skeletonize(rings.map((r) => [...r, r[0]]), { pixelM });
  const nodes = sk.graph.nodes.map((p) => p.slice());
  const degree = new Map();
  for (const e of sk.graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const edges = sk.graph.edges.map((e) => ({ from: e.from, to: e.to, points: e.points.map((p) => p.slice()) }));
  for (const e of edges) {
    if (e.from === e.to) continue;
    for (const end of [0, 1]) {
      const node = end === 0 ? e.from : e.to;
      if (degree.get(node) !== 1) continue;
      const oriented = end === 1 ? e.points : e.points.slice().reverse();
      const dir = directionAtEnd(oriented);
      if (!dir) continue;
      const tip = oriented.at(-1);
      const hit = rayHit(tip, dir, rings);
      const r = sk.distanceAt(tip[0], tip[1]);
      if (hit === Infinity || hit > 2.5 * r + 2 || hit <= INSET_M) continue;
      const extended = [tip[0] + dir[0] * (hit - INSET_M), tip[1] + dir[1] * (hit - INSET_M)];
      if (end === 1) e.points.push(extended);
      else e.points.unshift(extended);
      nodes[node] = extended;
    }
  }
  for (const e of edges) e.points = keepInside(e.points, rings);
  for (const e of edges) {
    nodes[e.from] = e.points[0];
    nodes[e.to] = e.points.at(-1);
  }
  let width;
  let widthSource;
  const unbranched = edges.length === 1 && edges[0].from !== edges[0].to;
  if (strip.widt > 0) {
    width = strip.widt;
    widthSource = "widt";
  } else if (unbranched) {
    width = areaPerimeterWidth(area, perimeter);
    widthSource = "area_perimeter";
  } else {
    const w = edges.flatMap((e) => sampleLine(e.points, 1)).map((p) => 2 * sk.distanceAt(p[0], p[1])).filter((v) => v > 0).sort((a, b) => a - b);
    width = w.length ? w[w.length >> 1] : areaPerimeterWidth(area, perimeter);
    widthSource = "skeleton_median";
  }
  return { nodes, edges, width, widthSource, area, perimeter, pole: edges.length ? null : poleOf(rings, sk) };
}

// Pulls the vertices of a centreline that the thinning left outside its polygon (pixel staircases at cuts and narrow
// ends) back inside: densified to 0.25 m, every outside point moved to its nearest outline point plus 0.1 m inward,
// then Douglas-Peucker at 0.05 m.
export function keepInside(points, rings) {
  const closed = rings.map((r) => (dist(r[0], r.at(-1)) < 1e-9 ? r : [...r, r[0]]));
  if (sampleLine(points, 0.25).every((p) => inRings(p, closed))) return points;
  const dense = densify(points, 0.25).map((p) => {
    if (inRings(p, closed)) return p;
    let best = null;
    for (const ring of closed) for (let i = 0; i + 1 < ring.length; i += 1) {
      const r = segmentNearest(p, ring[i], ring[i + 1]);
      if (!best || r.d < best.d) best = r;
    }
    const v = [best.q[0] - p[0], best.q[1] - p[1]];
    const l = Math.hypot(v[0], v[1]) || 1;
    const inward = [best.q[0] + (v[0] / l) * 0.1, best.q[1] + (v[1] / l) * 0.1];
    return inRings(inward, closed) ? inward : best.q;
  });
  return simplifyLine(dense, 0.05);
}

function simplifyLine(points, tolerance) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points.at(-1)];
  let worst = -1;
  let worstD = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = segmentNearest(points[i], a, b).d;
    if (d > worstD) {
      worstD = d;
      worst = i;
    }
  }
  if (worstD <= tolerance) return [a, b];
  return [...simplifyLine(points.slice(0, worst + 1), tolerance).slice(0, -1), ...simplifyLine(points.slice(worst), tolerance)];
}

function poleOf(rings, sk) {
  const xs = rings[0].map((p) => p[0]);
  const ys = rings[0].map((p) => p[1]);
  let best = null;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.25) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.25) {
      const r = sk.distanceAt(x, y);
      if (r > 0 && (!best || r > best.r)) best = { p: [x, y], r };
    }
  }
  return best?.p ?? null;
}

// ---------------------------------------------------------------- builder
// walkways: [{ ufid, widt, qual, scls, lines }] (simulation frame); roadSegments: road_segments.geojson FC (simulation
// frame); placeholders: common_elemetns.json sidewalk_placeholders ([{ element_id, ufid }]).
export function buildSidewalks({ walkways, roadSegments = { features: [] }, placeholders = [], warn = console.warn, pixelM = 0.125 }) {
  const warnings = [];
  const log = (m) => {
    warnings.push(m);
    warn(m);
  };
  const strips = [];
  const openLines = [];
  const all = walkways.flatMap((w) => w.lines.flat());
  const extent = all.length ? [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))] : [0, 0, 0, 0];
  let rings = 0;
  for (const w of walkways) {
    const closedRings = [];
    for (const line of w.lines) {
      if (isClosedLine(line)) {
        if (line.length < 4) {
          log(`A003 ufid=${w.ufid}: ring with ${line.length} points skipped`);
          continue;
        }
        rings += 1;
        closedRings.push(line.slice(0, -1));
      } else if (line.length >= 2) openLines.push({ ufid: w.ufid, widt: w.widt, points: line, walkway: w });
    }
    for (const poly of polygonsOfRings(closedRings)) strips.push({ rings: poly, ufids: [w.ufid], widt: w.widt, outline: "ring", qual: w.qual, scls: w.scls });
  }
  const chained = chainLines(openLines, extent);
  for (const c of chained.closed) {
    if (Math.abs(ringArea(c.ring)) < MIN_AREA_M2) {
      log(`A003 chained outline ${c.ufids.join("+")}: area < ${MIN_AREA_M2} m2, skipped`);
      continue;
    }
    const w = openLines[c.members[0]].walkway;
    strips.push({ rings: [c.ring], ufids: c.ufids, widt: c.widt, outline: c.closure === "chained" ? "chained" : `chained_${c.closure}_closure`, qual: w.qual, scls: w.scls });
  }
  const { pairs, unpaired } = pairLines(chained.open);
  for (const p of pairs) {
    const first = p.hits[0];
    const last = p.hits.at(-1);
    const aPart = p.hits.map((h) => h.p);
    const bPart = p.hits.map((h) => h.q);
    const centreline = p.hits.map((h) => [(h.p[0] + h.q[0]) / 2, (h.p[1] + h.q[1]) / 2]);
    const w = openLines[p.a.members[0]].walkway;
    void first;
    void last;
    strips.push({ rings: [[...aPart, ...bPart.reverse()]], ufids: [...new Set([...p.a.ufids, ...p.b.ufids])], widt: 0, outline: "paired", centreline, pairWidth: p.sep, qual: w.qual, scls: w.scls });
  }
  for (const u of unpaired) log(`unpaired A003 line ufid=${u.ufids.join("+")} (${lineLength(u.points).toFixed(1)} m)`);

  // ---- ids: lowest ufid -> SW_### placeholder; no ufid -> next free number
  const placeholderOf = new Map(placeholders.map((p) => [p.ufid, p.element_id]));
  let nextFree = Math.max(0, ...placeholders.map((p) => Number(p.element_id.slice(3)))) + 1;
  for (const s of strips) {
    s.ufids = s.ufids.filter((u) => u !== null && u !== undefined).sort();
    if (!s.ufids.length) s.noUfid = true;
  }
  strips.sort((a, b) => (a.ufids[0] ?? "~").localeCompare(b.ufids[0] ?? "~") || Math.abs(ringArea(b.rings[0])) - Math.abs(ringArea(a.rings[0])) || a.rings[0][0][0] - b.rings[0][0][0]);
  const baseCount = new Map();
  for (const s of strips) {
    let base = s.ufids.length ? placeholderOf.get(s.ufids[0]) : null;
    if (!base) {
      base = `SW_${String(nextFree).padStart(3, "0")}`;
      nextFree += 1;
    }
    const n = (baseCount.get(base) ?? 0) + 1;
    baseCount.set(base, n);
    s.base = n === 1 ? base : `${base}-${n}`;
  }

  // ---- centrelines
  for (const s of strips) {
    const c = stripCentreline(s, { pixelM });
    s.centre = c;
    s.width = c.width;
    s.widthSource = c.widthSource;
    s.area = c.area;
  }

  // ---- side by the parallel road segment
  const segLines = (roadSegments.features ?? []).filter((f) => f.geometry && f.properties.kind === "interior").flatMap((f) => (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates).map((points) => ({ points, id: f.properties.id })));
  const segGrid = new LineGrid(segLines, 25);
  for (const s of strips) {
    const pts = s.centre.edges.flatMap((e) => sampleLine(e.points, 2));
    if (pts.length < 2) continue;
    const votes = new Map();
    for (let k = 0; k + 1 < pts.length; k += 1) {
      const p = pts[k];
      const n = segGrid.nearest(p, 15);
      if (!n) continue;
      const a = n.line.points[n.seg];
      const b = n.line.points[n.seg + 1];
      const u = [b[0] - a[0], b[1] - a[1]];
      const v = [pts[k + 1][0] - p[0], pts[k + 1][1] - p[1]];
      const cos = Math.abs(u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1);
      if (Math.acos(Math.min(1, cos)) > (20 * Math.PI) / 180) continue;
      const side = u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0]) > 0 ? "L" : "R";
      const key = `${n.line.id}|${side}`;
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
    const best = [...votes.entries()].sort((x, y) => y[1] - x[1])[0];
    if (best && best[1] >= 0.6 * (pts.length - 1)) {
      const [roadId, side] = best[0].split("|");
      s.side = side;
      s.roadId = roadId;
    }
  }
  const idCount = new Map();
  for (const s of strips) {
    const id = s.side ? `${s.base}_${s.side}` : s.base;
    const n = (idCount.get(id) ?? 0) + 1;
    idCount.set(id, n);
    s.id = n === 1 ? id : `${id}-${n}`;
  }

  // ---- graph
  const nodes = []; // { p, strip }
  const edges = []; // { from, to, points, strip, link? }
  const uf = new UnionFind();
  const addNode = (p, strip) => nodes.push({ p, strip }) - 1;
  for (const s of strips) {
    const ids = s.centre.nodes.map((p) => addNode(p, s));
    s.nodeIds = ids;
    for (const e of s.centre.edges) edges.push({ from: ids[e.from], to: ids[e.to], points: e.points, strip: s });
    if (!s.centre.edges.length && s.centre.pole) s.nodeIds = [addNode(s.centre.pole, s)];
  }
  const splitEdge = (ei, seg, q) => {
    const e = edges[ei];
    const n = addNode(q, e.strip);
    const first = { ...e, to: n, points: [...e.points.slice(0, seg + 1), q] };
    const second = { ...e, from: n, points: [q, ...e.points.slice(seg + 1)] };
    edges.splice(ei, 1, first, second);
    return n;
  };
  const polyGrid = new PolygonGrid(strips.map((s) => ({ rings: s.rings, strip: s })), 25);
  const degree = () => {
    const d = new Map();
    for (const e of edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1);
      d.set(e.to, (d.get(e.to) ?? 0) + 1);
    }
    return d;
  };
  const insideUnion = (a, b, polys) => {
    const n = Math.max(1, Math.ceil(dist(a, b) / 0.25));
    let inside = 0;
    for (let k = 0; k <= n; k += 1) {
      const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      if (polys.some((poly) => inRings(p, poly.rings) || ringsDistance(p, poly.rings) <= 0.3)) inside += 1;
    }
    return inside / (n + 1);
  };
  // nearest point on the centreline edges of strips other than `strip`
  const nearestEdge = (p, reach, accept) => {
    let best = null;
    edges.forEach((e, ei) => {
      if (!accept(e)) return;
      for (let i = 0; i + 1 < e.points.length; i += 1) {
        const r = segmentNearest(p, e.points[i], e.points[i + 1]);
        if (r.d <= reach && (!best || r.d < best.d)) best = { ...r, ei, seg: i };
      }
    });
    return best;
  };
  const attach = (best) => {
    const e = edges[best.ei];
    const near = [[e.from, e.points[0]], [e.to, e.points.at(-1)]].find(([, q]) => dist(q, best.q) <= SNAP_M);
    return near ? near[0] : splitEdge(best.ei, best.seg, best.q);
  };
  // 1. ends within SNAP_M of another strip's centreline: snap
  const d0 = degree();
  const merged = new Map(); // node -> representative
  for (let n = 0; n < nodes.length; n += 1) {
    if (d0.get(n) !== 1) continue;
    const best = nearestEdge(nodes[n].p, SNAP_M, (e) => e.strip !== nodes[n].strip);
    if (!best) continue;
    const target = attach(best);
    merged.set(n, target);
    // a short link keeps each strip's own centreline inside its polygon
    if (dist(nodes[n].p, nodes[target].p) > 0.01) edges.push({ from: n, to: target, points: [nodes[n].p, nodes[target].p], strip: nodes[n].strip, link: true });
    else uf.union(target, n);
  }
  // 2. strips that touch but are still apart: shortest link inside the two polygons
  const components = () => {
    const c = new UnionFind();
    for (const e of edges) c.union(uf.find(e.from), uf.find(e.to));
    for (let n = 0; n < nodes.length; n += 1) c.union(uf.find(n), uf.find(n));
    return (n) => c.find(uf.find(n));
  };
  const adjacent = [];
  for (let i = 0; i < strips.length; i += 1) {
    for (let j = i + 1; j < strips.length; j += 1) {
      const a = strips[i];
      const b = strips[j];
      const near = a.rings[0].some((p) => ringsDistance(p, b.rings) <= SNAP_M) || b.rings[0].some((p) => ringsDistance(p, a.rings) <= SNAP_M) || a.rings[0].some((p) => inRings(p, b.rings)) || b.rings[0].some((p) => inRings(p, a.rings));
      if (near) adjacent.push([a, b]);
    }
  }
  const attachPoints = (s) => {
    const pts = [];
    edges.forEach((e, ei) => {
      if (e.strip !== s || e.link) return;
      for (let i = 0; i + 1 < e.points.length; i += 1) {
        const n = Math.max(1, Math.ceil(dist(e.points[i], e.points[i + 1])));
        for (let k = i === 0 ? 0 : 1; k <= n; k += 1) pts.push({ p: [e.points[i][0] + ((e.points[i + 1][0] - e.points[i][0]) * k) / n, e.points[i][1] + ((e.points[i + 1][1] - e.points[i][1]) * k) / n], ei, seg: i, t: k / n });
      }
    });
    for (const n of s.nodeIds) if (!edges.some((e) => e.from === n || e.to === n)) pts.push({ p: nodes[n].p, node: n });
    return pts;
  };
  let links = 0;
  for (let guard = 0; guard < 400; guard += 1) {
    const comp = components();
    let best = null;
    for (const [a, b] of adjacent) {
      const pa = attachPoints(a);
      const pb = attachPoints(b);
      if (!pa.length || !pb.length) continue;
      const compOf = (x) => comp(x.node ?? edges[x.ei].from);
      const ca = new Set(pa.map(compOf));
      if (pb.some((x) => ca.has(compOf(x)))) continue;
      const pairs = [];
      for (const x of pa) for (const y of pb) pairs.push([dist(x.p, y.p), x, y]);
      pairs.sort((u, v) => u[0] - v[0]);
      for (const [d, x, y] of pairs.slice(0, 4000)) {
        if (best && d >= best.d) break;
        if (d > 25) break;
        if (insideUnion(x.p, y.p, [a, b]) >= 0.9) {
          best = { d, x, y };
          break;
        }
      }
    }
    if (!best) break;
    const nodeFor = (att) => {
      if (att.node !== undefined) return att.node;
      const e = edges[att.ei];
      const q = att.p;
      const near = [[e.from, e.points[0]], [e.to, e.points.at(-1)]].find(([, r]) => dist(r, q) <= 0.01);
      if (near) return near[0];
      // locate q's segment again (indices may have moved after a split)
      const ei = edges.indexOf(e);
      return splitEdge(ei, att.seg, q);
    };
    // split the later edge first so the earlier index stays valid
    const [first, second] = (best.x.ei ?? -1) > (best.y.ei ?? -1) ? [best.x, best.y] : [best.y, best.x];
    const n1 = nodeFor(first);
    const n2 = nodeFor(second);
    if (dist(nodes[n1].p, nodes[n2].p) <= 1e-6) uf.union(n1, n2);
    else edges.push({ from: n1, to: n2, points: [nodes[n1].p, nodes[n2].p], strip: first.ei !== undefined ? edges.find((e) => e.from === n1 || e.to === n1)?.strip ?? nodes[n1].strip : nodes[n1].strip, link: true });
    links += 1;
  }

  // ---- collapse, densify, number
  const rep = (n) => uf.find(n);
  const finalEdges = [];
  for (const e of edges) {
    const from = rep(e.from);
    const to = rep(e.to);
    const pts = e.points.map((p) => p.slice());
    pts[0] = nodes[from].p;
    pts[pts.length - 1] = nodes[to].p;
    if (from === to && pts.length < 3) continue;
    if (lineLength(pts) < 0.05) continue;
    finalEdges.push({ ...e, from, to, points: densify(pts, MAX_EDGE_M) });
  }
  const usedNodes = [...new Set(finalEdges.flatMap((e) => [e.from, e.to]))];
  usedNodes.sort((a, b) => nodes[a].p[0] - nodes[b].p[0] || nodes[a].p[1] - nodes[b].p[1]);
  const nodeId = new Map(usedNodes.map((n, i) => [n, `SWN_${String(i + 1).padStart(4, "0")}`]));
  const outNodes = usedNodes.map((n) => ({ id: nodeId.get(n), p: nodes[n].p.map((v) => round(v)), sidewalk_id: nodes[n].strip.id }));
  const outEdges = finalEdges.map((e, i) => {
    const s = e.strip;
    const noUfid = s.noUfid;
    return {
      id: `EDGE_SW_${String(i + 1).padStart(4, "0")}`,
      from: nodeId.get(e.from), to: nodeId.get(e.to), points: e.points.map((p) => p.map((v) => round(v))),
      kind: "sidewalk", sidewalk_id: s.id, width_m: round(s.width, 2), width_source: s.widthSource,
      source: noUfid ? "manually-digitized" : "NGII-A003", source_ref: noUfid ? "walkways_wgs84.geojson feature without ufid" : s.ufids.join("+"),
      authoritative: !noUfid, derived: false, estimated: false, confidence: noUfid ? 0.5 : 0.8, link: Boolean(e.link),
      surface: s.scls === "A0033327" ? "bicycle" : "sidewalk",
    };
  });
  // components of the sidewalk graph
  const cuf = new UnionFind();
  for (const e of outEdges) cuf.union(e.from, e.to);
  const comps = new Set(outNodes.map((n) => cuf.find(n.id)));

  const coverageGrid = new PolygonGrid(strips.map((s) => ({ rings: s.rings })), 25);
  const coverage = (x, y) => coverageGrid.distance([x, y], 1.0) <= 1.0;
  const stripsOut = strips.map((s) => ({
    id: s.id, ufids: s.ufids, outline: s.outline, rings: s.rings.map((r) => r.map((p) => p.map((v) => round(v)))),
    width_m: round(s.width, 2), width_source: s.widthSource, widt: s.widt || null, area_m2: round(s.area, 1),
    road_id: s.roadId ?? null, side: s.side ?? null, surface: s.scls === "A0033327" ? "bicycle" : "sidewalk",
    source: s.noUfid ? "manually-digitized" : "NGII-A003",
    centreline_m: round(s.centre.edges.reduce((sum, e) => sum + lineLength(e.points), 0), 1),
  }));
  const stats = {
    rings, openLines: openLines.length, chained: chained.closed.length, paired: pairs.length, unpaired: unpaired.length,
    strips: strips.length, centrelineM: round(outEdges.filter((e) => !e.link).reduce((s, e) => s + lineLength(e.points), 0), 1),
    nodes: outNodes.length, edges: outEdges.length, links: outEdges.filter((e) => e.link).length, components: comps.size,
  };
  return { strips: stripsOut, nodes: outNodes, edges: outEdges, coverage, unpaired: unpaired.map((u) => ({ ufids: u.ufids, points: u.points })), warnings, stats, polygons: polyGrid };
}

// Every centreline sample (0.5 m) of a strip's own (non-link) edges must lie inside (or within 0.05 m of) its polygon.
export function centrelineOutside(result) {
  const byId = new Map(result.strips.map((s) => [s.id, s]));
  const out = [];
  for (const e of result.edges) {
    if (e.link) continue;
    const s = byId.get(e.sidewalk_id);
    for (const p of sampleLine(e.points, 0.5)) if (!inRings(p, s.rings) && ringsDistance(p, s.rings) > 0.05) out.push({ edge: e.id, strip: s.id, at: p.map((v) => round(v, 2)) });
  }
  return out;
}

export const statsLine = (s) => `rings ${s.rings}, open lines ${s.openLines} (chained into ${s.chained} outlines), paired ${s.paired}, unpaired ${s.unpaired}, strips ${s.strips}, centreline ${s.centrelineM} m; nodes ${s.nodes}, edges ${s.edges} (links ${s.links}), components ${s.components}`;

// sidewalks.json (EPSG:5186) for the record and the builders that read the file.
export function sidewalksJson(result) {
  const tm = (pts) => pts.map(([x, z]) => simulationToTm({ x, z }).map((v) => round(v)));
  return {
    metadata: { generator: "frontend/scripts/campus-model/network/sidewalks.mjs", coordinate_system: "EPSG:5186 (Korea 2000 / Central Belt 2010)", source: "NGII A003 walkway outlines (docs/assets/data/walkways_wgs84.geojson)", stats: result.stats },
    strips: result.strips.map((s) => ({ ...s, rings: s.rings.map(tm) })),
    nodes: result.nodes.map((n) => ({ ...n, p: simulationToTm({ x: n.p[0], z: n.p[1] }).map((v) => round(v)) })),
    edges: result.edges.map((e) => ({ ...e, points: tm(e.points) })),
    unpaired: result.unpaired.map((u) => ({ ufids: u.ufids, points: tm(u.points) })),
  };
}

// Add-only fill of the SW_ placeholders: width_m, width_source and the strip ids of each ufid.
export function fillPlaceholders(elementsText, result) {
  const parsed = JSON.parse(elementsText);
  const at = elementsText.indexOf('\n  "sidewalk_placeholders": [');
  if (at < 0 || !parsed.sidewalk_placeholders) throw new Error("common_elemetns.json: sidewalk_placeholders not found");
  const filled = parsed.sidewalk_placeholders.map((p) => {
    const strips = result.strips.filter((s) => s.ufids.includes(p.ufid));
    if (!strips.length) return p;
    const main = strips[0];
    return { ...p, width_m: main.width_m, width_source: main.width_source, strip_ids: strips.map((s) => s.id) };
  });
  const block = JSON.stringify(filled, null, 2).split("\n").map((l, i) => (i ? `  ${l}` : l)).join("\n");
  const out = `${elementsText.slice(0, at)}\n  "sidewalk_placeholders": ${block}\n}\n`;
  const check = JSON.parse(out);
  const before = new Set([...parsed.elements.map((e) => e.element_id), ...parsed.sidewalk_placeholders.map((e) => e.element_id)]);
  const after = new Set([...check.elements.map((e) => e.element_id), ...check.sidewalk_placeholders.map((e) => e.element_id)]);
  if (before.size !== after.size || [...before].some((id) => !after.has(id))) throw new Error("common_elemetns.json: id set changed");
  return out;
}

// ---------------------------------------------------------------- CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const { PATHS, readJson, walkwayFeatures } = await import("./context.mjs");
  const walkways = walkwayFeatures(await readJson(PATHS.walkways));
  const roadSegments = await readJson(PATHS.roadSegments);
  const elementsText = await Bun.file(PATHS.elements).text();
  const placeholders = JSON.parse(elementsText).sidewalk_placeholders ?? [];
  const result = buildSidewalks({ walkways, roadSegments, placeholders });
  console.log(statsLine(result.stats));
  const outside = centrelineOutside(result);
  console.log(`centreline samples outside their strip: ${outside.length}${outside.length ? ` ${JSON.stringify(outside.slice(0, 10))}` : ""}`);
  const widths = result.strips.reduce((acc, s) => ({ ...acc, [s.width_source]: (acc[s.width_source] ?? 0) + 1 }), {});
  console.log(`width sources ${JSON.stringify(widths)}; outlines ${JSON.stringify(result.strips.reduce((acc, s) => ({ ...acc, [s.outline]: (acc[s.outline] ?? 0) + 1 }), {}))}; sides ${result.strips.filter((s) => s.side).length}`);
  const previewPath = arg("--preview");
  if (previewPath) {
    const { renderPreview } = await import("./preview.mjs");
    await renderPreview({
      layers: result.strips.map((s) => ({ class: "sidewalk", rings: s.rings })),
      edges: result.edges.map((e) => ({ kind: "sidewalk", points: e.points })),
      nodes: result.nodes.map((n) => ({ p: n.p })),
      points: result.unpaired.flatMap((u) => u.points),
      out: path.resolve(previewPath),
      window: arg("--window"),
    });
    console.log(`preview ${previewPath}`);
  }
  if (args.includes("--write")) {
    await Bun.write(PATHS.sidewalks, `${JSON.stringify(sidewalksJson(result))}\n`);
    const text = fillPlaceholders(elementsText, result);
    await Bun.write(PATHS.elements, text);
    await Bun.write(PATHS.elementsCopy, text);
    console.log(`written ${path.relative(process.cwd(), PATHS.sidewalks)}; SW_ placeholders filled (add-only)`);
  }
  process.exit(outside.length ? 1 : 0);
}

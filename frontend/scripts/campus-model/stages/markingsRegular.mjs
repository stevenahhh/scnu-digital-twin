// Regular geometry for the road markings the paint gate accepted (stages/markings.mjs, loadMarkings step 4).
//
// The gate decides WHERE paint exists (each photo detection is checked against the NGII sheet); this step decides
// what the paint looks like, from the statute shapes, so the model shows straight lines, equal dashes, one regular
// zebra per crossing and clean symbols instead of the detections' traced fragments and pixel blobs:
//   - lines (STROKED kinds and stop lines): fragments of one line are chained (lib/markingFit.mjs chainFragments) and
//     fitted as straight runs joined by tangent arcs (fitPath); straight runs of neighbouring parallel lines share one
//     direction; dashed kinds get statute dashes with the phase of the detected dashes (or the photo's own period when
//     it clearly differs); double yellow lines are two strokes DOUBLE_OFFSET_M either side of the fitted centreline;
//     stop lines are straight rectangles square to the lane they close;
//   - zebras: one rectangle per crossing (bar groups that overlap are one crossing), bars along the carriageway at the
//     measured period, the phase of the detected bars;
//   - arrows, text, diamonds, give-way triangles, chevrons, wheelchair and bicycle symbols: templates
//     (lib/markingGlyphs.mjs) at the detected centre, orientation and size; text the photo cannot be read on is the
//     most likely statute text and logged as 추정;
//   - other painted areas (hatch stripes, hump bands, blue bays, stall frames): rectangles, or outlines whose edges are
//     snapped to the dominant directions of their group;
//   - nothing is kept on a modelled building or an A003 sidewalk, and fitted lines of one colour that cover the same
//     paint are drawn once.
// Coordinates: candidates come in scene units; everything here works in metres and converts back at the end.
import {
  add, chainFragments, dashPhase, dot, fitCrossing, layDashes, measuredPeriod, mergeCrossings, norm, offsetPath, orientedBox,
  polylineLength, projectArc, rect, resample, scale, slicePath, straightness, sub, unit, fitPath, distanceToPolyline, median,
} from "../lib/markingFit.mjs";
import {
  ARROW_KINDS, arrowTemplate, bicycleTemplate, chevronTemplate, diamondTemplate, textBlock, triangleTemplate, wheelchairTemplate,
} from "../lib/markingGlyphs.mjs";

const LINE_KINDS = new Set(["lane_line_dashed", "lane_line_solid", "edge_line", "centre_line_yellow", "parking_line", "kerb_no_parking", "give_way_line"]);
const ROAD_LINE_KINDS = new Set(["lane_line_dashed", "lane_line_solid", "edge_line", "centre_line_yellow"]);
// Chaining reach per kind (metres): a dashed line links over one hidden dash (two gaps and a dash of the 3 m / 5 m
// pattern), a solid line over a car-length occlusion only.
const CHAIN_GAP_M = { dashed: 13.5, solid: 3 };
// Parallel straight lines within PARALLEL_REACH_M of each other whose directions differ by at most PARALLEL_DEG share
// one direction (lanes of one road are parallel), unless that moves a line off its paint (PARALLEL_KEEP_M).
const PARALLEL_DEG = 3;
const PARALLEL_REACH_M = 8;
const PARALLEL_KEEP_M = 0.2;
// A stop line within STOP_REACH_M of a lane line whose normal is within STOP_SNAP_DEG of the stop line is squared to it.
const STOP_REACH_M = 10;
const STOP_SNAP_DEG = 25;
// Fitted lines of one colour within DUP_LATERAL_M of each other over DUP_SHARE of the shorter are one line.
const DUP_LATERAL_M = 0.25;
const DUP_SHARE = 0.5;
// Pieces with more than BLOCKED_SHARE of their samples on a building or a sidewalk are left out; lines are cut there.
const BLOCKED_SHARE = 0.25;
const RECT_FILL = 0.72;
const SNAP_DEG = 12;
// A snapped outline whose corners move further than OUTLINE_MOVE_M from the traced ones keeps its simplified trace.
const OUTLINE_MOVE_M = 0.35;
const TEXT_MIN_AREA_M2 = 0.3;
const ARROW_SNAP_DEG = 25;
const TEXT_BLOCK_M = 1.5;
const TEXT_SEED_REACH_M = 5;
const TEXT_LONG_WORD_M = 2.6;
const TEXT_STALL_REACH_M = 3;
// Text and crossings take the road's direction from a road line at least TEXT_ROAD_MIN_M long; a crossing's bars are
// set parallel to it only when they already lie within ZEBRA_ROAD_SNAP_DEG (crossings may be skewed to the road).
const TEXT_ROAD_MIN_M = 10;
const TEXT_AXIS_REACH_M = 15;
const ZEBRA_ROAD_SNAP_DEG = 5;
// A blue bay piece at least BAY_ROW_M long (and 1.6 times its depth) is a row of bays BAY_WIDTH_M wide (statute
// disabled bay 3.3-3.5 m, 추정).
const BAY_ROW_M = 6.5;
const BAY_WIDTH_M = 3.4;
const BAY_SYMBOL_BLOB_M = 2.2;
const ZEBRA_ROW_GAP_M = 1.0;
const ZEBRA_PERIOD_RANGE_M = [0.88, 0.93];
const ZEBRA_ALIGN_PERIOD_M = 0.005;
const ZEBRA_ALIGN_PHASE_M = 0.1;

const perpOf = (d) => [-d[1], d[0]];
// Right of travel `f` in the model plane (x east, z south): (-f.z, f.x).
const rightOf = (f) => [-f[1], f[0]];
const angleBetween = (a, b) => Math.acos(Math.min(1, Math.abs(dot(unit(a), unit(b))))) * (180 / Math.PI);

function areaOf(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s / 2;
}
const polygonArea = (rings) => Math.abs(areaOf(rings[0])) - rings.slice(1).reduce((s, r) => s + Math.abs(areaOf(r)), 0);
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < xi + ((p[1] - zi) / (zj - zi)) * (xj - xi)) inside = !inside;
  }
  return inside;
}
const inPolygon = (p, rings) => rings.filter((r) => inRing(p, r)).length % 2 === 1;
function gridIn(polys, step) {
  const all = polys.flatMap((rings) => rings[0]);
  const xs = all.map((p) => p[0]);
  const zs = all.map((p) => p[1]);
  const out = [];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
    for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) if (polys.some((rings) => inPolygon([x, z], rings))) out.push([x, z]);
  }
  return out;
}

// Polyline stroked `half` metres either side, mitred (limit 2), as one ring.
export function strokePath(line, half) {
  const pts = line.filter((p, i) => i === 0 || norm(sub(p, line[i - 1])) > 1e-6);
  if (pts.length < 2) return null;
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i += 1) {
    const before = i > 0 ? unit(sub(pts[i], pts[i - 1])) : null;
    const after = i + 1 < pts.length ? unit(sub(pts[i + 1], pts[i])) : null;
    const tangent = before && after ? unit(add(before, after)) : before ?? after;
    const normal = perpOf(tangent);
    const reference = after ?? before;
    const k = half / Math.max(0.5, dot(normal, perpOf(reference)));
    left.push(add(pts[i], scale(normal, k)));
    right.push(sub(pts[i], scale(normal, k)));
  }
  return [...left, ...right.reverse()];
}

// Outline with its edges snapped to `directions` (within SNAP_DEG) and corners re-intersected; falls back to the
// simplified outline when snapping would move a corner more than 0.3 m.
function simplify(ring, tol) {
  const closed = [...ring, ring[0]];
  const keep = new Array(closed.length).fill(false);
  keep[0] = keep[closed.length - 1] = true;
  const rdp = (a, b) => {
    let worst = -1;
    let dmax = tol;
    const ab = sub(closed[b], closed[a]);
    const l = norm(ab) || 1;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs(ab[0] * (closed[i][1] - closed[a][1]) - ab[1] * (closed[i][0] - closed[a][0])) / l;
      if (d > dmax) {
        dmax = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = true;
      rdp(a, worst);
      rdp(worst, b);
    }
  };
  // split at the farthest point from the first so a closed ring simplifies on both halves
  let far = 1;
  for (let i = 1; i < ring.length; i += 1) if (norm(sub(ring[i], ring[0])) > norm(sub(ring[far], ring[0]))) far = i;
  keep[far] = true;
  rdp(0, far);
  rdp(far, closed.length - 1);
  return closed.filter((_, i) => keep[i]).slice(0, -1);
}
// Dominant edge directions of a ring (length-weighted, modulo 180 deg): up to four peaks 15 deg apart, each with at
// least a tenth of the outline (the rails and rungs of a stall row, the sides of a frame).
export function dominantDirections(ring) {
  const bins = new Float64Array(90);
  let total = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const length = norm(sub(q, p));
    const angle = ((Math.atan2(q[1] - p[1], q[0] - p[0]) % Math.PI) + Math.PI) % Math.PI;
    bins[Math.floor((angle / Math.PI) * 90) % 90] += length;
    total += length;
  });
  const smooth = Array.from(bins, (_, k) => bins[(k + 89) % 90] + bins[k] + bins[(k + 1) % 90]);
  const out = [];
  for (let n = 0; n < 4; n += 1) {
    let best = -1;
    for (let k = 0; k < 90; k += 1) {
      if (out.some((o) => Math.min(Math.abs(o.k - k), 90 - Math.abs(o.k - k)) < 8)) continue;
      if (best < 0 || smooth[k] > smooth[best]) best = k;
    }
    if (best < 0 || smooth[best] < 0.1 * total) break;
    // the weighted mean angle inside the peak's three bins
    const angle = ((best + 0.5) / 90) * Math.PI;
    out.push({ k: best, u: [Math.cos(angle), Math.sin(angle)] });
  }
  // refine each peak to the length-weighted mean direction of the edges within 6 deg of it
  return out.map(({ u }) => {
    let acc = [0, 0];
    ring.forEach((p, i) => {
      const d = sub(ring[(i + 1) % ring.length], p);
      const l = norm(d);
      if (l < 1e-9) return;
      const e = scale(d, 1 / l);
      if (Math.abs(dot(e, u)) < Math.cos((6 * Math.PI) / 180)) return;
      acc = add(acc, scale(e, l * Math.sign(dot(e, u))));
    });
    return norm(acc) > 0 ? unit(acc) : u;
  });
}

// The traced outline is pixel-jittered (0.25 m photo): simplify it at growing tolerances until the snapped outline
// keeps every corner within OUTLINE_MOVE_M of the trace; else the finest simplified trace.
export const simplifyRing = (ring) => simplify(ring, 0.1);
export function regularOutline(ring, directions) {
  for (const tol of [0.1, 0.15, 0.2, 0.3]) {
    const out = snapOutline(ring, directions, tol);
    if (out) return out;
  }
  return simplify(ring, 0.1);
}

function snapOutline(ring, directions, tol) {
  const simple = simplify(ring, tol);
  if (simple.length < 3) return null;
  const dirs = [...dominantDirections(simple), ...directions];
  const cosSnap = Math.cos((SNAP_DEG * Math.PI) / 180);
  const cosMerge = Math.cos((8 * Math.PI) / 180);
  let edges = simple.map((p, i) => {
    const q = simple[(i + 1) % simple.length];
    const d = unit(sub(q, p));
    const best = dirs.map((u) => ({ u, c: Math.abs(dot(u, d)) })).sort((x, y) => y.c - x.c)[0];
    const dir = best && best.c >= cosSnap ? scale(best.u, Math.sign(dot(best.u, d)) || 1) : d;
    return { mid: scale(add(p, q), 0.5), dir, length: norm(sub(q, p)) };
  });
  // merge consecutive edges running the same way (within 8 deg): one straight side, its direction the longer one's
  const same = (x, y) => dot(x.dir, y.dir) >= cosMerge;
  const merge = (x, y) => {
    const length = x.length + y.length;
    return { mid: scale(add(scale(x.mid, x.length), scale(y.mid, y.length)), 1 / length), dir: x.length >= y.length ? x.dir : y.dir, length };
  };
  const start = edges.findIndex((e, i) => !same(edges[(i + edges.length - 1) % edges.length], e));
  if (start < 0) return null;
  edges = [...edges.slice(start), ...edges.slice(0, start)];
  const runs = [];
  for (const e of edges) {
    if (runs.length && same(runs.at(-1), e)) runs[runs.length - 1] = merge(runs.at(-1), e);
    else runs.push(e);
  }
  if (runs.length > 1 && same(runs.at(-1), runs[0])) runs[0] = merge(runs.pop(), runs[0]);
  if (runs.length < 3) return null;
  const sinMin = Math.sin((10 * Math.PI) / 180);
  const out = runs.map((x, i) => {
    const y = runs[(i + 1) % runs.length];
    const denom = x.dir[0] * y.dir[1] - x.dir[1] * y.dir[0];
    if (Math.abs(denom) < sinMin) return scale(add(add(x.mid, scale(x.dir, x.length / 2)), sub(y.mid, scale(y.dir, y.length / 2))), 0.5);
    const t = ((y.mid[0] - x.mid[0]) * y.dir[1] - (y.mid[1] - x.mid[1]) * y.dir[0]) / denom;
    return add(x.mid, scale(x.dir, t));
  });
  const closed = [...ring, ring[0]];
  const moved = Math.max(...out.map((p) => distanceToPolyline(p, closed)));
  return moved <= OUTLINE_MOVE_M ? out : null;
}

// Straight strokes of a painted frame (a stall row's rail and dividers, an L): along each dominant direction, the
// interior points (0.05 m grid) are binned across it; every peak of at least STROKE_MIN_M of paint becomes one straight
// stroke over its longest continuous run (gaps under 0.7 m: a rail crossed by an earlier divider). Returns [{ from, to }] in metres.
const STROKE_MIN_M = 1;
export function strokesFromBlob(rings, directions) {
  const step = 0.05;
  let points = gridIn([rings], step);
  const out = [];
  for (const u of directions) {
    if (points.length < STROKE_MIN_M / step) break;
    const n = perpOf(u);
    const t = points.map((p) => dot(p, n));
    const t0 = Math.min(...t);
    const bins = new Float64Array(Math.ceil((Math.max(...t) - t0) / step) + 2);
    for (const v of t) bins[Math.floor((v - t0) / step)] += 1;
    const smooth = Array.from(bins, (_, k) => (bins[k - 1] ?? 0) + bins[k] + (bins[k + 1] ?? 0));
    const minCount = (STROKE_MIN_M / step) * 2;
    const peaks = [];
    for (let k = 0; k < smooth.length; k += 1) {
      if (smooth[k] < minCount || smooth[k] < (smooth[k - 1] ?? 0) || smooth[k] < (smooth[k + 1] ?? 0)) continue;
      if (peaks.some((q) => Math.abs(q - k) * step < 0.3)) continue;
      peaks.push(k);
    }
    const used = new Set();
    for (const k of peaks) {
      const near = [];
      points.forEach((p, i) => {
        if (Math.abs(t[i] - (t0 + (k + 0.5) * step)) <= 0.15) near.push(i);
      });
      // the paint a stroke takes: its run, 0.3 m either side (the blurred rim of a 0.25 m-pixel line)
      const taken = [];
      points.forEach((p, i) => {
        if (Math.abs(t[i] - (t0 + (k + 0.5) * step)) <= 0.3) taken.push(i);
      });
      const tc = near.reduce((acc, i) => acc + t[i], 0) / near.length;
      const sv = near.map((i) => dot(points[i], u)).sort((a, b) => a - b);
      let best = null;
      let start = 0;
      for (let i = 1; i <= sv.length; i += 1) {
        if (i === sv.length || sv[i] - sv[i - 1] > 0.7) {
          if (!best || sv[i - 1] - sv[start] > best[1] - best[0]) best = [sv[start], sv[i - 1]];
          start = i;
        }
      }
      if (!best || best[1] - best[0] < STROKE_MIN_M) continue;
      out.push({ from: add(scale(u, best[0]), scale(n, tc)), to: add(scale(u, best[1]), scale(n, tc)) });
      for (const i of taken) {
        const sp = dot(points[i], u);
        if (sp >= best[0] - 0.3 && sp <= best[1] + 0.3) used.add(i);
      }
    }
    points = points.filter((_, i) => !used.has(i));
  }
  return out;
}

// Score of a template against the photo blob: intersection over union of their areas (0.05 m grid).
function overlapScore(blob, template, step = 0.05) {
  const points = gridIn([...blob, ...template], step);
  let both = 0;
  let either = 0;
  for (const p of points) {
    const a = blob.some((rings) => inPolygon(p, rings));
    const b = template.some((rings) => inPolygon(p, rings));
    if (a || b) either += 1;
    if (a && b) both += 1;
  }
  return either ? both / either : 0;
}
// Template polygons (local x right of f, y along f) placed at `centre` with the template's own box centred there.
function place(polys, centre, f) {
  const r = rightOf(f);
  const all = polys.flatMap((rings) => rings[0]);
  const cx = (Math.min(...all.map((p) => p[0])) + Math.max(...all.map((p) => p[0]))) / 2;
  const cy = (Math.min(...all.map((p) => p[1])) + Math.max(...all.map((p) => p[1]))) / 2;
  return polys.map((rings) => rings.map((ring) => ring.map(([x, y]) => add(centre, add(scale(r, x - cx), scale(f, y - cy))))));
}

// ---------------------------------------------------------------- main
// drawn: candidates the stage draws ({ feature, kind, colour, shapes (scene units), zebra?, frame?, singled? });
// ctx: { unit (scene units per metre), statute: { widthFor(kind), stopLineWidth(m), dash: { kind: [dash, gap] },
// doubleOffsetM, zebraPeriodM, zebraBarM }, blocked(p scene units) -> bool, textMarkings: [{ id, ids, lines, travelBearingDeg?, source }] }.
export function regularise(drawn, ctx) {
  const U = ctx.unit;
  const toM = (p) => [p[0] / U, p[1] / U];
  const toScene = (p) => [p[0] * U, p[1] * U];
  const blocked = (p) => ctx.blocked(toScene(p));
  const roadAxes = (ctx.roadAxes ?? []).map((line) => line.map(toM));
  const pieces = [];
  const stats = {
    chains: 0, fragments: 0, straightRuns: 0, arcs: 0, straightness: [], residual: [], dashPeriods: [], duplicateLines: 0,
    baySymbols: { wheelchair: 0, p: 0, existing: 0, skipped: 0, orientationGuessed: 0, blobsReplaced: 0, list: [] }, crossings: 0, crossingGroups: 0, crossingRowsAligned: 0, crossingRowsOwnGrid: 0, crossingPeriods: [], stopInCrossing: [], crossingList: [], blockedIds: [], frameStrokes: 0, barsDrawn: 0, barsDetected: 0, zebraPhaseResidual: [], glyphs: {}, textReadings: [], textMissing: [], arrowAxes: { road: 0, own: 0 }, dropped: { blocked: 0, textTooSmall: 0 },
    stopSquared: 0, parallelSnapped: 0, outlines: 0, rectangles: 0,
  };
  const emit = (rings, colour, kind, extra = {}) => pieces.push({ rings: rings.map((r) => r.map(toScene)), colour, kind, estimated: false, ...extra });
  const blockedShare = (points) => (points.length ? points.filter(blocked).length / points.length : 0);
  const emitPoly = (polys, colour, kind, extra) => {
    const samples = polys.flatMap((rings) => rings[0]);
    if (blockedShare(samples) > BLOCKED_SHARE) {
      stats.dropped.blocked += 1;
      stats.blockedIds.push(extra?.id ?? kind);
      return;
    }
    for (const rings of polys) emit(rings, colour, kind, extra);
  };
  const glyphCount = (name) => { stats.glyphs[name] = (stats.glyphs[name] ?? 0) + 1; };
  const shapesM = (c) => c.shapes.map((rings) => rings.map((ring) => ring.map(toM)));

  // ---- lines
  const fragments = [];
  const stops = [];
  const zebraGroups = new Map();
  const glyphs = [];
  const groups = new Map();
  for (const c of drawn) {
    const p = c.feature.properties;
    if (c.zebra) {
      const bar = { centre: toM(c.zebra.centre), axis: c.zebra.axis, length: (2 * c.zebra.halfLength) / U, id: c.id };
      if (!zebraGroups.has(c.zebra.group)) zebraGroups.set(c.zebra.group, []);
      zebraGroups.get(c.zebra.group).push(bar);
      continue;
    }
    if (c.estimated) {
      // estimated pieces are already statute geometry (dashes, bars, stall dividers laid by rule)
      for (const rings of c.shapes) pieces.push({ rings, colour: c.colour, kind: c.kind, estimated: true });
      continue;
    }
    if (p.group && !LINE_KINDS.has(c.kind)) {
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group).push(c);
      continue;
    }
    if (c.kind === "stop_line") {
      stops.push(c);
      continue;
    }
    if (p.dotted && p.dots) {
      // guide dots already laid evenly between the first and the last detected dot (featureShapes)
      for (const rings of c.shapes) pieces.push({ rings, colour: c.colour, kind: c.kind, estimated: false });
      continue;
    }
    if (LINE_KINDS.has(c.kind)) {
      const { type, coordinates } = c.feature.geometry;
      let points;
      let width = p.width_m;
      if (type === "LineString") points = coordinates.length ? c.lineModel.map(toM) : [];
      else {
        // a painted stroke (one dash, one stall divider) is a line; an outline (a stall frame, an L) is a shape
        const rings = shapesM(c)[0];
        const box = orientedBox(rings[0]);
        const fill = polygonArea(rings) / Math.max(1e-6, 4 * box.halfLong * box.halfShort);
        if (fill < RECT_FILL || box.halfLong < 2 * box.halfShort) {
          // the dominant directions first, then the same turned by 6 deg for a rail that bends along the row
          const turn = (d, deg) => {
            const a = Math.atan2(d[1], d[0]) + (deg * Math.PI) / 180;
            return [Math.cos(a), Math.sin(a)];
          };
          const main = dominantDirections(simplifyRing(rings[0]));
          const strokes = strokesFromBlob(rings, [...main, ...main.flatMap((d) => [6, -6].map((deg) => turn(d, deg)))]);
          if (!strokes.length) {
            glyphs.push(c);
            continue;
          }
          const half = ctx.statute.widthFor(c.kind) / 2;
          emitPoly(strokes.map(({ from, to }) => [rect(scale(add(from, to), 0.5), unit(sub(to, from)), perpOf(unit(sub(to, from))), norm(sub(to, from)) / 2 + half, half)]), c.colour, c.kind, { id: c.id });
          stats.frameStrokes += strokes.length;
          continue;
        }
        points = [sub(box.centre, scale(box.long, box.halfLong)), add(box.centre, scale(box.long, box.halfLong))];
        width = 2 * box.halfShort;
      }
      const dotted = Boolean(p.dotted);
      const dashed = c.kind === "lane_line_dashed" || Boolean(p.dashed) || dotted;
      const double = Boolean(p.double) && !c.singled;
      fragments.push({ c, id: c.id, lineId: p.line_id, points: resample(points, 0.25), kind: c.kind, colour: c.colour, dashed, dotted, double, width });
      continue;
    }
    glyphs.push(c);
  }

  // chain per kind, colour, double and dashed; parking lines and give-way dashes stay single (parallel stall
  // dividers and the dashes of a give-way line are separate marks)
  const keyOf = (f) => `${f.kind}|${f.colour}|${f.double}|${f.dashed}|${f.dotted}`;
  const byKey = new Map();
  for (const f of fragments) {
    if (!byKey.has(keyOf(f))) byKey.set(keyOf(f), []);
    byKey.get(keyOf(f)).push(f);
  }
  const chains = [];
  for (const list of byKey.values()) {
    const { kind, colour, double, dashed, dotted } = list[0];
    const single = kind === "parking_line" || kind === "give_way_line";
    const raw = single ? list.map((f) => ({ ids: [f.id], points: f.points })) : chainFragments(list, { maxGap: dashed ? CHAIN_GAP_M.dashed : CHAIN_GAP_M.solid });
    const byId = new Map(list.map((f) => [f.id, f]));
    for (const chain of raw) {
      const members = chain.ids.map((id) => byId.get(id));
      stats.fragments += members.length;
      const fit = fitPath(chain.points, { fillet: !single });
      chains.push({ kind, colour, double, dashed, dotted, members, fit, path: fit.path, ids: chain.ids });
    }
  }
  stats.chains = chains.length;

  // parallel straight lines of a road share one direction
  const straight = chains.filter((ch) => ch.fit.lines.length === 1 && polylineLength(ch.path) >= 3 && ROAD_LINE_KINDS.has(ch.kind));
  const visited = new Set();
  for (const a of straight) {
    if (visited.has(a)) continue;
    const family = [a];
    visited.add(a);
    for (let k = 0; k < family.length; k += 1) {
      for (const b of straight) {
        if (visited.has(b)) continue;
        const x = family[k];
        if (angleBetween(x.fit.lines[0].dir, b.fit.lines[0].dir) > PARALLEL_DEG) continue;
        const mid = scale(add(b.path[0], b.path.at(-1)), 0.5);
        if (distanceToPolyline(mid, x.path) > PARALLEL_REACH_M) continue;
        family.push(b);
        visited.add(b);
      }
    }
    if (family.length < 2) continue;
    const ref = family[0].fit.lines[0].dir;
    const dir = unit(family.reduce((acc, ch) => add(acc, scale(ch.fit.lines[0].dir, polylineLength(ch.path) * Math.sign(dot(ch.fit.lines[0].dir, ref)))), [0, 0]));
    for (const ch of family) {
      const own = scale(dir, Math.sign(dot(ch.fit.lines[0].dir, dir)) || 1);
      const centre = scale(add(ch.path[0], ch.path.at(-1)), 0.5);
      const half = polylineLength(ch.path) / 2;
      const path = [sub(centre, scale(own, half)), add(centre, scale(own, half))];
      const points = ch.members.flatMap((m) => m.points);
      const worst = Math.max(...points.map((p) => distanceToPolyline(p, path)));
      if (worst <= Math.max(PARALLEL_KEEP_M, ch.fit.residual.max)) {
        ch.path = path;
        stats.parallelSnapped += 1;
      }
    }
  }

  // one line where two fitted lines of one colour cover the same paint
  chains.sort((a, b) => polylineLength(b.path) - polylineLength(a.path));
  for (let i = 0; i < chains.length; i += 1) {
    const small = chains[i];
    for (let j = 0; j < i && !small.duplicate; j += 1) {
      const big = chains[j];
      if (big.duplicate || big.colour !== small.colour) continue;
      const samples = resample(small.path, 0.25);
      const near = samples.filter((p) => distanceToPolyline(p, big.path) <= DUP_LATERAL_M).length / samples.length;
      if (near >= DUP_SHARE) small.duplicate = big.ids[0];
    }
  }
  stats.duplicateLines = chains.filter((ch) => ch.duplicate).length;

  // draw: dashes, double strokes, cuts at buildings and sidewalks
  for (const ch of chains) {
    if (ch.duplicate) continue;
    stats.straightRuns += ch.fit.lines.length;
    stats.arcs += ch.fit.pieces.filter((piece) => piece.type === "arc").length;
    stats.residual.push(ch.fit.residual.p95);
    if (ch.fit.lines.length === 1) stats.straightness.push(straightness(ch.path));
    const length = polylineLength(ch.path);
    let intervals = [[0, length]];
    if (ch.dashed) {
      // statute pattern of the kind (guide dots for dotted lines); kinds without one keep the photo's period, or
      // their detected dashes when there are too few to measure it
      const nominal = ch.dotted ? ctx.statute.dash.guide_dotted : ctx.statute.dash[ch.kind] ?? null;
      const detected = ch.members.map((m) => [projectArc(ch.path, m.points[0]), projectArc(ch.path, m.points.at(-1))].sort((a, b) => a - b))
        .filter(([a, b]) => b - a > (ch.dotted ? 0.05 : 0.3));
      if (detected.length) {
        const statutePeriod = nominal ? nominal[0] + nominal[1] : null;
        const period = measuredPeriod(detected, statutePeriod ?? median(detected.map(([a, b]) => b - a)) * 2);
        const usePhoto = Boolean(period) && (!nominal || (detected.length >= 4 && Math.abs(period - statutePeriod) / statutePeriod > 0.15));
        if (!nominal && !period) {
          intervals = detected;
          stats.dashPeriods.push({ kind: ch.kind, colour: ch.colour, dotted: ch.dotted, dashes: detected.length, measured: null, used: null, dash: null, source: "detected dashes" });
        } else {
          const dash = usePhoto ? Math.min(period * 0.6, Math.max(ch.dotted ? 0.2 : 1, median(detected.map(([a, b]) => b - a)))) : nominal[0];
          const gap = usePhoto ? period - dash : nominal[1];
          intervals = layDashes({ length, detected, dash, gap }).dashes;
          stats.dashPeriods.push({ kind: ch.kind, colour: ch.colour, dotted: ch.dotted, dashes: detected.length, measured: period, used: dash + gap, dash, source: usePhoto ? "photo" : "statute" });
        }
      }
    }
    const width = ch.dotted ? Math.min(0.6, Math.max(0.1, median(ch.members.map((m) => m.width)))) : ctx.statute.widthFor(ch.double ? "centre_line_yellow" : ch.kind);
    const offsets = ch.double ? [ctx.statute.doubleOffsetM, -ctx.statute.doubleOffsetM] : [0];
    for (const [a, b] of intervals) {
      const piece = slicePath(ch.path, a, b);
      if (piece.length < 2) continue;
      // cut where the line runs onto a building or a sidewalk
      const samples = resample(piece, 0.25);
      const runs = [];
      let run = [];
      for (const p of samples) {
        if (blocked(p)) {
          if (run.length) runs.push(run);
          run = [];
        } else run.push(p);
      }
      if (run.length) runs.push(run);
      if (runs.length !== 1 || runs[0].length !== samples.length) stats.dropped.blocked += 1;
      for (const r of runs) {
        if (r.length < 3) continue;
        const sub_ = runs.length === 1 && r.length === samples.length ? piece : slicePath(piece, projectArc(piece, r[0]), projectArc(piece, r.at(-1)));
        for (const off of offsets) {
          const line = off ? offsetPath(sub_, off) : sub_;
          const ring = strokePath(line, width / 2);
          if (ring) emit([ring], ch.colour, ch.kind);
        }
      }
    }
  }

  // ---- stop lines: straight, square to the nearest lane line
  const laneChains = chains.filter((ch) => !ch.duplicate && ROAD_LINE_KINDS.has(ch.kind));
  const directionNear = (p, reach, accept, minLength = 0) => {
    let best = null;
    for (const ch of laneChains) {
      if (minLength && polylineLength(ch.path) < minLength) continue;
      const d = distanceToPolyline(p, ch.path);
      if (d > reach) continue;
      const s = projectArc(ch.path, p);
      const length = polylineLength(ch.path);
      const seg = slicePath(ch.path, Math.max(0, s - 1), Math.min(length, s + 1));
      if (seg.length < 2) continue;
      const dir = unit(sub(seg.at(-1), seg[0]));
      if (accept && !accept(dir)) continue;
      if (!best || d < best.d) best = { d, dir, chain: ch };
    }
    return best;
  };
  // Direction of the road at p: the length-weighted axial mean of the road lines (TEXT_ROAD_MIN_M or longer) within
  // `reach` metres, each read near p; a short line across the road (a crossing frame read as a lane line) cannot turn it.
  const roadDirectionAt = (p, reach) => {
    let c2 = 0;
    let s2 = 0;
    for (const ch of laneChains) {
      const length = polylineLength(ch.path);
      if (length < TEXT_ROAD_MIN_M || distanceToPolyline(p, ch.path) > reach) continue;
      const s = projectArc(ch.path, p);
      const seg = slicePath(ch.path, Math.max(0, s - 1), Math.min(length, s + 1));
      if (seg.length < 2) continue;
      const d = unit(sub(seg.at(-1), seg[0]));
      const a = Math.atan2(d[1], d[0]);
      c2 += length * Math.cos(2 * a);
      s2 += length * Math.sin(2 * a);
    }
    if (!c2 && !s2) return null;
    const a = Math.atan2(s2, c2) / 2;
    return [Math.cos(a), Math.sin(a)];
  };
  const stopPieces = [];
  for (const c of stops) {
    const box = orientedBox(shapesM(c).flatMap((rings) => rings[0]));
    const width = ctx.statute.stopLineWidth(c.feature.properties.width_m ?? 2 * box.halfShort).width;
    let along = box.long;
    const lane = directionNear(box.centre, STOP_REACH_M, (d) => angleBetween(perpOf(d), box.long) <= STOP_SNAP_DEG);
    if (lane) {
      along = perpOf(lane.dir);
      stats.stopSquared += 1;
    }
    stopPieces.push({ at: pieces.length, centre: box.centre, id: c.id });
    emitPoly([[rect(box.centre, unit(along), perpOf(unit(along)), box.halfLong, width / 2)]], c.colour, "stop_line", { id: c.id });
  }

  // ---- zebras: one crossing, one rectangle, equal bars
  const zebras = [];
  const crossingGroups = [...zebraGroups].map(([id, bars]) => ({ id, bars }));
  stats.crossingGroups = crossingGroups.length;
  // each crossing row on its own grid: period and phase fitted to its own detected bars, the period within
  // ZEBRA_PERIOD_RANGE_M (the photo's measured spread, 추정 beyond p10-p90 0.896-0.910 m)
  const zebraFit = { period: ctx.statute.zebraPeriodM, bar: ctx.statute.zebraBarM, periodRange: ZEBRA_PERIOD_RANGE_M };
  const merged = mergeCrossings(crossingGroups).map((crossing) => {
    const centre = scale(crossing.bars.reduce((acc, b) => add(acc, b.centre), [0, 0]), 1 / crossing.bars.length);
    const barAxis = crossing.bars[0].axis;
    const road = directionNear(centre, 15, (d) => angleBetween(d, barAxis) <= ZEBRA_ROAD_SNAP_DEG);
    return { ...crossing, fit: fitCrossing(crossing.bars, { ...zebraFit, roadDir: road?.dir ?? null }) };
  });
  // Adjacent rows (a crossing painted as two bar rows side by side along the carriageway): parallel, touching along
  // the bar axis (within ZEBRA_ROW_GAP_M) and overlapping along the walk by half the shorter row. Each row keeps its
  // own rectangle, but all rows of one crossing share one axis and one bar grid, so their bars line up.
  const rowParent = merged.map((_, i) => i);
  const rowRoot = (i) => (rowParent[i] === i ? i : (rowParent[i] = rowRoot(rowParent[i])));
  for (let i = 0; i < merged.length; i += 1) {
    for (let j = i + 1; j < merged.length; j += 1) {
      const [a, b] = [merged[i].fit.rectangle, merged[j].fit.rectangle];
      if (angleBetween(a.axis, b.axis) > ZEBRA_ROAD_SNAP_DEG) continue;
      const d = sub(b.centre, a.centre);
      const alongBar = Math.abs(dot(d, a.axis));
      const alongWalk = Math.abs(dot(d, a.walk));
      const overlap = Math.min(a.halfWalk, b.halfWalk) * 2 - Math.max(0, alongWalk - Math.abs(a.halfWalk - b.halfWalk));
      if (alongBar <= a.halfBar + b.halfBar + ZEBRA_ROW_GAP_M && overlap >= Math.min(a.halfWalk, b.halfWalk)) rowParent[rowRoot(i)] = rowRoot(j);
    }
  }
  const families = new Map();
  merged.forEach((m, i) => {
    if (!families.has(rowRoot(i))) families.set(rowRoot(i), []);
    families.get(rowRoot(i)).push(m);
  });
  // Adjacent rows stay parallel (one axis); they share one bar grid only where the photo shows them aligned: their own
  // periods agree within ZEBRA_ALIGN_PERIOD_M and their own grids line up within ZEBRA_ALIGN_PHASE_M. Else each row
  // keeps its own period and phase.
  for (const rows of families.values()) {
    if (rows.length < 2) continue;
    const main = rows.reduce((x, y) => (y.bars.length > x.bars.length ? y : x));
    const { axis, walk } = main.fit.rectangle;
    const origin = main.bars[0].centre;
    const own = rows.map((r) => fitCrossing(r.bars, { ...zebraFit, frame: { axis } }));
    const gridAt = (f) => (((dot(sub(f.origin, origin), walk) + f.phase) % f.period) + f.period) % f.period;
    const g0 = gridAt(own[0]);
    const aligned = own.every((f) => {
      const d = Math.abs(gridAt(f) - g0);
      return Math.abs(f.period - own[0].period) <= ZEBRA_ALIGN_PERIOD_M && Math.min(d, own[0].period - d) <= ZEBRA_ALIGN_PHASE_M;
    });
    if (aligned) {
      const period = own.reduce((acc, f, i) => acc + f.period * rows[i].bars.length, 0) / rows.reduce((acc, r) => acc + r.bars.length, 0);
      const phase = dashPhase(rows.flatMap((r) => r.bars.map((b) => dot(sub(b.centre, origin), walk))), period);
      for (const r of rows) r.fit = fitCrossing(r.bars, { ...zebraFit, frame: { axis, origin, phase, period } });
      stats.crossingRowsAligned += rows.length;
    } else {
      rows.forEach((r, i) => { r.fit = own[i]; });
      stats.crossingRowsOwnGrid += rows.length;
    }
    for (const r of rows) r.rows = rows.length;
  }
  for (const crossing of merged) {
    const { fit } = crossing;
    stats.crossings += 1;
    stats.barsDetected += crossing.bars.length;
    stats.zebraPhaseResidual.push(fit.phaseResidual.max);
    const kept = [];
    fit.bars.forEach((ring, k) => {
      if (blockedShare([fit.barCentres[k], ...ring]) > BLOCKED_SHARE) {
        stats.dropped.blocked += 1;
        return;
      }
      emit([ring], "white", "zebra_bar");
      kept.push(fit.barCentres[k]);
    });
    stats.barsDrawn += kept.length;
    stats.crossingList.push({ ids: crossing.ids, detected: crossing.bars.length, drawn: kept.length, centre: toScene(fit.rectangle.centre), periodM: +fit.period.toFixed(3), rows: crossing.rows ?? 1, phaseResidualMaxM: +fit.phaseResidual.max.toFixed(3) });
    if (!kept.length) continue;
    zebras.push({
      id: crossing.ids.join("+"), centre: toScene(fit.rectangle.centre), axis: fit.rectangle.axis, bars: kept.length,
      halfLength: fit.rectangle.halfBar * U, barCentres: kept.map(toScene), merged: crossing.ids.length,
    });
  }

  // A "stop line" lying inside a drawn crossing rectangle is a zebra bar read twice (the M3 traces west of the gate's
  // raised crossing): one bar set per crossing, so it is left out.
  const inCrossing = (p) => merged.some(({ fit: { rectangle: r } }) => Math.abs(dot(sub(p, r.centre), r.axis)) <= r.halfBar + 0.2 && Math.abs(dot(sub(p, r.centre), r.walk)) <= r.halfWalk + 0.2);
  for (const sp of [...stopPieces].reverse()) {
    if (!inCrossing(sp.centre) || pieces[sp.at]?.id !== sp.id) continue;
    pieces.splice(sp.at, 1);
    stats.stopInCrossing.push(sp.id);
  }

  // ---- groups (hump bands, blue bays with frame and symbol, ladders): one set of directions per group
  for (const members of groups.values()) {
    const all = members.flatMap((c) => shapesM(c).flatMap((rings) => rings[0]));
    const box = orientedBox(all);
    const stripe = median(members.map((c) => {
      const b = orientedBox(shapesM(c)[0][0]);
      return Math.atan2(b.long[1], b.long[0]) % Math.PI;
    }));
    const directions = [box.long, box.short, [Math.cos(stripe), Math.sin(stripe)], perpOf([Math.cos(stripe), Math.sin(stripe)])];
    for (const c of members) emitRegularPolygon(c, directions);
  }

  // ---- symbols
  const texts = [];
  for (const c of glyphs) {
    if (c.kind === "text") texts.push(c);
    else if (ARROW_KINDS.includes(c.kind) || c.kind === "arrow") emitArrow(c);
    else if (c.kind === "diamond" || c.kind === "give_way") emitOutlineSymbol(c);
    else if (c.kind === "chevron") emitChevron(c);
    else emitRegularPolygon(c, null);
  }
  emitTexts(texts);

  function emitRegularPolygon(c, directions) {
    for (const rings of shapesM(c)) {
      const box = orientedBox(rings[0]);
      const fill = polygonArea(rings) / Math.max(1e-6, 4 * box.halfLong * box.halfShort);
      if (c.kind === "disabled_parking" && c.colour === "white" && fill < 0.5) {
        // upright along one of the bay's own directions, the one whose template covers the painted symbol best
        const axes = (directions ?? [box.long, box.short]).flatMap((d) => [unit(d), scale(unit(d), -1)]);
        const size = 2 * box.halfLong;
        const pick = axes.map((f) => ({ t: place(wheelchairTemplate(size), box.centre, f), f }))
          .map((x) => ({ ...x, score: overlapScore(rings ? [rings] : [], x.t) })).sort((x, y) => y.score - x.score)[0];
        emitPoly(pick.t, c.colour, c.kind, { glyph: "wheelchair" });
        glyphCount("wheelchair");
        continue;
      }
      if (c.kind === "bike_lane_blue" && c.colour === "white" && fill < 0.5) {
        emitPoly(place(bicycleTemplate(2 * box.halfLong, 2 * box.halfShort), box.centre, box.long), c.colour, c.kind);
        glyphCount("bicycle");
        continue;
      }
      const dirs = directions ?? [box.long, box.short];
      if (fill >= RECT_FILL && rings.length === 1) {
        // a stripe or a filled block: its rectangle, the axis snapped to the group's when close
        const snapped = dirs.find((d) => angleBetween(d, box.long) <= SNAP_DEG && angleBetween(d, box.long) > 0) ?? box.long;
        const u = unit(snapped);
        const v = perpOf(u);
        const s = rings[0].map((p) => dot(sub(p, box.centre), u));
        const t = rings[0].map((p) => dot(sub(p, box.centre), v));
        const centre = add(box.centre, add(scale(u, (Math.min(...s) + Math.max(...s)) / 2), scale(v, (Math.min(...t) + Math.max(...t)) / 2)));
        emitPoly([[rect(centre, u, v, (Math.max(...s) - Math.min(...s)) / 2, (Math.max(...t) - Math.min(...t)) / 2)]], c.colour, c.kind, { id: c.id });
        stats.rectangles += 1;
      } else {
        emitPoly([rings.map((ring) => regularOutline(ring, dirs))], c.colour, c.kind, { id: c.id });
        stats.outlines += 1;
      }
    }
  }

  function emitArrow(c) {
    const blob = shapesM(c);
    const box = orientedBox(blob.flatMap((rings) => rings[0]));
    const length = 2 * box.halfLong;
    const width = 2 * box.halfShort;
    const kinds = c.kind === "arrow" ? ["arrow_straight", "arrow_left", "arrow_right"] : [c.kind];
    // an arrow lies along its lane and points the way the lane's traffic goes: the road direction within ARROW_SNAP_DEG
    // of the blob's axis, signed by the travel direction where a centre line or road axis tells it, else by the blob
    const road = roadDirectionAt(box.centre, 12);
    const snapped = road && angleBetween(road, box.long) <= ARROW_SNAP_DEG;
    const axis = snapped ? road : box.long;
    const travel = snapped ? travelDirection(box.centre, road) : null;
    const directions = travel && travel.from !== "none" ? [travel.f] : [axis, scale(axis, -1)];
    stats.arrowAxes[snapped ? "road" : "own"] += 1;
    let best = null;
    for (const kind of kinds) {
      for (const f of directions) {
        const template = place(arrowTemplate(kind, length, width), box.centre, f);
        const score = overlapScore(blob, template);
        if (!best || score > best.score) best = { kind, template, score };
      }
    }
    emitPoly(best.template, c.colour, c.kind, { glyph: best.kind, guessed: c.kind === "arrow" });
    glyphCount(c.kind === "arrow" ? `${best.kind} (추정)` : best.kind);
  }

  function emitOutlineSymbol(c) {
    const blob = shapesM(c);
    const box = orientedBox(blob.flatMap((rings) => rings[0]));
    const [L, W] = [2 * box.halfLong, 2 * box.halfShort];
    const area = polygonArea(blob[0]);
    let best = null;
    for (const f of [box.long, scale(box.long, -1)]) {
      const perimeter = c.kind === "diamond" ? 4 * Math.hypot(L / 2, W / 2) : W + 2 * Math.hypot(L, W / 2);
      const w = Math.min(0.45, Math.max(0.1, area / perimeter));
      const template = place(c.kind === "diamond" ? diamondTemplate(L, W, w) : triangleTemplate(L, W, w), box.centre, f);
      const score = overlapScore(blob, template);
      if (!best || score > best.score) best = { template, score };
      if (c.kind === "diamond") break;
    }
    emitPoly(best.template, c.colour, c.kind);
    glyphCount(c.kind);
  }

  function emitChevron(c) {
    const blob = shapesM(c);
    const box = orientedBox(blob.flatMap((rings) => rings[0]));
    const fill = polygonArea(blob[0]) / Math.max(1e-6, 4 * box.halfLong * box.halfShort);
    if (fill >= RECT_FILL) {
      emitRegularPolygon(c, null);
      return;
    }
    let best = null;
    for (const [f, depth, span] of [[box.long, 2 * box.halfLong, 2 * box.halfShort], [scale(box.long, -1), 2 * box.halfLong, 2 * box.halfShort],
      [box.short, 2 * box.halfShort, 2 * box.halfLong], [scale(box.short, -1), 2 * box.halfShort, 2 * box.halfLong]]) {
      const arm = Math.hypot(depth, span / 2);
      const w = Math.min(0.5, Math.max(0.1, polygonArea(blob[0]) / (2 * arm)));
      const template = place(chevronTemplate(depth - w, span - w, w), box.centre, f);
      const score = overlapScore(blob, template);
      if (!best || score > best.score) best = { template, score };
    }
    emitPoly(best.template, c.colour, c.kind);
    glyphCount("chevron");
  }

  // Text: one marking per lane block. Korean road text reads for the approaching driver: syllables upright to him,
  // lines across the lane, the first line farthest (the block is read like a page), each syllable TEXT_STRETCH times
  // as long as wide along the travel direction (lib/markingGlyphs.mjs textBlock). Travel direction: Korea drives on
  // the right, so the drawn centre line (or, without one, the OSM centreline of the two-way road) is on the driver's
  // left. The words: ctx.textMarkings (data/photo/markings-text.json), read in the SCNU VR tour or on the photo, claim
  // the blobs listed by id or lying within TEXT_SEED_REACH_M of their seed; the other blobs of one lane within
  // TEXT_BLOCK_M of each other are one marking with the most likely statute text for its size (추정): 서행 in a lane
  // narrower than TEXT_LONG_WORD_M, else 천천히; 경차 in a parking stall.
  function travelDirection(p, axis) {
    let f = axis;
    const centre = laneChains.filter((ch) => ch.kind === "centre_line_yellow")
      .map((ch) => ({ path: ch.path, d: distanceToPolyline(p, ch.path), from: `centre line ${ch.ids[0]}` })).filter((x) => x.d <= 15).sort((x, y) => x.d - y.d)[0];
    const side = centre ?? roadAxes.map((line) => ({ path: line, d: distanceToPolyline(p, line), from: "OSM road axis" }))
      .filter((x) => x.d <= TEXT_AXIS_REACH_M && x.d > 0.5).sort((x, y) => x.d - y.d)[0];
    if (!side) return { f, from: "none", sideOf: null };
    const at = projectArc(side.path, p);
    const q = slicePath(side.path, at, at + 1e-3)[0] ?? side.path[0];
    if (dot(sub(q, p), rightOf(f)) > 0) f = scale(f, -1);
    return { f, from: `${side.from} at ${side.d.toFixed(1)} m`, sideOf: (x) => Math.sign(dot(sub(x, q), perpOf(axis))) };
  }
  function emitTexts(list) {
    const polys = list.map((c) => shapesM(c));
    const centroid = (i) => {
      const pts = polys[i].flatMap((rings) => rings[0]);
      return scale(pts.reduce((acc, q) => add(acc, q), [0, 0]), 1 / pts.length);
    };
    const markings = (ctx.textMarkings ?? []).map((m) => ({ ...m, seedM: m.seed ? toM(m.seed) : null, members: [] }));
    const free = [];
    list.forEach((c, i) => {
      const by = markings.find((m) => m.ids?.includes(c.id));
      const seeds = markings.filter((m) => m.seedM).map((m) => ({ m, d: norm(sub(centroid(i), m.seedM)) })).filter((x) => x.d <= TEXT_SEED_REACH_M).sort((x, y) => x.d - y.d);
      const owner = by ?? seeds[0]?.m;
      if (owner) owner.members.push(i);
      else free.push(i);
    });
    // the remaining blobs: one marking per lane block
    const gap = (a, b) => Math.min(...a.flatMap((ra) => ra[0]).map((p) => Math.min(...b.flatMap((rb) => rb[0]).map((q) => norm(sub(p, q))))));
    const parent = new Map(free.map((i) => [i, i]));
    const root = (i) => (parent.get(i) === i ? i : root(parent.get(i)));
    for (let x = 0; x < free.length; x += 1) {
      for (let y = x + 1; y < free.length; y += 1) {
        const [i, j] = [free[x], free[y]];
        if (gap(polys[i], polys[j]) > TEXT_BLOCK_M) continue;
        // never across a centre line
        const road = roadDirectionAt(centroid(i), 15);
        if (road) {
          const { sideOf } = travelDirection(centroid(i), road);
          if (sideOf && sideOf(centroid(i)) !== sideOf(centroid(j))) continue;
        }
        parent.set(root(i), root(j));
      }
    }
    const groups = new Map();
    for (const i of free) {
      if (!groups.has(root(i))) groups.set(root(i), []);
      groups.get(root(i)).push(i);
    }
    for (const members of groups.values()) markings.push({ id: null, members, guessed: true });

    for (const m of markings) {
      if (!m.members.length) {
        if (m.id) stats.textMissing.push(m.id);
        continue;
      }
      const blob = m.members.flatMap((i) => polys[i]);
      const ids = m.members.map((i) => list[i].id);
      const area = blob.reduce((s_, rings) => s_ + polygonArea(rings), 0);
      if (m.guessed && area < TEXT_MIN_AREA_M2) {
        stats.dropped.textTooSmall += 1;
        continue;
      }
      const points = blob.flatMap((rings) => rings[0]);
      const box = orientedBox(points);
      const stall = m.guessed && chains.some((ch) => !ch.duplicate && ch.kind === "parking_line" && distanceToPolyline(box.centre, ch.path) <= TEXT_STALL_REACH_M);
      let f;
      let from;
      if (stall) {
        // in a stall the word runs along the stall's long side, read from the aisle (추정)
        f = perpOf(box.long);
        from = "parking stall";
      } else if (Number.isFinite(m.travelBearingDeg)) {
        // the travel direction the VR view shows the text written for
        const road = roadDirectionAt(box.centre, 15) ?? box.long;
        const b = (m.travelBearingDeg * Math.PI) / 180;
        const read = [Math.sin(b), -Math.cos(b)];
        // along the road when the reading agrees with it within 30 deg, else along the axis of the painted block nearest
        // the read bearing
        // (`axis: "blob"`: the syllables are the blob's short axis long, side by side along its long axis)
        const axis = m.axis === "blob" ? box.short
          : angleBetween(road, read) <= 30 ? road : [box.long, box.short].sort((x, y) => angleBetween(x, read) - angleBetween(y, read))[0];
        f = dot(axis, read) >= 0 ? axis : scale(axis, -1);
        from = `reading (${m.travelBearingDeg} deg)`;
      } else {
        const road = roadDirectionAt(box.centre, 15) ?? box.long;
        ({ f, from } = travelDirection(box.centre, road));
      }
      const r = rightOf(f);
      const along = points.map((p) => dot(sub(p, box.centre), f));
      const across = points.map((p) => dot(sub(p, box.centre), r));
      // a reading may fix the block width and the syllable length where the photo blobs miss part of the paint
      const width = m.widthM ?? Math.max(...across) - Math.min(...across);
      const height = m.lineHeightM ? m.lineHeightM * (m.lines.length + 0.25 * (m.lines.length - 1)) : Math.max(...along) - Math.min(...along);
      const lines = m.lines ?? [stall ? "경차" : width < TEXT_LONG_WORD_M ? "서행" : "천천히"];
      const middle = add(box.centre, add(scale(f, (Math.max(...along) + Math.min(...along)) / 2), scale(r, (Math.max(...across) + Math.min(...across)) / 2)));
      const block = textBlock(lines, width, height, { charHeight: m.lineHeightM ?? null });
      emitPoly(place(block.polys, middle, f), m.colour ?? list[m.members[0]].colour, "text", { glyph: lines.join("/"), guessed: Boolean(m.guessed) });
      const label = `${lines.join("/")} (${m.guessed ? "추정" : m.source?.startsWith("VR") ? "VR 판독" : "사진 판독"})`;
      glyphCount(`text ${label}`);
      stats.textReadings.push({
        id: m.id, ids, lines, read: !m.guessed, source: m.source ?? "추정 (statute text for its size)", centre: toScene(middle),
        widthM: +width.toFixed(2), heightM: +height.toFixed(2), syllable: [+block.charWidth.toFixed(2), +block.charHeight.toFixed(2)],
        up: f.map((v) => +v.toFixed(3)), travelFrom: from,
      });
    }
  }

  // ---- bay symbols: every blue bay gets its white symbol (도로교통법 시행규칙 별표 6: the wheelchair of a disabled bay;
  // the P of a parking or PM bay where ctx.baySymbols names it), upright for the driver entering from the aisle, at
  // the bay's centre, unless a white symbol is already drawn there. A blue piece longer than BAY_ROW_M is a row of
  // bays BAY_WIDTH_M wide. The aisle is the end of the bay that is open: the other end meets a kerb, a sidewalk or a
  // building (ctx.blocked); where neither or both do, ctx.baySymbols may give the bearing, else it is 추정.
  emitBaySymbols();
  function emitBaySymbols() {
    const blues = pieces.filter((pc) => pc.kind === "disabled_parking" && pc.colour === "blue" && !pc.estimated);
    // a wheelchair template already drawn from a traced white symbol keeps its bay; other small white pieces inside a
    // bay (blobs of the painted symbol, at most BAY_SYMBOL_BLOB_M across) give way to the template
    const centreOf = (pc) => { const r = pc.rings[0].map(toM); return scale(r.reduce((a, q) => add(a, q), [0, 0]), 1 / r.length); };
    const whitePieces = pieces.filter((pc) => pc.kind === "disabled_parking" && pc.colour === "white" && !pc.estimated);
    const whiteTemplates = whitePieces.filter((pc) => pc.glyph === "wheelchair").map((pc) => ({ pc, c: centreOf(pc) }));
    const whites = whiteTemplates.map((t) => t.c);
    const blobs = whitePieces.filter((pc) => !pc.glyph && orientedBox(pc.rings[0].map(toM)).halfLong * 2 <= BAY_SYMBOL_BLOB_M).map((pc) => ({ pc, c: centreOf(pc) }));
    const replaced = new Set();
    const boxes = blues.map((pc) => { const r = pc.rings[0].map(toM); const xs = r.map((q) => q[0]); const zs = r.map((q) => q[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; });
    const parent = blues.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < blues.length; i += 1) for (let j = i + 1; j < blues.length; j += 1) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a[0] <= b[2] + 0.3 && b[0] <= a[2] + 0.3 && a[1] <= b[3] + 0.3 && b[1] <= a[3] + 0.3) parent[root(i)] = root(j);
    }
    const bays = new Map();
    blues.forEach((pc, i) => { if (!bays.has(root(i))) bays.set(root(i), []); bays.get(root(i)).push(pc); });
    const rules = ctx.baySymbols ?? {};
    for (const members of bays.values()) {
      const points = members.flatMap((pc) => pc.rings[0].map(toM));
      const box = orientedBox(points);
      const long = 2 * box.halfLong;
      const short = 2 * box.halfShort;
      const rule = members.map((pc) => rules[pc.id]).find(Boolean) ?? null;
      if (rule?.symbol === "none") continue;
      // a read bearing names the bay's depth axis: the box axis nearest it
      let row = long >= BAY_ROW_M && long >= 1.6 * short;
      if (Number.isFinite(rule?.upBearingDeg)) {
        const b = (rule.upBearingDeg * Math.PI) / 180;
        row = Math.abs(dot(box.short, [Math.sin(b), -Math.cos(b)])) > Math.abs(dot(box.long, [Math.sin(b), -Math.cos(b)]));
      }
      const n = Number.isFinite(rule?.cells) ? rule.cells : row ? Math.max(1, Math.round(long / BAY_WIDTH_M)) : 1;
      const across = row ? box.long : box.short; // along the row (bay width)
      const depth = row ? box.short : box.long; // into the bay
      const width = row ? long / n : short;
      const deep = row ? short : long;
      if (width < 1.5 || deep < 2.5) {
        stats.baySymbols.skipped += 1;
        continue;
      }
      for (let k = 0; k < n; k += 1) {
        const centre = add(box.centre, scale(across, (k - (n - 1) / 2) * width));
        // a white symbol drawn inside this bay already
        const inCell = (w) => Math.abs(dot(sub(w, centre), across)) <= width / 2 && Math.abs(dot(sub(w, centre), depth)) <= deep / 2;
        // a P bay's painted figure read as a wheelchair gives way to its P
        if (rule?.symbol === "P") {
          for (const t of whiteTemplates) if (inCell(t.c)) replaced.add(t.pc);
        } else if (whites.some(inCell)) {
          stats.baySymbols.existing += 1;
          continue;
        }
        for (const b of blobs) if (Math.abs(dot(sub(b.c, centre), across)) <= width / 2 && Math.abs(dot(sub(b.c, centre), depth)) <= deep / 2) replaced.add(b.pc);
        let up = null;
        let from = "추정";
        if (Number.isFinite(rule?.upBearingDeg)) {
          const b = (rule.upBearingDeg * Math.PI) / 180;
          const read = [Math.sin(b), -Math.cos(b)];
          up = dot(depth, read) >= 0 ? depth : scale(depth, -1);
          from = "reading";
        } else {
          const end = (sign) => [0.6, 1.2, 1.8].filter((d) => blocked(add(centre, scale(depth, sign * (deep / 2 + d))))).length;
          const [fwd, back] = [end(1), end(-1)];
          if (fwd !== back) {
            up = fwd > back ? depth : scale(depth, -1);
            from = "kerb";
          } else up = depth;
        }
        const symbol = rule?.symbol ?? "wheelchair";
        const polys = symbol === "P"
          ? textBlock(["P"], Math.min(0.42 * width, 1.4), deep, { charHeight: Math.min(1.45 * Math.min(0.42 * width, 1.4), 0.75 * deep) }).polys
          : wheelchairTemplate(Math.min(0.5 * width, 0.4 * deep, 1.6));
        emitPoly(place(polys, centre, up), "white", "disabled_parking", { glyph: symbol });
        stats.baySymbols[symbol === "P" ? "p" : "wheelchair"] += 1;
        if (from === "추정") stats.baySymbols.orientationGuessed += 1;
        stats.baySymbols.list.push({ ids: members.map((pc) => pc.id).filter(Boolean), cell: k, centre: toScene(centre), upBearingDeg: +(((Math.atan2(up[0], -up[1]) * 180) / Math.PI + 360) % 360).toFixed(1), from, symbol });
      }
    }
    for (let i = pieces.length - 1; i >= 0; i -= 1) if (replaced.has(pieces[i])) pieces.splice(i, 1);
    stats.baySymbols.blobsReplaced = replaced.size;
  }

  return { pieces, zebras, stats };
}

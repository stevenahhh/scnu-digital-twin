// Regularising fitters for the road markings (stages/markings.mjs). The photo detections are short traced fragments
// with kinks and pixel jitter; the paint they stand for is straight lines, circular arcs, equal dashes and equal zebra
// bars. These functions turn the fragments the paint gate accepted into that regular geometry. Every coordinate here
// is in metres in the model plane ([x, z]); the stage converts from and to scene units.
//
//   chainFragments  joins fragments of one line (same kind and colour, collinear ends, a gap no longer than the
//                   kind allows) into ordered chains
//   fitPath         fits one chain as straight segments joined by circular arcs: a robust (Huber) line per run,
//                   runs split where the paint bends, a tangent arc at each bend sized to the paint at the corner
//   layDashes       statute dashes along a fitted path, phase taken from the detected dashes
//   fitCrossing     one oriented rectangle and equal bars at the measured period for the bars of one crossing
//   mergeCrossings  one crossing = one bar set: bar groups whose rectangles overlap at the same axis are merged
// All fitted values are estimates from imagery (추정), not survey data.

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const scale = (a, s) => [a[0] * s, a[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const norm = (a) => Math.hypot(a[0], a[1]);
export const unit = (a) => {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n];
};
const perp = (d) => [-d[1], d[0]];
const quantile = (values, q) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
export const median = (values) => quantile(values, 0.5);

// ---------------------------------------------------------------- lines
// Weighted total-least-squares line: centre, unit direction (sign: from the first point towards the last).
export function tlsLine(points, weights = null) {
  let sw = 0;
  let cx = 0;
  let cz = 0;
  points.forEach((p, i) => {
    const w = weights ? weights[i] : 1;
    sw += w;
    cx += w * p[0];
    cz += w * p[1];
  });
  const centre = [cx / sw, cz / sw];
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  points.forEach((p, i) => {
    const w = weights ? weights[i] : 1;
    const dx = p[0] - centre[0];
    const dz = p[1] - centre[1];
    sxx += w * dx * dx;
    sxz += w * dx * dz;
    szz += w * dz * dz;
  });
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let dir = [Math.cos(angle), Math.sin(angle)];
  if (points.length > 1 && dot(sub(points.at(-1), points[0]), dir) < 0) dir = [-dir[0], -dir[1]];
  return { centre, dir };
}

// Robust line (iteratively reweighted, Huber weights at `huber` metres): a stray vertex does not tilt the line.
export function robustLine(points, huber = 0.08, iterations = 6) {
  let line = tlsLine(points);
  for (let k = 0; k < iterations; k += 1) {
    const n = perp(line.dir);
    const weights = points.map((p) => {
      const r = Math.abs(dot(sub(p, line.centre), n));
      return r <= huber ? 1 : huber / r;
    });
    line = tlsLine(points, weights);
  }
  return line;
}

export const residuals = (points, line) => points.map((p) => Math.abs(dot(sub(p, line.centre), perp(line.dir))));
const along = (p, line) => dot(sub(p, line.centre), line.dir);
const at = (line, s) => add(line.centre, scale(line.dir, s));

// Points every `step` metres along a polyline (its vertices' path), first and last included.
export function resample(line, step = 0.25) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const length = norm(sub(b, a));
    const n = Math.max(1, Math.ceil(length / step));
    for (let k = 1; k <= n; k += 1) out.push(add(a, scale(sub(b, a), k / n)));
  }
  return out;
}

export const polylineLength = (line) => line.slice(1).reduce((sum, p, i) => sum + norm(sub(p, line[i])), 0);

// A run of points is straight paint when 90 % of it lies within `tol` of its robust line and none beyond `maxTol`
// (pixel jitter of the 0.25 m photo is about +-0.1 m).
export const STRAIGHT_TOL_M = 0.1;
export const STRAIGHT_MAX_M = 0.3;
function straightFit(points, tol, maxTol) {
  const line = robustLine(points);
  const r = residuals(points, line);
  return { line, ok: quantile(r, 0.9) <= tol && Math.max(...r) <= maxTol };
}

// Fit an ordered chain of points (metres) as straight runs joined by tangent circular arcs. Returns the drawn path
// (a polyline; arcs sampled every `arcStepDeg`), its pieces ({ type: "line" | "arc", ... }) and the residuals of the
// input points from the path. `fillet: false` keeps sharp corners (stall frames).
export function fitPath(points, { tol = STRAIGHT_TOL_M, maxTol = STRAIGHT_MAX_M, minRun = 6, arcStepDeg = 3, fillet = true } = {}) {
  if (points.length < 2) throw new Error("fitPath needs at least two points");
  // 1. split recursively at the worst point until every run is straight
  const runs = [];
  const split = (from, to) => {
    const slice = points.slice(from, to + 1);
    const fit = straightFit(slice, tol, maxTol);
    if (fit.ok || to - from + 1 < 2 * minRun) {
      runs.push({ from, to });
      return;
    }
    const r = residuals(slice, fit.line);
    let worst = from + minRun;
    for (let i = minRun; i < slice.length - minRun; i += 1) if (r[i] > r[worst - from]) worst = from + i;
    split(from, worst);
    split(worst, to);
  };
  split(0, points.length - 1);
  // 2. merge neighbouring runs while the merged run is still straight
  let merged = true;
  while (merged && runs.length > 1) {
    merged = false;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i + 1 < runs.length; i += 1) {
      const slice = points.slice(runs[i].from, runs[i + 1].to + 1);
      const fit = straightFit(slice, tol, maxTol);
      if (!fit.ok) continue;
      const score = quantile(residuals(slice, fit.line), 0.9);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0) {
      runs.splice(best, 2, { from: runs[best].from, to: runs[best + 1].to });
      merged = true;
    }
  }
  // 3. a robust line per run, its extent the projections of its own points
  const lines = runs.map(({ from, to }) => {
    const slice = points.slice(from, to + 1);
    const line = robustLine(slice);
    const s = slice.map((p) => along(p, line));
    return { ...line, s0: Math.min(...s), s1: Math.max(...s) };
  });
  // 4. corners: intersect consecutive lines, round with a tangent arc that passes as close to the paint as the
  // paint itself passes the corner, tangent length at most half of either neighbouring straight
  const corners = [];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const [a, b] = [lines[i], lines[i + 1]];
    const denom = cross(a.dir, b.dir);
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(a.dir, b.dir))));
    let corner = null;
    if (Math.abs(denom) > 1e-6) {
      const t = cross(sub(b.centre, a.centre), b.dir) / denom;
      corner = at(a, t);
      // a corner far outside both runs (two nearly parallel offset lines) is not a bend
      if (Math.abs(along(corner, a) - a.s1) > 6 || Math.abs(along(corner, b) - b.s0) > 6) corner = null;
    }
    if (!corner || theta < 1e-3) {
      corners.push({ joint: true, from: at(a, a.s1), to: at(b, b.s0) });
      continue;
    }
    const near = points.slice(Math.max(0, runs[i].to - 12), Math.min(points.length, runs[i].to + 13));
    const gapAtCorner = Math.min(...near.map((p) => norm(sub(p, corner))));
    const sec = 1 / Math.cos(theta / 2);
    let radius = fillet && sec > 1 + 1e-9 ? gapAtCorner / (sec - 1) : 0;
    const lenA = along(corner, a) - (i > 0 ? along(corners[i - 1].exit ?? at(a, a.s0), a) : a.s0);
    const lenB = b.s1 - along(corner, b);
    const maxTangent = Math.max(0, 0.5 * Math.min(lenA, lenB));
    let tangent = radius * Math.tan(theta / 2);
    if (tangent > maxTangent) {
      tangent = maxTangent;
      radius = tangent / Math.tan(theta / 2);
    }
    const entry = sub(corner, scale(a.dir, tangent));
    const exit = add(corner, scale(b.dir, tangent));
    corners.push({ corner, entry, exit, radius, theta, turn: Math.sign(denom) });
  }
  // 5. the path
  const path = [at(lines[0], lines[0].s0)];
  const pieces = [];
  lines.forEach((line, i) => {
    const start = path.at(-1);
    const end = i < corners.length ? (corners[i].joint ? corners[i].from : corners[i].entry) : at(line, line.s1);
    if (norm(sub(end, start)) > 1e-6) path.push(end);
    pieces.push({ type: "line", from: start, to: end, dir: line.dir });
    if (i >= corners.length) return;
    const c = corners[i];
    if (c.joint) {
      path.push(c.to);
      pieces.push({ type: "joint", from: c.from, to: c.to });
      return;
    }
    if (c.radius > 1e-6) {
      const normal = scale(perp(line.dir), c.turn);
      const centre = add(c.entry, scale(normal, c.radius));
      const startAngle = Math.atan2(c.entry[1] - centre[1], c.entry[0] - centre[0]);
      const steps = Math.max(1, Math.ceil((c.theta * 180) / Math.PI / arcStepDeg));
      for (let k = 1; k <= steps; k += 1) {
        const angle = startAngle + c.turn * c.theta * (k / steps);
        path.push([centre[0] + c.radius * Math.cos(angle), centre[1] + c.radius * Math.sin(angle)]);
      }
      pieces.push({ type: "arc", centre, radius: c.radius, theta: c.theta, from: c.entry, to: c.exit });
    } else {
      path.push(c.corner);
    }
  });
  const res = points.map((p) => distanceToPolyline(p, path));
  return { path, pieces, lines, residual: { p50: quantile(res, 0.5), p95: quantile(res, 0.95), max: Math.max(...res) } };
}

export function distanceToSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return norm(sub(p, add(a, scale(ab, t))));
}
export const distanceToPolyline = (p, line) => Math.min(...line.slice(1).map((q, i) => distanceToSegment(p, line[i], q)));

// Largest lateral deviation of a polyline from the straight line through its ends: 0 for a fitted straight run.
export function straightness(line) {
  const d = unit(sub(line.at(-1), line[0]));
  return Math.max(...line.map((p) => Math.abs(cross(d, sub(p, line[0])))));
}

// Arc length of the projection of `p` onto a polyline.
export function projectArc(line, p) {
  let best = Infinity;
  let bestS = 0;
  let s = 0;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const ab = sub(line[i + 1], line[i]);
    const length = norm(ab);
    const t = length > 0 ? Math.max(0, Math.min(1, dot(sub(p, line[i]), ab) / (length * length))) : 0;
    const d = norm(sub(p, add(line[i], scale(ab, t))));
    if (d < best) {
      best = d;
      bestS = s + t * length;
    }
    s += length;
  }
  return bestS;
}

// Sub-polyline between arc lengths a and b.
export function slicePath(line, a, b) {
  const out = [];
  let s = 0;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const length = norm(sub(line[i + 1], line[i]));
    const point = (t) => add(line[i], scale(sub(line[i + 1], line[i]), (t - s) / length));
    if (length > 1e-9 && s + length >= a && s <= b) {
      if (!out.length) out.push(point(Math.max(a, s)));
      if (s + length <= b) out.push(line[i + 1]);
      else {
        out.push(point(b));
        break;
      }
    }
    s += length;
  }
  return out;
}

// Polyline offset sideways by `offset` metres (positive to the left of travel).
export function offsetPath(line, offset) {
  return line.map((p, i) => {
    const before = i > 0 ? unit(sub(p, line[i - 1])) : null;
    const after = i + 1 < line.length ? unit(sub(line[i + 1], p)) : null;
    const tangent = before && after ? unit(add(before, after)) : before ?? after;
    const miter = before && after ? 1 / Math.max(0.5, dot(tangent, before)) : 1;
    return add(p, scale(perp(tangent), offset * miter));
  });
}

// ---------------------------------------------------------------- chaining
// Fragments: { id, points (ordered polyline, metres), lineId? }. Two fragment ends link when the gap between them is
// at most `maxGap`, the ends point at each other within `maxAngleDeg`, and the far end lies within
// `lateral + gap * tan(maxAngleDeg / 2)` of the near fragment's end line. Fragments with the same lineId (the
// detection already traced them as one line) link on angle alone. Returns chains: [{ ids, points }] with points in
// travel order.
export function chainFragments(fragments, { maxGap = 3, maxAngleDeg = 20, lateral = 0.3 } = {}) {
  const ends = (f) => {
    const p = f.points;
    const k = Math.min(p.length - 1, Math.max(1, Math.floor(p.length / 3)));
    const headDir = unit(sub(p.at(-1), p.at(-1 - k)));
    const tailDir = unit(sub(p[0], p[k]));
    return [{ at: p[0], out: tailDir }, { at: p.at(-1), out: headDir }];
  };
  const info = fragments.map(ends);
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  const links = [];
  for (let i = 0; i < fragments.length; i += 1) {
    for (let j = i + 1; j < fragments.length; j += 1) {
      const sameLine = fragments[i].lineId && fragments[i].lineId === fragments[j].lineId;
      for (let ei = 0; ei < 2; ei += 1) {
        for (let ej = 0; ej < 2; ej += 1) {
          const a = info[i][ei];
          const b = info[j][ej];
          const gapVec = sub(b.at, a.at);
          const gap = norm(gapVec);
          if (gap > (sameLine ? Math.max(maxGap, 12) : maxGap)) continue;
          // ends facing each other: a's outward direction against b's inward one
          if (dot(a.out, scale(b.out, -1)) < cosMax) continue;
          const lateralA = Math.abs(cross(a.out, gapVec));
          const lateralB = Math.abs(cross(b.out, gapVec));
          const allowed = lateral + gap * Math.tan((maxAngleDeg * Math.PI) / 360);
          if (!sameLine && (lateralA > allowed || lateralB > allowed)) continue;
          if (gap > 0.5 && dot(gapVec, a.out) < 0) continue;
          links.push({ i, j, ei, ej, cost: gap + 4 * Math.max(lateralA, lateralB) - (sameLine ? 2 : 0) });
        }
      }
    }
  }
  links.sort((p, q) => p.cost - q.cost);
  const used = new Set();
  const parent = fragments.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const next = new Map();
  for (const link of links) {
    const ka = `${link.i}:${link.ei}`;
    const kb = `${link.j}:${link.ej}`;
    if (used.has(ka) || used.has(kb) || root(link.i) === root(link.j)) continue;
    used.add(ka);
    used.add(kb);
    parent[root(link.i)] = root(link.j);
    next.set(ka, kb);
    next.set(kb, ka);
  }
  const visited = new Set();
  const chains = [];
  for (let start = 0; start < fragments.length; start += 1) {
    if (visited.has(start)) continue;
    // walk to one free end of this chain
    let cur = start;
    let enter = 0;
    const seen = new Set([cur]);
    for (;;) {
      const link = next.get(`${cur}:${enter}`);
      if (!link) break;
      const [f, e] = link.split(":").map(Number);
      if (seen.has(f)) break;
      seen.add(f);
      cur = f;
      enter = 1 - e;
    }
    // cur's end `enter` is free: walk the chain from it
    const ids = [];
    const points = [];
    let f = cur;
    let from = enter;
    for (;;) {
      visited.add(f);
      const pts = from === 0 ? fragments[f].points : [...fragments[f].points].reverse();
      ids.push(fragments[f].id);
      points.push(...pts);
      const link = next.get(`${f}:${1 - from}`);
      if (!link) break;
      const [g, e] = link.split(":").map(Number);
      if (visited.has(g)) break;
      f = g;
      from = e;
    }
    chains.push({ ids, points, members: ids.length });
  }
  return chains;
}

// ---------------------------------------------------------------- dashes
// Dash intervals [from, to] (arc length, metres) along a path of `length` metres, `dash` paint and `gap` blank, with
// the phase fitted to the detected dash centres (arc lengths): the circular mean of the centres modulo the period.
// Only dashes whose centre lies within the detected extent (first dash start .. last dash end, +- half a dash) are
// laid, so the line neither runs past the paint nor skips a dash a car hides.
export function dashPhase(centres, period, weights = null) {
  let c = 0;
  let s = 0;
  centres.forEach((x, i) => {
    const w = weights ? weights[i] : 1;
    const a = (2 * Math.PI * x) / period;
    c += w * Math.cos(a);
    s += w * Math.sin(a);
  });
  const phase = ((Math.atan2(s, c) / (2 * Math.PI)) * period + period) % period;
  return phase;
}

export function layDashes({ length, detected, dash, gap }) {
  const period = dash + gap;
  const phase = dashPhase(detected.map(([a, b]) => (a + b) / 2), period, detected.map(([a, b]) => Math.max(0.1, b - a)));
  const lo = Math.max(0, Math.min(...detected.map((d) => d[0])) - dash / 2);
  const hi = Math.min(length, Math.max(...detected.map((d) => d[1])) + dash / 2);
  const out = [];
  for (let k = Math.floor((lo - phase) / period) - 1; ; k += 1) {
    const centre = phase + k * period;
    if (centre > hi) break;
    if (centre < lo) continue;
    const from = Math.max(0, centre - dash / 2);
    const to = Math.min(length, centre + dash / 2);
    if (to - from >= dash / 2) out.push([from, to]);
  }
  return { phase, period, dashes: out };
}

// Measured dash period of one chain: consecutive detected dash centres, each spacing divided by its whole number of
// periods (a hidden dash doubles a spacing); null with fewer than three dashes.
export function measuredPeriod(detected, nominal) {
  if (detected.length < 3) return null;
  const centres = detected.map(([a, b]) => (a + b) / 2).sort((a, b) => a - b);
  const spacings = [];
  for (let i = 1; i < centres.length; i += 1) {
    const d = centres[i] - centres[i - 1];
    const n = Math.max(1, Math.round(d / nominal));
    if (d / n > 0.4 * nominal) spacings.push(d / n);
  }
  return spacings.length >= 2 ? median(spacings) : null;
}

// ---------------------------------------------------------------- zebras
// Bars: [{ centre, axis (unit, along the bar = along the carriageway), length, id }] in metres. One crossing: the
// bar axis is the length-weighted mean axis (or `roadDir` when given and within `roadSnapDeg`: bars run along the
// carriageway), the walk axis its normal; the rectangle spans the detected bars along the walk axis and the median
// bar along the bar axis; bars are laid at `period` with the phase of the detected bar centres.
// `frame` ({ axis, origin, phase }) fixes the axis and the bar grid, so adjacent rows of one crossing share their bars.
export function crossingAxis(bars) {
  const reference = bars[0].axis;
  return unit(bars.reduce((acc, b) => {
    const sign = dot(b.axis, reference) >= 0 ? 1 : -1;
    return add(acc, scale(b.axis, sign * b.length));
  }, [0, 0]));
}
// Period of a row of bars at walk positions t (metres): the period in [lo, hi] whose phases agree best (the length of
// the mean phase vector, 1 = every bar on one grid), searched every 1 mm; null with fewer than `minBars` bars.
export function fitPeriod(t, [lo, hi], minBars = 4) {
  if (t.length < minBars) return null;
  let best = null;
  for (let p = lo; p <= hi + 1e-9; p += 0.001) {
    let c = 0;
    let s = 0;
    for (const x of t) {
      c += Math.cos((2 * Math.PI * x) / p);
      s += Math.sin((2 * Math.PI * x) / p);
    }
    const r = Math.hypot(c, s) / t.length;
    if (!best || r > best.r + 1e-12) best = { period: p, r };
  }
  return best;
}
export function fitCrossing(bars, { period: nominal, bar, roadDir = null, roadSnapDeg = 5, frame = null, periodRange = null }) {
  let axis = frame?.axis ?? crossingAxis(bars);
  if (!frame && roadDir && Math.abs(dot(unit(roadDir), axis)) >= Math.cos((roadSnapDeg * Math.PI) / 180)) axis = scale(unit(roadDir), Math.sign(dot(unit(roadDir), axis)) || 1);
  const walk = perp(axis);
  const origin = frame?.origin ?? bars[0].centre;
  const t = bars.map((b) => dot(sub(b.centre, origin), walk));
  const u = bars.map((b) => dot(sub(b.centre, origin), axis));
  // the row's own period where it has enough bars and a range is given, else the nominal (or the frame's) one
  const own = !frame?.period && periodRange ? fitPeriod(t, periodRange) : null;
  const period = frame?.period ?? own?.period ?? nominal;
  const phase = frame?.phase ?? dashPhase(t, period);
  const tMin = Math.min(...t);
  const tMax = Math.max(...t);
  // bar slots of the period grid covering the detected bars
  const k0 = Math.round((tMin - phase) / period);
  const k1 = Math.round((tMax - phase) / period);
  // bar length: the median detected bar (bars at the kerb or under a car are shorter); centred on the bars' median
  const length = median(bars.map((b) => b.length));
  const uCentre = median(u);
  const slots = [];
  for (let k = k0; k <= k1; k += 1) slots.push(add(origin, add(scale(walk, phase + k * period), scale(axis, uCentre))));
  const tCentre = phase + ((k0 + k1) / 2) * period;
  const centre = add(origin, add(scale(walk, tCentre), scale(axis, uCentre)));
  const rectangle = {
    centre, axis, walk,
    halfWalk: ((k1 - k0) * period + bar) / 2,
    halfBar: length / 2,
  };
  const barRects = slots.map((c) => rect(c, axis, walk, length / 2, bar / 2));
  const residual = t.map((x) => {
    const d = (((x - phase) % period) + period) % period;
    return Math.min(d, period - d);
  });
  return { rectangle, bars: barRects, barCentres: slots, phase, period, origin, count: slots.length, phaseResidual: { p50: median(residual), max: Math.max(...residual) } };
}

export function rect(centre, along, across, halfAlong, halfAcross) {
  return [
    add(centre, add(scale(along, -halfAlong), scale(across, -halfAcross))),
    add(centre, add(scale(along, halfAlong), scale(across, -halfAcross))),
    add(centre, add(scale(along, halfAlong), scale(across, halfAcross))),
    add(centre, add(scale(along, -halfAlong), scale(across, halfAcross))),
  ];
}

// Bar groups [{ id, bars }] whose axes agree within `maxAngleDeg` and whose bar rectangles overlap (any bar centre
// of one within the other's rectangle grown by `reach` metres) are one crossing; so are groups of one row (their
// spans along the bar axis overlap by half the shorter) separated along the walk by at most `rowGap` metres (a
// median or a car splits the detected bars of one crossing).
export function mergeCrossings(groups, { maxAngleDeg = 20, reach = 0.6, rowGap = 3 } = {}) {
  const boxes = groups.map((g) => {
    const axis = unit(g.bars.reduce((acc, b) => add(acc, scale(b.axis, dot(b.axis, g.bars[0].axis) >= 0 ? 1 : -1)), [0, 0]));
    const walk = perp(axis);
    const o = g.bars[0].centre;
    const t = g.bars.map((b) => dot(sub(b.centre, o), walk));
    const u = g.bars.flatMap((b) => [dot(sub(b.centre, o), axis) - b.length / 2, dot(sub(b.centre, o), axis) + b.length / 2]);
    return { axis, walk, o, t0: Math.min(...t) - 0.5, t1: Math.max(...t) + 0.5, u0: Math.min(...u), u1: Math.max(...u) };
  });
  const inside = (box, p) => {
    const t = dot(sub(p, box.o), box.walk);
    const u = dot(sub(p, box.o), box.axis);
    return t >= box.t0 - reach && t <= box.t1 + reach && u >= box.u0 - reach && u <= box.u1 + reach;
  };
  const sameRow = (box, bars, gap) => {
    const t = bars.map((b) => dot(sub(b.centre, box.o), box.walk));
    const u = bars.flatMap((b) => [dot(sub(b.centre, box.o), box.axis) - b.length / 2, dot(sub(b.centre, box.o), box.axis) + b.length / 2]);
    const overlap = Math.min(box.u1, Math.max(...u)) - Math.max(box.u0, Math.min(...u));
    const shorter = Math.min(box.u1 - box.u0, Math.max(...u) - Math.min(...u));
    const walkGap = Math.max(Math.min(...t) - (box.t1 - 0.5), (box.t0 + 0.5) - Math.max(...t));
    return overlap >= 0.5 * shorter && walkGap <= gap;
  };
  const parent = groups.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      if (Math.abs(dot(boxes[i].axis, boxes[j].axis)) < cosMax) continue;
      if (groups[j].bars.some((b) => inside(boxes[i], b.centre)) || groups[i].bars.some((b) => inside(boxes[j], b.centre))) parent[root(i)] = root(j);
      else if (sameRow(boxes[i], groups[j].bars, rowGap)) parent[root(i)] = root(j);
    }
  }
  const merged = new Map();
  groups.forEach((g, i) => {
    const r = root(i);
    if (!merged.has(r)) merged.set(r, { ids: [], bars: [] });
    merged.get(r).ids.push(g.id);
    merged.get(r).bars.push(...g.bars);
  });
  return [...merged.values()];
}

// Minimum-area oriented rectangle of a point set: centre, unit axes (long first), half sizes.
export function orientedBox(points) {
  let best = null;
  for (let a = 0; a < 180; a += 0.25) {
    const u = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
    const v = perp(u);
    let s0 = Infinity;
    let s1 = -Infinity;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const p of points) {
      const s = dot(p, u);
      const t = dot(p, v);
      if (s < s0) s0 = s;
      if (s > s1) s1 = s;
      if (t < t0) t0 = t;
      if (t > t1) t1 = t;
    }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area - 1e-12) best = { area, u, v, s0, s1, t0, t1 };
  }
  const { u, v, s0, s1, t0, t1 } = best;
  const centre = add(scale(u, (s0 + s1) / 2), scale(v, (t0 + t1) / 2));
  return s1 - s0 >= t1 - t0
    ? { centre, long: u, short: v, halfLong: (s1 - s0) / 2, halfShort: (t1 - t0) / 2 }
    : { centre, long: v, short: u, halfLong: (t1 - t0) / 2, halfShort: (s1 - s0) / 2 };
}

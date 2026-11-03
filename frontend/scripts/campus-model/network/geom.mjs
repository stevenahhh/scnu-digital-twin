// Planar helpers shared by the network builders (sidewalks, crossings, fallback, connectors, buildNetwork). Pure
// functions on [x, y] points in metres (the simulation frame: metres east/north of the D4 anchor in EPSG:5186 TM).
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
export const lineLength = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]), 0);

// Even-odd point in polygon over all rings (outer + holes).
export function inRings(p, rings) {
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

export function segmentNearest(p, a, b) {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)) : 0;
  const q = [a[0] + t * ex, a[1] + t * ey];
  return { t, q, d: dist(p, q) };
}

// Distance from p to the boundary of the rings (closed: the last point joins the first when not repeated).
export function ringsDistance(p, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const b = ring[(i + 1) % ring.length];
      if (b === ring[i]) continue;
      best = Math.min(best, segmentNearest(p, ring[i], b).d);
    }
  }
  return best;
}

// Nearest point on a polyline: { d, q, seg, t, s } (s = arc length at q).
export function nearestOnLine(p, pts) {
  let best = null;
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const r = segmentNearest(p, pts[i], pts[i + 1]);
    const len = dist(pts[i], pts[i + 1]);
    if (!best || r.d < best.d) best = { ...r, seg: i, s: s + r.t * len };
    s += len;
  }
  return best;
}

// Points every `step` metres along a polyline (both ends included).
export function sampleLine(pts, step = 1) {
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

// Polyline vertices densified so no segment is longer than maxM.
export function densify(pts, maxM) {
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const n = Math.max(1, Math.ceil(dist(pts[i], pts[i + 1]) / maxM));
    for (let k = 1; k <= n; k += 1) out.push([pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / n, pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * k) / n]);
  }
  return out;
}

// Polyline cut at arc lengths s0..s1.
export function subLine(pts, s0, s1) {
  const out = [];
  let s = 0;
  const at = (i, t) => [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const len = dist(pts[i], pts[i + 1]);
    const a = s;
    const b = s + len;
    if (b >= s0 && a <= s1 && len > 0) {
      if (!out.length) out.push(at(i, Math.max(0, (s0 - a) / len)));
      if (b <= s1) out.push(pts[i + 1]);
      else {
        out.push(at(i, (s1 - a) / len));
        break;
      }
    }
    s = b;
  }
  return out;
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

const bboxOf = (rings) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};

// Uniform-grid index over polygons ({ rings, ...data }): contains / classify / nearest within a reach.
export class PolygonGrid {
  constructor(polygons, cell = 20) {
    this.cell = cell;
    this.cells = new Map();
    this.polygons = polygons.map((poly) => ({ ...poly, box: bboxOf(poly.rings) }));
    this.polygons.forEach((poly, k) => {
      const [x0, y0, x1, y1] = poly.box;
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i += 1) {
        for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j += 1) {
          const key = `${i},${j}`;
          if (!this.cells.has(key)) this.cells.set(key, []);
          this.cells.get(key).push(k);
        }
      }
    });
  }

  candidates(p, reach = 0) {
    const out = new Set();
    const r = Math.ceil(reach / this.cell);
    const ci = Math.floor(p[0] / this.cell);
    const cj = Math.floor(p[1] / this.cell);
    for (let i = ci - r; i <= ci + r; i += 1) for (let j = cj - r; j <= cj + r; j += 1) for (const k of this.cells.get(`${i},${j}`) ?? []) out.add(k);
    return [...out].map((k) => this.polygons[k]);
  }

  // First polygon containing p (optionally filtered), else null.
  find(p, filter = null) {
    for (const poly of this.candidates(p)) {
      const [x0, y0, x1, y1] = poly.box;
      if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
      if (filter && !filter(poly)) continue;
      if (inRings(p, poly.rings)) return poly;
    }
    return null;
  }

  contains(p, filter = null) {
    return this.find(p, filter) !== null;
  }

  // Distance to the nearest polygon (0 inside) within reach, else Infinity.
  distance(p, reach, filter = null) {
    let best = Infinity;
    for (const poly of this.candidates(p, reach)) {
      if (filter && !filter(poly)) continue;
      if (inRings(p, poly.rings)) return 0;
      best = Math.min(best, ringsDistance(p, poly.rings));
    }
    return best <= reach ? best : Infinity;
  }
}

// Uniform-grid index over polylines ({ points, ...data }) for nearest-point queries.
export class LineGrid {
  constructor(lines, cell = 20) {
    this.cell = cell;
    this.cells = new Map();
    this.lines = lines;
    lines.forEach((line, k) => {
      for (let s = 0; s + 1 < line.points.length; s += 1) {
        const a = line.points[s];
        const b = line.points[s + 1];
        for (let i = Math.floor(Math.min(a[0], b[0]) / cell); i <= Math.floor(Math.max(a[0], b[0]) / cell); i += 1) {
          for (let j = Math.floor(Math.min(a[1], b[1]) / cell); j <= Math.floor(Math.max(a[1], b[1]) / cell); j += 1) {
            const key = `${i},${j}`;
            if (!this.cells.has(key)) this.cells.set(key, []);
            this.cells.get(key).push([k, s]);
          }
        }
      }
    });
  }

  // Nearest point on any line within reach: { line, k, seg, q, d } or null.
  nearest(p, reach, filter = null) {
    let best = null;
    const r = Math.ceil(reach / this.cell);
    const ci = Math.floor(p[0] / this.cell);
    const cj = Math.floor(p[1] / this.cell);
    const seen = new Set();
    for (let i = ci - r; i <= ci + r; i += 1) {
      for (let j = cj - r; j <= cj + r; j += 1) {
        for (const [k, s] of this.cells.get(`${i},${j}`) ?? []) {
          const key = k * 100000 + s;
          if (seen.has(key)) continue;
          seen.add(key);
          const line = this.lines[k];
          if (filter && !filter(line)) continue;
          const res = segmentNearest(p, line.points[s], line.points[s + 1]);
          if (res.d <= reach && (!best || res.d < best.d)) best = { line, k, seg: s, q: res.q, t: res.t, d: res.d };
        }
      }
    }
    return best;
  }
}

// Union-find over string or number keys.
export class UnionFind {
  constructor() {
    this.parent = new Map();
  }

  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    let c = x;
    while (this.parent.get(c) !== r) {
      const n = this.parent.get(c);
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

// Fraction of the 0.5 m samples of a polyline for which test(p) holds.
export function shareOf(pts, test, step = 0.5) {
  const samples = sampleLine(pts, step);
  return samples.filter(test).length / samples.length;
}

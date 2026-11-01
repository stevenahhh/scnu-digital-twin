// Terrain-conforming decal triangles, shared by the road markings (stages/markings.mjs) and the ground surfaces
// (stages/surfaces.mjs): a flat triangle is split along the Topography grid lines and diagonals it crosses until every
// piece lies inside one terrain triangle (or the flat triangle already stays within CONFORM_TOLERANCE_M of it).
import { metres } from "./frame.mjs";
import { pointInRing, ringArea } from "./geometry.mjs";

const CONFORM_TOLERANCE_M = 0.005;

// Splits polygon `poly` (convex) by the line f(p) = c. Edge crossings are computed from the edge's lexicographically
// first endpoint, so two pieces sharing an edge get bit-identical vertices.
export function splitConvex(poly, f, c) {
  const below = [];
  const above = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p) - c;
    const fq = f(q) - c;
    if (fp <= 0) below.push(p);
    if (fp >= 0) above.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const [s, e] = p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? [p, q] : [q, p];
      const t = (c - f(s)) / (f(e) - f(s));
      const x = [s[0] + (e[0] - s[0]) * t, s[1] + (e[1] - s[1]) * t];
      below.push(x);
      above.push(x);
    }
  }
  return [below, above].filter((piece) => piece.length >= 3 && Math.abs(ringArea(piece)) > 1e-10);
}

// Triangles (in [x, z]) of `tri` lying each inside one terrain triangle: unsplit when the flat triangle stays within
// CONFORM_TOLERANCE_M of the terrain, else split along the grid lines and diagonals it crosses.
export function conform(tri, surface) {
  const { step, x0, z0 } = surface.grid;
  const xs = tri.map((p) => p[0]);
  const zs = tri.map((p) => p[1]);
  const ds = tri.map((p) => p[0] + p[1]);
  const lines = (lo, hi, origin) => {
    const out = [];
    for (let v = origin + Math.ceil((lo - origin) / step) * step; v < hi; v += step) if (v > lo) out.push(v);
    return out;
  };
  const vertical = lines(Math.min(...xs), Math.max(...xs), x0);
  const horizontal = lines(Math.min(...zs), Math.max(...zs), z0);
  const diagonal = lines(Math.min(...ds), Math.max(...ds), x0 + z0);
  if (!vertical.length && !horizontal.length && !diagonal.length) return [tri];
  // Deviation of the flat triangle from the terrain at its crease crossings and the grid vertices inside it.
  const h = tri.map((p) => surface.height(p[0], p[1]));
  const det = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]);
  const flat = ([x, z]) => {
    const l1 = ((x - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (z - tri[0][1])) / det;
    const l2 = ((tri[1][0] - tri[0][0]) * (z - tri[0][1]) - (x - tri[0][0]) * (tri[1][1] - tri[0][1])) / det;
    return h[0] + (h[1] - h[0]) * l1 + (h[2] - h[0]) * l2;
  };
  const tests = [];
  for (let i = 0; i < 3; i += 1) {
    const p = tri[i];
    const q = tri[(i + 1) % 3];
    for (const [values, f] of [[vertical, (r) => r[0]], [horizontal, (r) => r[1]], [diagonal, (r) => r[0] + r[1]]]) {
      for (const c of values) {
        const fp = f(p) - c;
        const fq = f(q) - c;
        if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) tests.push([p[0] + (q[0] - p[0]) * (fp / (fp - fq)), p[1] + (q[1] - p[1]) * (fp / (fp - fq))]);
      }
    }
  }
  for (const x of vertical) for (const z of horizontal) if (pointInRing([x, z], tri)) tests.push([x, z]);
  const tolerance = metres(CONFORM_TOLERANCE_M);
  if (tests.every((q) => Math.abs(flat(q) - surface.height(q[0], q[1])) <= tolerance)) return [tri];
  let pieces = [tri];
  for (const x of vertical) pieces = pieces.flatMap((piece) => splitConvex(piece, (r) => r[0], x));
  for (const z of horizontal) pieces = pieces.flatMap((piece) => splitConvex(piece, (r) => r[1], z));
  for (const d of diagonal) pieces = pieces.flatMap((piece) => splitConvex(piece, (r) => r[0] + r[1], d));
  return pieces.flatMap((piece) => piece.slice(2).map((_, k) => [piece[0], piece[k + 1], piece[k + 2]]));
}

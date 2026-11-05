// Planar partition of the ground (user 2026-10-29: ground textures must not overlap). Every ground piece is a convex
// polygon in [x, z] inside one Topography triangle (lib/conform.mjs). Pieces are claimed from the top class down
// (road markings, then the surface classes by precedence, then the natural Topography): a claim keeps only the part of
// its piece that no earlier claim in the same terrain triangle covers (convex difference), so no two ground triangles
// share area and every surface lies on the terrain with no stacking lift.
import { ringArea } from "./geometry.mjs";
import { EXTENT } from "./frame.mjs";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";

const MIN_AREA = 1e-8;

// Splits convex `poly` by the line f(p) = 0 into { inside: f >= 0, outside: f <= 0 }. A crossing is computed from the
// edge's lexicographically first endpoint, so pieces sharing an edge get bit-identical vertices (lib/conform.mjs).
export function splitByLine(poly, f) {
  const inside = [];
  const outside = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) inside.push(p);
    if (fp <= 0) outside.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const [s, e] = p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? [p, q] : [q, p];
      const fs = f(s);
      const t = fs / (fs - f(e));
      const x = [s[0] + (e[0] - s[0]) * t, s[1] + (e[1] - s[1]) * t];
      inside.push(x);
      outside.push(x);
    }
  }
  const keep = (piece) => {
    const clean = piece.filter((p, i) => {
      const q = piece[(i + 1) % piece.length];
      return Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) >= 1e-12;
    });
    return clean.length >= 3 && Math.abs(ringArea(clean)) > MIN_AREA ? clean : null;
  };
  return { inside: keep(inside), outside: keep(outside) };
}

// Convex `poly` minus convex `cut`: convex pieces covering poly \ cut.
export function subtractConvex(poly, cut) {
  const sign = ringArea(cut) > 0 ? 1 : -1;
  const out = [];
  let rest = poly;
  for (let i = 0; i < cut.length && rest; i += 1) {
    const a = cut[i];
    const b = cut[(i + 1) % cut.length];
    // a zero-length edge has no side: f would be 0 everywhere and hand the whole piece out as "outside"
    if (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) < 1e-12) continue;
    const f = (p) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const { inside, outside } = splitByLine(rest, f);
    if (outside) out.push(outside);
    rest = inside;
  }
  return out;
}

const bbox = (poly) => {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return [minX, minZ, maxX, maxZ];
};
const disjoint = (a, b) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];

// Separating-axis test: true when convex a and b share no interior (touching edges count as apart). Cutting a piece
// by a claim it does not reach would split it along the claim's edge lines for nothing, and those needless cuts
// compound over every claim in the cell.
function separated(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q[1] - p[1];
      const nz = p[0] - q[0];
      // a zero-length edge (repeated vertex) has no normal: it would project everything to 0 and fake a separation
      if (Math.abs(nx) + Math.abs(nz) < 1e-12) continue;
      let minA = Infinity;
      let maxA = -Infinity;
      for (const r of a) {
        const d = r[0] * nx + r[1] * nz;
        if (d < minA) minA = d;
        if (d > maxA) maxA = d;
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (const r of b) {
        const d = r[0] * nx + r[1] * nz;
        if (d < minB) minB = d;
        if (d > maxB) maxB = d;
      }
      const scale = Math.hypot(nx, nz) * 1e-9;
      if (maxA <= minB + scale || maxB <= minA + scale) return true;
    }
  }
  return false;
}

// Claims per terrain triangle. `cellOf(piece)` names the Topography triangle a conformed piece lies in.
// Splits convex `poly` along the Topography grid (lines x = x0 + i step, z = z0 + j step and the diagonals x + z =
// x0 + z0 + k step, as topographySurface triangulates each cell) into pieces that each lie inside one terrain
// triangle, keyed "i,j,half" (half 0: the a c b triangle with u + v <= 1, 1: b c d).
export function splitToTerrainTriangles(poly, { step, x0, z0 }) {
  let pieces = [poly];
  const cut = (f, lo, hi, origin) => {
    for (let v = origin + Math.ceil((lo - origin) / step) * step; v < hi; v += step) {
      if (v <= lo) continue;
      pieces = pieces.flatMap((piece) => {
        const { inside, outside } = splitByLine(piece, (p) => f(p) - v);
        return [inside, outside].filter(Boolean);
      });
    }
  };
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const ds = poly.map((p) => p[0] + p[1]);
  cut((p) => p[0], Math.min(...xs), Math.max(...xs), x0);
  cut((p) => p[1], Math.min(...zs), Math.max(...zs), z0);
  cut((p) => p[0] + p[1], Math.min(...ds), Math.max(...ds), x0 + z0);
  return pieces.map((piece) => {
    let cx = 0;
    let cz = 0;
    for (const [x, z] of piece) {
      cx += x;
      cz += z;
    }
    const fx = (cx / piece.length - x0) / step;
    const fz = (cz / piece.length - z0) / step;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    return { piece, key: `${i},${j},${fx - i + (fz - j) <= 1 ? 0 : 1}` };
  });
}

// Claims per terrain triangle of the Topography grid ({ step, x0, z0 }, stages/ground.mjs topographySurface).
export class GroundPartition {
  constructor(grid) {
    this.grid = grid;
    this.cellArea = (grid.step * grid.step) / 2;
    this.cells = new Map();
  }

  // Claims convex `piece` (split along the terrain grid first); returns the convex parts of it no earlier claim covers.
  claim(piece) {
    const out = [];
    piece = piece.filter((p, i) => {
      const q = piece[(i + 1) % piece.length];
      return Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) >= 1e-12;
    });
    if (piece.length < 3) return out;
    for (const { piece: part, key } of splitToTerrainTriangles(piece, this.grid)) out.push(...this.claimInCell(part, key));
    return out;
  }

  claimInCell(piece, key, cellArea = this.cellArea) {
    const debug = process.env.PARTITION_DEBUG_CELL === key;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { claims: [], area: 0 };
      this.cells.set(key, cell);
    }
    if (cell.area >= cellArea * (1 - 1e-9)) return [];
    let parts = [{ poly: piece, box: bbox(piece) }];
    for (const claim of cell.claims) {
      const next = [];
      for (const part of parts) {
        if (disjoint(part.box, claim.box) || separated(part.poly, claim.poly)) next.push(part);
        else for (const poly of subtractConvex(part.poly, claim.poly)) next.push({ poly, box: bbox(poly) });
      }
      parts = next;
      if (!parts.length) break;
    }
    if (debug) console.log(`partition debug ${key}: piece ${JSON.stringify(piece)} -> ${JSON.stringify(parts.map((part) => part.poly))} (claims before ${cell.claims.length}, area ${cell.area.toFixed(4)})`);
    for (const part of parts) {
      cell.claims.push(part);
      cell.area += Math.abs(ringArea(part.poly));
    }
    return parts.map((part) => part.poly);
  }
}

// Claims per triangle of an irregular terrain mesh (a TIN such as stages/outerTerrain.mjs): positions [x, y, z ...]
// and triangle indices; the cell of a piece is the TIN triangle it lies in (key = the triangle's first index offset).
export class TinPartition extends GroundPartition {
  constructor(positions, indices, bin = 20) {
    super({ step: 1, x0: 0, z0: 0 });
    this.positions = positions;
    this.indices = indices;
    this.bin = bin;
    this.bins = new Map();
    this.triangles = [];
    for (let t = 0; t < indices.length; t += 3) {
      const tri = [indices[t], indices[t + 1], indices[t + 2]].map((k) => [positions[k * 3], positions[k * 3 + 2]]);
      if (ringArea(tri) < 0) tri.reverse();
      const area = Math.abs(ringArea(tri));
      if (area < MIN_AREA) continue;
      const box = bbox(tri);
      this.triangles[t] = { tri, area, box };
      for (let i = Math.floor(box[0] / bin); i <= Math.floor(box[2] / bin); i += 1) {
        for (let j = Math.floor(box[1] / bin); j <= Math.floor(box[3] / bin); j += 1) {
          const k = `${i},${j}`;
          if (!this.bins.has(k)) this.bins.set(k, []);
          this.bins.get(k).push(t);
        }
      }
    }
    // The D4 repair box is the user-supplied EPSG:5186 scope, not a survey
    // estimate. Inner ground already owns EXTENT; reserve that footprint in
    // the outer TIN too, so its inward crack-covering skirt cannot draw a
    // second surface there. Outside D4 the existing ring is untouched.
    let inner = [
      [243422.55, 263767.58], [243591.87, 263767.58],
      [243591.87, 263991.06], [243422.55, 263991.06],
    ].map(([e, n]) => tmToScene(e, n));
    for (const f of [
      p => p[0] - EXTENT.minX, p => EXTENT.maxX - p[0],
      p => p[1] - EXTENT.minZ, p => EXTENT.maxZ - p[1],
    ]) inner = splitByLine(inner, f).inside;
    this.claimOnTin(inner);
  }

  // The TIN triangles whose box meets `box`.
  candidates(box) {
    const seen = new Set();
    for (let i = Math.floor(box[0] / this.bin); i <= Math.floor(box[2] / this.bin); i += 1) {
      for (let j = Math.floor(box[1] / this.bin); j <= Math.floor(box[3] / this.bin); j += 1) {
        for (const t of this.bins.get(`${i},${j}`) ?? []) seen.add(t);
      }
    }
    return [...seen];
  }

  // Claims convex `piece` ([x, z] scene units), cut by every TIN triangle it meets; returns [{ poly, triangle }] for
  // the parts no earlier claim covers. A piece off the mesh (inside EXTENT, beyond the ring) claims nothing.
  claimOnTin(piece) {
    const out = [];
    const box = bbox(piece);
    for (const t of this.candidates(box)) {
      const { tri, area, box: tbox } = this.triangles[t];
      if (disjoint(box, tbox) || separated(piece, tri)) continue;
      let part = piece;
      for (let i = 0; i < 3 && part; i += 1) {
        const a = tri[i];
        const b = tri[(i + 1) % 3];
        part = splitByLine(part, (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])).inside;
      }
      if (!part) continue;
      for (const poly of this.claimInCell(part, t, area)) out.push({ poly, triangle: t });
    }
    return out;
  }
}

// Total area of the overlap between two convex polygons (0 when they only touch).
export function convexOverlapArea(a, b) {
  const sign = ringArea(b) > 0 ? 1 : -1;
  let rest = a;
  for (let i = 0; i < b.length && rest; i += 1) {
    const p = b[i];
    const q = b[(i + 1) % b.length];
    if (Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) < 1e-12) continue;
    rest = splitByLine(rest, (r) => sign * ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))).inside;
  }
  return rest ? Math.abs(ringArea(rest)) : 0;
}

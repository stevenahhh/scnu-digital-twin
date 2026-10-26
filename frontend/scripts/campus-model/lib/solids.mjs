// Small solid-modelling kit for the street furniture (stages/furniture.mjs) and the lamps (stages/lights.mjs).
// Every part is appended to one MeshData, so a whole layer stays one primitive (one draw call). Positions are scene
// units (uni.glb frame, see frame.mjs); sizes passed to the helpers are metres. Faces are flat-shaded and oriented by
// geometry (outward = face centre minus solid centre, or a given direction), so callers never think about winding.
// A Kit either carries vertex colours (RGBA bytes in linear light, `paint` = rgb(...)) or texture coordinates
// (`paint` = [u, v], for the emissive-masked lamp heads).
import { ShapeUtils, Vector2 } from "three";
import { metres } from "./frame.mjs";
import { MeshData } from "./meshData.mjs";

const M = metres;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const centroid = (points) => scale(points.reduce((sum, p) => add(sum, p), [0, 0, 0]), 1 / points.length);

// glTF vertex colours are linear; design colours are sRGB hex. Alpha stays linear.
const toLinearByte = (c) => {
  const v = c / 255;
  return Math.round(255 * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
};
export function rgb(hex, alpha = 255) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [toLinearByte(n >> 16), toLinearByte((n >> 8) & 255), toLinearByte(n & 255), alpha];
}

export class Kit {
  constructor({ uvs = false } = {}) {
    this.uvs = uvs;
    this.mesh = new MeshData({ uvs, colors: !uvs });
  }

  get vertexCount() {
    return this.mesh.vertexCount;
  }

  get triangleCount() {
    return this.mesh.indices.length / 3;
  }

  vertex(p, n, paint) {
    return this.uvs ? this.mesh.vertex(p, n, paint) : this.mesh.vertex(p, n, undefined, paint);
  }

  // Planar convex polygon (scene units) facing `outward` (any vector on the front side).
  face(points, outward, paint) {
    let n = [0, 0, 0];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
    }
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) return;
    n = unit(n);
    let ordered = points;
    if (dot(n, outward) < 0) {
      ordered = [...points].reverse();
      n = scale(n, -1);
    }
    const base = this.mesh.vertexCount;
    for (const p of ordered) this.vertex(p, n, paint);
    for (let i = 1; i + 1 < ordered.length; i += 1) this.mesh.triangle(base, base + i, base + i + 1);
  }

  // Convex hexahedron: c = [b0, b1, b2, b3, t0, t1, t2, t3] (bottom ring, top ring in the same order).
  // paint: one paint or { top, side, bottom }. The bottom face is left out unless `bottom` is set.
  hexa(c, paint, { bottom = false, top = true, sides = [true, true, true, true] } = {}) {
    const p = paint.top || paint.side ? paint : { top: paint, side: paint, bottom: paint };
    const middle = centroid(c);
    const emit = (points, colour) => this.face(points, sub(centroid(points), middle), colour);
    if (top) emit([c[4], c[5], c[6], c[7]], p.top ?? p.side);
    if (bottom) emit([c[0], c[1], c[2], c[3]], p.bottom ?? p.side);
    for (let i = 0; i < 4; i += 1) {
      if (!sides[i]) continue;
      const j = (i + 1) % 4;
      emit([c[i], c[j], c[j + 4], c[i + 4]], p.side ?? p.top);
    }
  }

  // Box between two points of a local frame (see frame()): s along, t across, h up, all metres.
  box(f, [s0, s1], [t0, t1], [h0, h1], paint, options) {
    if (s1 - s0 < 1e-4 || t1 - t0 < 1e-4 || h1 - h0 < 1e-4) return;
    const at = (s, t, h) => local(f, s, t, h);
    this.hexa([at(s0, t0, h0), at(s1, t0, h0), at(s1, t1, h0), at(s0, t1, h0), at(s0, t0, h1), at(s1, t0, h1), at(s1, t1, h1), at(s0, t1, h1)], paint, options);
  }

  // Square-section member between two 3D points (scene units); width across, depth in the `up` plane (metres).
  beam(a, b, width, depth, paint, { up = [0, 1, 0], ends = true } = {}) {
    const d = unit(sub(b, a));
    let side = cross(d, up);
    if (Math.hypot(side[0], side[1], side[2]) < 1e-6) side = cross(d, [1, 0, 0]);
    side = scale(unit(side), M(width) / 2);
    const normal = scale(unit(cross(side, d)), M(depth) / 2);
    const corner = (p, sx, sy) => add(add(p, scale(side, sx)), scale(normal, sy));
    const c = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1), corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
    // the "bottom"/"top" of this hexa are the two end caps
    this.hexa(c, paint, { bottom: ends, top: ends });
  }

  // Vertical n-sided pole from (x, y0, z) to y1 (scene units), radii in metres, with a top cap.
  pole([x, z], y0, y1, r0, r1, paint, { sides = 8, cap = true } = {}) {
    const ring = (y, r) => Array.from({ length: sides }, (_, i) => {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      return [x + Math.cos(a) * M(r), y, z + Math.sin(a) * M(r)];
    });
    const lower = ring(y0, r0);
    const upper = ring(y1, r1);
    for (let i = 0; i < sides; i += 1) {
      const j = (i + 1) % sides;
      const radial = [(lower[i][0] + lower[j][0]) / 2 - x, 0, (lower[i][2] + lower[j][2]) / 2 - z];
      this.face([lower[i], lower[j], upper[j], upper[i]], radial, paint);
    }
    if (cap) this.face(upper, [0, 1, 0], paint);
  }

  // Cone or pyramid: apex above (or below) a horizontal base ring of scene-unit points; `base` adds the base face.
  cone(apex, ring, paint, { base = true, basePaint = paint } = {}) {
    const middle = centroid([...ring, apex]);
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      this.face([a, b, apex], sub(centroid([a, b, apex]), middle), paint);
    }
    if (base) this.face(ring, sub(centroid(ring), apex), basePaint);
  }

  // Vertical prism over a plan ring ([x, z] scene units). bottom/top: numbers (scene units) or (x, z) -> y.
  prism(ring, bottom, top, paint, { topFace = true, walls = true } = {}) {
    const p = paint.top || paint.side ? paint : { top: paint, side: paint };
    const yb = typeof bottom === "function" ? bottom : () => bottom;
    const yt = typeof top === "function" ? top : () => top;
    const area = ring.reduce((sum, a, i) => {
      const b = ring[(i + 1) % ring.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0);
    const sign = area > 0 ? 1 : -1;
    if (walls) {
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        // outward normal of edge a->b for a ring of this orientation
        const out = [(b[1] - a[1]) * sign, 0, -(b[0] - a[0]) * sign];
        this.face([[a[0], yb(...a), a[1]], [b[0], yb(...b), b[1]], [b[0], yt(...b), b[1]], [a[0], yt(...a), a[1]]], out, p.side);
      }
    }
    if (topFace) this.flat(ring, [], yt, p.top);
  }

  // Horizontal (or terrain-following) polygon with holes, facing up (or down).
  flat(outer, holes, y, paint, { down = false } = {}) {
    const height = typeof y === "function" ? y : () => y;
    const contour = outer.map(([x, z]) => new Vector2(x, z));
    const holeVectors = holes.map((ring) => ring.map(([x, z]) => new Vector2(x, z)));
    if (ShapeUtils.isClockWise(contour)) contour.reverse();
    holeVectors.forEach((ring) => {
      if (!ShapeUtils.isClockWise(ring)) ring.reverse();
    });
    const faces = ShapeUtils.triangulateShape(contour, holeVectors);
    const all = [...contour, ...holeVectors.flat()];
    const normal = down ? [0, -1, 0] : [0, 1, 0];
    const base = this.mesh.vertexCount;
    for (const v of all) this.vertex([v.x, height(v.x, v.y), v.y], normal, paint);
    for (const [a, b, c] of faces) {
      if (down) this.mesh.triangle(base + a, base + b, base + c);
      else this.mesh.triangle(base + a, base + c, base + b);
    }
  }

  toPrimitive(material) {
    return this.mesh.toPrimitive(material);
  }
}

// Local frame at scene point (x, y, z) with plan direction (ux, uz): s along u, t along v (u turned +90 deg), h up.
export function frame([x, y, z], [ux, uz]) {
  const length = Math.hypot(ux, uz) || 1;
  return { o: [x, y, z], u: [ux / length, uz / length], v: [-uz / length, ux / length] };
}

export function local(f, s, t, h) {
  return [f.o[0] + M(s) * f.u[0] + M(t) * f.v[0], f.o[1] + M(h), f.o[2] + M(s) * f.u[1] + M(t) * f.v[1]];
}

// Plan point of a local frame (scene units).
export function localPlan(f, s, t) {
  return [f.o[0] + M(s) * f.u[0] + M(t) * f.v[0], f.o[2] + M(s) * f.u[1] + M(t) * f.v[1]];
}

// Local (s, t) metres of a plan point.
export function toLocal(f, [x, z]) {
  const dx = (x - f.o[0]) / M(1);
  const dz = (z - f.o[2]) / M(1);
  return [dx * f.u[0] + dz * f.u[1], dx * f.v[0] + dz * f.v[1]];
}

// Minimum-area rectangle of a plan ring (0.5 deg steps): centre, long axis u, half sizes in metres.
export function orientedRect(ring) {
  let best = null;
  for (let a = 0; a < 180; a += 0.5) {
    const ux = Math.cos((a * Math.PI) / 180);
    const uz = Math.sin((a * Math.PI) / 180);
    let s0 = Infinity;
    let s1 = -Infinity;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const [x, z] of ring) {
      const s = x * ux + z * uz;
      const t = -x * uz + z * ux;
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area) best = { area, ux, uz, s0, s1, t0, t1 };
  }
  const { ux, uz, s0, s1, t0, t1 } = best;
  const sc = (s0 + s1) / 2;
  const tc = (t0 + t1) / 2;
  const rect = { centre: [sc * ux - tc * uz, sc * uz + tc * ux], u: [ux, uz], halfLength: (s1 - s0) / 2 / M(1), halfWidth: (t1 - t0) / 2 / M(1) };
  if (rect.halfWidth > rect.halfLength) {
    rect.u = [-uz, ux];
    [rect.halfLength, rect.halfWidth] = [rect.halfWidth, rect.halfLength];
  }
  return rect;
}

// Polyline offset by d scene units to its left (mitred joints, mitre length capped at 3 d). A closed ring (last point
// equal to the first) is offset as a ring: the seam vertex is mitred between its two edges like every other corner, so
// the first and last offset points coincide (no gap or overlap at the seam).
export function offsetLine(line, d) {
  const out = [];
  const n0 = line.length;
  const closed = n0 >= 4 && Math.hypot(line[0][0] - line[n0 - 1][0], line[0][1] - line[n0 - 1][1]) < 1e-9;
  for (let i = 0; i < n0; i += 1) {
    const prev = closed && i === 0 ? line[n0 - 2] : line[Math.max(0, i - 1)];
    const next = closed && i === n0 - 1 ? line[1] : line[Math.min(n0 - 1, i + 1)];
    const a = i > 0 || closed ? unit([line[i][0] - prev[0], 0, line[i][1] - prev[1]]) : null;
    const b = i + 1 < n0 || closed ? unit([next[0] - line[i][0], 0, next[1] - line[i][1]]) : null;
    const na = a ? [-a[2], a[0]] : null;
    const nb = b ? [-b[2], b[0]] : null;
    let n = na && nb ? [na[0] + nb[0], na[1] + nb[1]] : (na ?? nb);
    const length = Math.hypot(n[0], n[1]) || 1;
    n = [n[0] / length, n[1] / length];
    const cos = na && nb ? Math.max(1 / 3, n[0] * na[0] + n[1] * na[1]) : 1;
    out.push([line[i][0] + (n[0] * d) / cos, line[i][1] + (n[1] * d) / cos]);
  }
  return out;
}

// Closed plan ring around a polyline, half width d scene units.
export function bufferLine(line, d) {
  return [...offsetLine(line, d), ...offsetLine(line, -d).reverse()];
}

// Points every `step` scene units along a polyline (ends included), with unit direction.
export function along(line, step) {
  const out = [];
  let carry = 0;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 1e-9) continue;
    const u = [(bx - ax) / length, (bz - az) / length];
    for (let t = carry; t < length; t += step) out.push({ p: [ax + u[0] * t, az + u[1] * t], u });
    carry = (((carry - length) % step) + step) % step;
  }
  const last = line.at(-1);
  const prev = line.at(-2);
  const length = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1;
  out.push({ p: last, u: [(last[0] - prev[0]) / length, (last[1] - prev[1]) / length] });
  return out;
}

export const lineLength = (line) => line.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);

export { add, cross, dot, scale, sub, unit };

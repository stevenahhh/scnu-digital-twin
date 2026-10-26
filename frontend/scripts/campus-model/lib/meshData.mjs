// Growable triangle soup with per-vertex normal/uv/colour, flushed into GlbBuilder primitives.
import { ShapeUtils, Vector2 } from "three";

export class MeshData {
  constructor({ uvs = true, colors = false } = {}) {
    this.positions = [];
    this.normals = [];
    this.uvs = uvs ? [] : null;
    this.colors = colors ? [] : null;
    this.indices = [];
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  vertex(position, normal, uv = [0, 0], color = [255, 255, 255, 255]) {
    this.positions.push(position[0], position[1], position[2]);
    this.normals.push(normal[0], normal[1], normal[2]);
    if (this.uvs) this.uvs.push(uv[0], uv[1]);
    if (this.colors) this.colors.push(color[0], color[1], color[2], color[3] ?? 255);
    return this.vertexCount - 1;
  }

  triangle(a, b, c) {
    this.indices.push(a, b, c);
  }

  // Flat-shaded quad from four corners in counter-clockwise order seen from the front.
  quad(p0, p1, p2, p3, uv = [[0, 0], [1, 0], [1, 1], [0, 1]], color) {
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0];
    const vy = p3[1] - p0[1];
    const vz = p3[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    // A stretch whose top meets its base at one end (p3 === p0) is still a visible triangle. Take its normal from
    // the diagonals then: a zero normal makes the shader's normalize() NaN, which Bloom spreads into black blocks.
    if (Math.hypot(nx, ny, nz) < 1e-12) {
      const [ax, ay, az] = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const [bx, by, bz] = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]];
      nx = ay * bz - az * by;
      ny = az * bx - ax * bz;
      nz = ax * by - ay * bx;
    }
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const base = this.vertexCount;
    [p0, p1, p2, p3].forEach((p, i) => this.vertex(p, [nx, ny, nz], uv[i], color));
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Horizontal polygon (outer ring + holes as [x, z] arrays) at height y, facing up (or down).
  horizontalPolygon(outer, holes, y, { down = false, uvScale = 1, color } = {}) {
    const contour = outer.map(([x, z]) => new Vector2(x, z));
    const holeVectors = holes.map((ring) => ring.map(([x, z]) => new Vector2(x, z)));
    if (ShapeUtils.isClockWise(contour)) contour.reverse();
    holeVectors.forEach((ring) => {
      if (!ShapeUtils.isClockWise(ring)) ring.reverse();
    });
    const faces = ShapeUtils.triangulateShape(contour, holeVectors);
    const all = [...contour, ...holeVectors.flat()];
    const base = this.vertexCount;
    const normal = down ? [0, -1, 0] : [0, 1, 0];
    for (const p of all) this.vertex([p.x, y, p.y], normal, [p.x * uvScale, p.y * uvScale], color);
    // contour is CCW in (x, z); with +y up that is clockwise from above, so flip for an upward face.
    for (const [a, b, c] of faces) {
      if (down) this.indices.push(base + a, base + b, base + c);
      else this.indices.push(base + a, base + c, base + b);
    }
  }

  append(other) {
    const base = this.vertexCount;
    this.positions.push(...other.positions);
    this.normals.push(...other.normals);
    if (this.uvs) this.uvs.push(...(other.uvs ?? new Array((other.positions.length / 3) * 2).fill(0)));
    if (this.colors) this.colors.push(...(other.colors ?? new Array((other.positions.length / 3) * 4).fill(255)));
    for (const index of other.indices) this.indices.push(index + base);
  }

  toPrimitive(material) {
    return {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      uvs: this.uvs ? Float32Array.from(this.uvs) : undefined,
      colors: this.colors ? Uint8Array.from(this.colors) : undefined,
      indices: this.indices,
      material,
    };
  }
}

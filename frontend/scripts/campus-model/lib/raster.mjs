// RGB raster helpers used to paint the ground texture.
export class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
  }

  set(x, y, [r, g, b], alpha = 1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    if (alpha >= 1) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
    } else {
      this.data[i] += (r - this.data[i]) * alpha;
      this.data[i + 1] += (g - this.data[i + 1]) * alpha;
      this.data[i + 2] += (b - this.data[i + 2]) * alpha;
    }
  }

  // Even-odd scanline fill. rings: arrays of [px, py] in pixel space. shade(x, y) -> [r, g, b].
  fillPolygon(rings, shade, alpha = 1) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ring of rings) {
      for (const [, y] of ring) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.height - 1, Math.ceil(maxY));
    const crossings = [];
    for (let y = y0; y <= y1; y += 1) {
      const sy = y + 0.5;
      crossings.length = 0;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if ((yi > sy) !== (yj > sy)) crossings.push(xi + ((sy - yi) / (yj - yi)) * (xj - xi));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const xa = Math.max(0, Math.ceil(crossings[k] - 0.5));
        const xb = Math.min(this.width - 1, Math.floor(crossings[k + 1] - 0.5));
        for (let x = xa; x <= xb; x += 1) this.set(x, y, shade(x, y), alpha);
      }
    }
  }

  // Thick polyline (round joints) in pixel space.
  strokePolyline(points, width, shade, alpha = 1) {
    const half = width / 2;
    for (let i = 0; i + 1 < points.length; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 1e-6) continue;
      const nx = (-(by - ay) / length) * half;
      const ny = ((bx - ax) / length) * half;
      this.fillPolygon([[[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]], shade, alpha);
    }
    for (const [x, y] of points) this.fillDisc(x, y, half, shade, alpha);
  }

  fillDisc(cx, cy, radius, shade, alpha = 1) {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius * radius) this.set(x, y, shade(x, y), alpha);
      }
    }
  }
}

// Deterministic value noise in [0, 1).
export function hashNoise(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function smoothNoise(x, y, scale, seed = 0) {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hashNoise(ix, iy, seed);
  const b = hashNoise(ix + 1, iy, seed);
  const c = hashNoise(ix, iy + 1, seed);
  const d = hashNoise(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

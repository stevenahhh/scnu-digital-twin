// Pure image and grid functions of the overhead-blend measurement (scripts/perf/overhead-blend.mjs), kept apart so
// node --test can exercise them without a browser or the NGII sheet.

// 100 m tiles in EPSG:5186, snapped to multiples of `tile` metres, covering the bounding box of `cornersTm`.
// A tile is { E0, N0 } = its south-west corner; it spans [E0, E0 + tile] x [N0, N0 + tile].
export function tileGrid(cornersTm, tile = 100) {
  const es = cornersTm.map((p) => p[0]);
  const ns = cornersTm.map((p) => p[1]);
  const e0 = Math.floor(Math.min(...es) / tile) * tile;
  const e1 = Math.ceil(Math.max(...es) / tile) * tile;
  const n0 = Math.floor(Math.min(...ns) / tile) * tile;
  const n1 = Math.ceil(Math.max(...ns) / tile) * tile;
  const tiles = [];
  for (let N0 = n1 - tile; N0 >= n0; N0 -= tile) {
    for (let E0 = e0; E0 < e1; E0 += tile) tiles.push({ E0, N0 });
  }
  return tiles;
}

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Rec. 601 luma of interleaved pixels (`channels` 3 or 4) as Float32 0..255.
export function luminance(pixels, width, height, channels = 3) {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const at = i * channels;
    out[i] = 0.299 * pixels[at] + 0.587 * pixels[at + 1] + 0.114 * pixels[at + 2];
  }
  return out;
}

// Sobel gradient magnitude normalised by its theoretical maximum (4 * 255 * sqrt 2), so 0..1; border pixels are 0.
export const SOBEL_MAX = 4 * 255 * Math.SQRT2;
export function sobel(lum, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const a = lum[i - width - 1], b = lum[i - width], c = lum[i - width + 1];
      const d = lum[i - 1], f = lum[i + 1];
      const g = lum[i + width - 1], h = lum[i + width], k = lum[i + width + 1];
      const gx = c + 2 * f + k - a - 2 * d - g;
      const gy = g + 2 * h + k - a - 2 * b - c;
      out[i] = Math.hypot(gx, gy) / SOBEL_MAX;
    }
  }
  return out;
}

// Share of pixels whose normalised edge magnitude is in the top 10 % of the magnitude range (>= 0.1).
export const EDGE_THRESHOLD = 0.1;
export function edgeShare(edges) {
  let n = 0;
  for (const v of edges) if (v >= EDGE_THRESHOLD) n += 1;
  return n / edges.length;
}

// Zero-mean cross-correlation of `render` against `photo` (same size) for integer shifts in [-maxShift, maxShift].
// C(dx, dy) = sum over the interior of (R(x, y) - mR) (P(x - dx, y - dy) - mP): the peak (dx, dy) is how far the render
// content sits right (+dx) and down (+dy, i.e. south) of the photo. Returns the peak, the scores and the ratio of the
// peak to the best score outside the peak's 3 x 3 neighbourhood (Infinity when that score is <= 0).
export function correlate(render, photo, width, height, maxShift = 4) {
  const m = maxShift;
  let mR = 0;
  let mP = 0;
  let count = 0;
  for (let y = m; y < height - m; y += 1) {
    for (let x = m; x < width - m; x += 1) {
      mR += render[y * width + x];
      count += 1;
    }
  }
  for (const v of photo) mP += v;
  mR /= count;
  mP /= photo.length;
  const size = 2 * m + 1;
  const scores = new Float64Array(size * size);
  for (let dy = -m; dy <= m; dy += 1) {
    for (let dx = -m; dx <= m; dx += 1) {
      let sum = 0;
      for (let y = m; y < height - m; y += 1) {
        const rRow = y * width;
        const pRow = (y - dy) * width - dx;
        for (let x = m; x < width - m; x += 1) sum += (render[rRow + x] - mR) * (photo[pRow + x] - mP);
      }
      scores[(dy + m) * size + (dx + m)] = sum;
    }
  }
  let best = 0;
  for (let i = 1; i < scores.length; i += 1) if (scores[i] > scores[best]) best = i;
  const bx = (best % size) - m;
  const by = Math.floor(best / size) - m;
  let second = -Infinity;
  for (let i = 0; i < scores.length; i += 1) {
    const x = (i % size) - m;
    const y = Math.floor(i / size) - m;
    if (Math.abs(x - bx) <= 1 && Math.abs(y - by) <= 1) continue;
    second = Math.max(second, scores[i]);
  }
  const peak = scores[best];
  return { dx: bx, dy: by, peak, ratio: second > 0 ? peak / second : Infinity, scores: Array.from(scores) };
}

// One tile's verdict: signal when the render has >= edgeFloor edge pixels; pass when |dx|, |dy| <= passPx.
export function measureTile({ render, photo, width, height, channels = 3, maxShift = 4, edgeFloor = 0.02, passPx = 1 }) {
  const renderEdges = sobel(luminance(render, width, height, channels), width, height);
  const photoEdges = sobel(luminance(photo, width, height, 3), width, height);
  const share = edgeShare(renderEdges);
  const signal = share >= edgeFloor;
  const { dx, dy, ratio } = correlate(renderEdges, photoEdges, width, height, maxShift);
  return {
    dx,
    dy,
    ratio: Number.isFinite(ratio) ? Math.round(ratio * 1000) / 1000 : null,
    edgeShare: Math.round(share * 10000) / 10000,
    signal,
    pass: signal ? Math.max(Math.abs(dx), Math.abs(dy)) <= passPx : null,
    renderEdges,
    photoEdges,
  };
}

// Whole-run verdict: PASS when every signal tile passes (and there is at least one).
export function aggregate(tiles) {
  const signal = tiles.filter((t) => t.signal);
  const maxShiftPx = signal.reduce((m, t) => Math.max(m, Math.abs(t.dx), Math.abs(t.dy)), 0);
  return {
    tilesTotal: tiles.length,
    signalTiles: signal.length,
    failingTiles: signal.filter((t) => !t.pass).length,
    pass: signal.length > 0 && signal.every((t) => t.pass),
    maxShiftPx,
  };
}

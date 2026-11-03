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

// ---------------------------------------------------------------- before/after comparison (--compare)
// A `<window>-side.png` is render | 8 px gap | photo. The left half is render-only (no photo pixels), safe for PR images.
export const SIDE_GAP = 8;
export function renderHalf(pixels, width, height, channels = 3) {
  const w = (width - SIDE_GAP) / 2;
  if (!Number.isInteger(w) || w <= 0) throw new Error(`not a side-by-side image: width ${width}`);
  const out = new Uint8Array(w * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const s = (y * width + x) * channels;
      out.set([pixels[s], pixels[s + 1], pixels[s + 2]], (y * w + x) * 3);
    }
  }
  return { pixels: out, width: w, height };
}

// Two RGB images of the same size side by side with the same gap (before left, after right).
export function sideBySide(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error("before and after differ in size");
  const W = a.width * 2 + SIDE_GAP;
  const out = new Uint8Array(W * a.height * 3).fill(17);
  for (let y = 0; y < a.height; y += 1) {
    out.set(a.pixels.subarray(y * a.width * 3, (y + 1) * a.width * 3), y * W * 3);
    out.set(b.pixels.subarray(y * b.width * 3, (y + 1) * b.width * 3), (y * W + a.width + SIDE_GAP) * 3);
  }
  return { pixels: out, width: W, height: a.height };
}

// Per-tile (and per-window) dx/dy before vs after as a Markdown table, with the PASS counts of both runs.
export function residualsMarkdown(before, after) {
  const key = (t) => `${t.E0},${t.N0}`;
  const prior = new Map(before.tiles.map((t) => [key(t), t]));
  const cell = (t) => (t ? `${t.dx}, ${t.dy} ${t.signal ? (t.pass ? "PASS" : "FAIL") : "no signal"}` : "-");
  const passed = (run) => run.tiles.filter((t) => t.signal && t.pass).length;
  const lines = [
    `before: ${passed(before)}/${before.signalTiles} signal tiles within ${before.thresholds?.passPx ?? 1} px (pass ${before.pass}); after: ${passed(after)}/${after.signalTiles} (pass ${after.pass})`,
    "",
    "| tile E0, N0 | before dx, dy | after dx, dy |",
    "| --- | --- | --- |",
    ...after.tiles.map((t) => `| ${key(t)} | ${cell(prior.get(key(t)))} | ${cell(t)} |`),
  ];
  const windows = new Map((before.windows ?? []).map((w) => [w.name, w]));
  if (after.windows?.length) {
    lines.push("", "| window | before dx, dy | after dx, dy |", "| --- | --- | --- |", ...after.windows.map((w) => `| ${w.name} | ${cell(windows.get(w.name))} | ${cell(w)} |`));
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------- visible-ground mode (--visible-ground)
// The full mode compares everything the render shows. Two things there are not ground the dashboard shows correctly by
// construction: the ground under a building (the render hides buildings in this mode, the photo shows the roof, leaned
// by relief displacement) and the ground under trees (the photo shows canopy and its shade, the ground-only render does
// not). The visible-ground mode removes both from BOTH edge maps and correlates what is left.
export const VISIBLE = Object.freeze({
  leanBufferM: 2, // building footprints are dilated by this much (photo roof lean)
  canopyGreen: 8, // photo pixel is canopy when G exceeds R and B by this much
  shadeLum: 30, // ... or is darker than this (deep shade under trees and buildings)
  canopyDilatePx: 2,
  // Measurability, chosen from the R2 evidence (62 tile measurements, campus 100 m tiles on GLBs b148320 and 865023c;
  // EVID r2/work/visible-eval*.txt):
  //   X minRatio 1.10: peak / best score outside the peak's 3 x 3 neighbourhood. All nine values below 1.09 (1.035-1.083)
  //     are flat or periodic correlations (stadium lane and pitch lines, a tile of thin fragments) and hold the only shift
  //     off by more than 1 px (-2,-2 at 1.078); every value from 1.112 up lands within 1 px. 1.10 sits in that gap.
  //   N minVisibleShare 0.08: the smallest visible share measured, 9.3 % (a canopy-covered tile), still gives a sharp
  //     correct peak (ratio 1.45), so no failure in the evidence comes from too little visible ground; 8 % is just below
  //     the tested range, and less than that is called untested rather than guessed.
  //   minEdgeShare 0.003: the lowest render edge share with a sharp peak is 0.0039; the one tile below (0.0023-0.0026)
  //     has no usable edges.
  minVisibleShare: 0.08,
  minEdgeShare: 0.003,
  minRatio: 1.1,
});

const dilate = (mask, width, height, r) => {
  if (r <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      for (let j = -r; j <= r; j += 1) for (let i = -r; i <= r; i += 1) {
        const xx = x + i;
        const yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height && i * i + j * j <= r * r) out[yy * width + xx] = 1;
      }
    }
  }
  return out;
};

// rings: building footprints in tile pixels ([[x, y], ...], pixel centres at +0.5); returns the filled, dilated mask.
export function footprintMask(rings, width, height, bufferPx) {
  const mask = new Uint8Array(width * height);
  for (const ring of rings) {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    if (Math.max(...xs) < -bufferPx || Math.min(...xs) > width + bufferPx || Math.max(...ys) < -bufferPx || Math.min(...ys) > height + bufferPx) continue;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(height - 1, Math.ceil(Math.max(...ys))); y += 1) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(width - 1, Math.ceil(Math.max(...xs))); x += 1) {
        if (pointInRing([x + 0.5, y + 0.5], ring)) mask[y * width + x] = 1;
      }
    }
    // the outline itself, so footprints thinner than a pixel still count before dilation
    for (let k = 0; k + 1 < ring.length; k += 1) {
      const [a, b] = [ring[k], ring[k + 1]];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2) + 1;
      for (let s = 0; s <= n; s += 1) {
        const x = Math.floor(a[0] + ((b[0] - a[0]) * s) / n);
        const y = Math.floor(a[1] + ((b[1] - a[1]) * s) / n);
        if (x >= 0 && y >= 0 && x < width && y < height) mask[y * width + x] = 1;
      }
    }
  }
  return dilate(mask, width, height, Math.round(bufferPx));
}

// Photo canopy and deep shade (RGB, 3 channels), dilated.
export function canopyMask(photo, width, height, { green = VISIBLE.canopyGreen, shade = VISIBLE.shadeLum, dilatePx = VISIBLE.canopyDilatePx } = {}) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const [r, g, b] = [photo[i * 3], photo[i * 3 + 1], photo[i * 3 + 2]];
    if ((g > r + green && g > b + green) || 0.299 * r + 0.587 * g + 0.114 * b < shade) mask[i] = 1;
  }
  return dilate(mask, width, height, dilatePx);
}

// One tile in visible-ground mode: excluded = footprint or canopy mask (1 = not visible ground).
export function measureVisible({ render, photo, width, height, channels = 3, excluded, maxShift = 4, passPx = 1, minVisibleShare = VISIBLE.minVisibleShare, minEdgeShare = VISIBLE.minEdgeShare, minRatio = VISIBLE.minRatio }) {
  const keep = (edges) => edges.map((v, i) => (excluded[i] ? 0 : v));
  const renderEdges = keep(sobel(luminance(render, width, height, channels), width, height));
  const photoEdges = keep(sobel(luminance(photo, width, height, 3), width, height));
  const visibleShare = excluded.reduce((n, v) => n + (v ? 0 : 1), 0) / (width * height);
  const share = edgeShare(renderEdges);
  const { dx, dy, ratio } = correlate(renderEdges, photoEdges, width, height, maxShift);
  const reasons = [];
  if (visibleShare < minVisibleShare) reasons.push(`visible ground ${(visibleShare * 100).toFixed(1)} % < ${minVisibleShare * 100} %`);
  if (share < minEdgeShare) reasons.push(`edge share ${share.toFixed(4)} < ${minEdgeShare}`);
  if (!(ratio >= minRatio)) reasons.push(`peak ratio ${Number.isFinite(ratio) ? ratio.toFixed(3) : ratio} < ${minRatio}`);
  const verdict = reasons.length ? "not measurable" : Math.max(Math.abs(dx), Math.abs(dy)) <= passPx ? "PASS" : "FAIL";
  return {
    dx, dy, ratio: Number.isFinite(ratio) ? Math.round(ratio * 1000) / 1000 : null,
    visibleShare: Math.round(visibleShare * 10000) / 10000, edgeShare: Math.round(share * 10000) / 10000,
    verdict, reason: reasons.join("; ") || null, renderEdges, photoEdges,
  };
}

// Visible-ground summary: PASS when no measurable tile fails and at least one is measurable.
export function aggregateVisible(tiles) {
  const measurable = tiles.filter((t) => t.verdict !== "not measurable");
  const failing = measurable.filter((t) => t.verdict === "FAIL");
  return { tilesTotal: tiles.length, measurableTiles: measurable.length, notMeasurable: tiles.length - measurable.length, failingTiles: failing.length, pass: measurable.length > 0 && failing.length === 0 };
}

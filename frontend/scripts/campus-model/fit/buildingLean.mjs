// Per-building relief lean in the NGII orthophoto: the roof of a mass of height h appears at footprint + h * lean
// (lean in metres per metre of height, [dE, dN]). fitLean() slides every mass outline (outer ring and holes, each lifted
// by its own top) over the photo's Sobel edges and keeps the lean whose outline sits on the strongest edges, searched
// around the prior (registration lean field / building-forms leanPrior) in a coarse then a fine grid.
//
// When the photo shows no roof edge (flat or hidden: the best outline score is weak or barely above the typical score of
// the search grid), the prior is returned with method "prior", estimated: true, rather than a lean fitted to noise.
// residual_m is the RMS distance, along the outline normal, from the fitted outline to the strongest nearby edge.
//
// Window convention as lib/occlusion.mjs: { w, h, origin: [E, N] of the top-left pixel corner, gsdM }; grey is a
// Float32Array(w * h), row 0 = north. Pure function: the tool (fit/buildingLeanFit.mjs) reads the sheet.

export const LEAN = Object.freeze({
  reach: 0.15, // m/m around the prior (coarse grid)
  coarseStep: 0.01,
  fineReach: 0.012,
  fineStep: 0.001,
  minEdge: 6, // mean Sobel magnitude (grey levels) along the best outline
  minContrast: 1.6, // best score over the median score of the coarse grid
  normalReachM: 1,
});

function sobel(grey, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const g = (dx, dy) => grey[(y + dy) * w + x + dx];
      const gx = g(1, -1) + 2 * g(1, 0) + g(1, 1) - g(-1, -1) - 2 * g(-1, 0) - g(-1, 1);
      const gy = g(-1, 1) + 2 * g(0, 1) + g(1, 1) - g(-1, -1) - 2 * g(0, -1) - g(1, -1);
      out[y * w + x] = Math.hypot(gx, gy) / 4;
    }
  }
  return out;
}

function bilinear(img, w, h, x, y) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return null;
  const x0 = Math.min(w - 2, Math.floor(x));
  const y0 = Math.min(h - 2, Math.floor(y));
  const fx = x - x0;
  const fy = y - y0;
  const at = (i, j) => img[j * w + i];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

// Outline samples in metres: { p: [E, N], n: unit normal, top } every half pixel along each ring edge.
function outlineSamples(masses, gsdM) {
  const out = [];
  for (const m of masses) {
    for (const ring of [m.ring, ...(m.holes ?? [])]) {
      for (let k = 0; k < ring.length; k += 1) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
        const count = Math.max(1, Math.floor(len / (gsdM / 2)));
        // skip the end quarter-metres: corners blur two edges together
        for (let s = 0; s < count; s += 1) {
          const t = (s + 0.5) / count;
          if (t * len < 0.5 || (1 - t) * len < 0.5) continue;
          out.push({ p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], n, top: m.topM });
        }
      }
    }
  }
  return out;
}

const toPx = (win, E, N) => [(E - win.origin[0]) / win.gsdM - 0.5, (win.origin[1] - N) / win.gsdM - 0.5];

function score(edges, win, samples, lean) {
  let s = 0;
  let n = 0;
  for (const q of samples) {
    const [x, y] = toPx(win, q.p[0] + lean[0] * q.top, q.p[1] + lean[1] * q.top);
    const v = bilinear(edges, win.w, win.h, x, y);
    if (v === null) continue;
    s += v;
    n += 1;
  }
  return n >= samples.length / 2 ? s / n : 0;
}

function grid(centre, reach, step) {
  const ks = [];
  for (let k = -Math.round(reach / step); k <= Math.round(reach / step); k += 1) ks.push(k * step);
  return ks.flatMap((de) => ks.map((dn) => [centre[0] + de, centre[1] + dn]));
}

export function fitLean(grey, win, { masses, prior, options = {} }) {
  const o = { ...LEAN, ...options };
  const edges = sobel(grey, win.w, win.h);
  const samples = outlineSamples(masses, win.gsdM);
  const fallback = { lean: [...prior], residual_m: null, method: "prior", estimated: true };
  if (!samples.length) return fallback;
  const coarse = grid(prior, o.reach, o.coarseStep).map((v) => ({ v, s: score(edges, win, samples, v) }));
  const sorted = coarse.map((c) => c.s).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let best = coarse.reduce((a, b) => (b.s > a.s ? b : a));
  for (const v of grid(best.v, o.fineReach, o.fineStep)) {
    const s = score(edges, win, samples, v);
    if (s > best.s) best = { v, s };
  }
  if (!(best.s >= o.minEdge) || !(best.s >= o.minContrast * Math.max(median, 1e-6))) return { ...fallback, score: round(best.s, 2), median: round(median, 2) };
  // residual: per sample, the strongest edge along the normal within normalReachM, RMS of those offsets
  let ss = 0;
  let n = 0;
  for (const q of samples) {
    const E = q.p[0] + best.v[0] * q.top;
    const N = q.p[1] + best.v[1] * q.top;
    let top = -1;
    let off = 0;
    for (let t = -o.normalReachM; t <= o.normalReachM + 1e-9; t += win.gsdM / 5) {
      const [x, y] = toPx(win, E + t * q.n[0], N + t * q.n[1]);
      const v = bilinear(edges, win.w, win.h, x, y);
      if (v !== null && v > top) { top = v; off = t; }
    }
    if (top >= 0) { ss += off * off; n += 1; }
  }
  return { lean: best.v, residual_m: Math.sqrt(ss / Math.max(n, 1)), method: "roof-edge", estimated: false, score: round(best.s, 2), median: round(median, 2) };
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// The data/photo/building-lean.json record of one building.
export function leanRecord(id, fit) {
  return {
    id,
    lean: fit.lean.map((v) => round(v, 4)),
    residual_m: fit.residual_m === null ? null : round(fit.residual_m, 3),
    method: fit.method,
    estimated: fit.estimated,
  };
}

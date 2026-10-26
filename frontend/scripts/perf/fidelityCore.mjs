// Q of docs/OPTIMIZATION-FORMULA.md: structural similarity (SSIM) of the overhead render against the NGII orthophoto,
// averaged over a fixed set of 100 m tiles. Pure functions; fidelity.mjs reads the tiles overhead-blend.mjs wrote.

// SSIM constants of Wang et al. 2004 for 8-bit luma (K1 0.01, K2 0.03, L 255).
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
export const SSIM_WINDOW = 8;
export const SSIM_STRIDE = 4;

// Mean SSIM of two luma images (Float32 0..255, same size) over 8 x 8 windows every 4 px (uniform weights).
export function ssim(a, b, width, height, window = SSIM_WINDOW, stride = SSIM_STRIDE) {
  if (a.length !== width * height || b.length !== width * height) throw new Error("ssim: image sizes differ");
  if (width < window || height < window) throw new Error(`ssim: image smaller than the ${window} px window`);
  const n = window * window;
  let sum = 0;
  let count = 0;
  for (let y0 = 0; y0 + window <= height; y0 += stride) {
    for (let x0 = 0; x0 + window <= width; x0 += stride) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = y0; y < y0 + window; y += 1) {
        for (let x = x0; x < x0 + window; x += 1) {
          const i = y * width + x;
          const va = a[i];
          const vb = b[i];
          sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count += 1;
    }
  }
  return sum / count;
}

// Splits a side-by-side tile (render | gap | photo, RGB or RGBA) into its two halves.
export function splitSide(pixels, width, height, channels, gap = 8) {
  const half = (width - gap) / 2;
  if (!Number.isInteger(half) || half < 1) throw new Error(`splitSide: width ${width} is not 2 x half + ${gap}`);
  const left = new Uint8Array(half * height * channels);
  const right = new Uint8Array(half * height * channels);
  for (let y = 0; y < height; y += 1) {
    const row = y * width * channels;
    left.set(pixels.subarray(row, row + half * channels), y * half * channels);
    right.set(pixels.subarray(row + (half + gap) * channels, row + width * channels), y * half * channels);
  }
  return { left, right, width: half };
}

// The Q tile set: the `count` tiles whose photo has the largest edge share (ties by name), so the choice depends on the
// photo alone and stays the same for every candidate model.
export function pickTiles(tiles, count = 12) {
  return [...tiles].sort((p, q) => q.photoEdgeShare - p.photoEdgeShare || p.name.localeCompare(q.name)).slice(0, count);
}

// Score of docs/OPTIMIZATION-FORMULA.md. `base` and `cand` hold B, D, T, L, F, Q and (from round 2) X; λ are the
// formula's (ASSUMED) weights. X (GPU texture memory, 추정) costs like B: both are the browser resources the user asked
// to minimise (download vs video memory); it is left out when either side has no X.
// `literal` is the formula as written: max(0, ...) only penalises growth, so a smaller B, D, T, X or L never raises it.
// `signed` drops the max(0, ...) clamp so a reduction earns the same weight a growth costs; the pass ranks by it.
export const LAMBDA = Object.freeze({ B: 0.15, D: 0.2, T: 0.1, X: 0.15, L: 0.25, F: 0.3 });
export function score(base, cand, { signed = false } = {}) {
  const term = (key) => {
    if (!Number.isFinite(base[key]) || !Number.isFinite(cand[key])) return 0;
    const change = (cand[key] - base[key]) / base[key];
    return signed ? change : Math.max(0, change);
  };
  return cand.Q - LAMBDA.B * term("B") - LAMBDA.D * term("D") - LAMBDA.T * term("T") - LAMBDA.X * term("X")
    - LAMBDA.L * term("L") + LAMBDA.F * Math.min(0, (cand.F - 60) / 60);
}

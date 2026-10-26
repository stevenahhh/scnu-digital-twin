// Pole-shadow detector for the NGII 2025 orthophoto (0.25 m GSD). A pole is nearly invisible from above, but it casts a
// thin dark line away from the sun; the sun-side end of that line is the pole base (its root). With the sheet's sun at
// azimuth 92.5 deg and elevation 62 deg (data/photo/pole-roots.json "sun"), a pole of height h casts a line of about
// h / tan(62 deg) = 0.53 h metres toward bearing 272.5 deg, so the root is the line's EAST end.
//
// detectPoleRoot() works on a grey window (Float32Array, row-major, row 0 = north) around a seed point and returns the
// best root inside a search radius:
//   darkness  D = local mean (box of BOX px) minus the pixel, clipped at 0: thin lines stand out, broad shade does not;
//   line      mean D along the shadow ray from the root, over the expected length (bilinear samples every 0.5 px);
//   sides     mean D along the same ray moved +-SIDE_PX across it (a pole shadow is about 1 px wide, a kerb shadow or
//             a dark area is wider);
//   sun side  mean D on a short ray from the root TOWARD the sun (the line ends at the root);
//   beyond    mean D just past 1.3 x the expected length (a kerb, rail or crossing gap runs on, a pole shadow ends);
//   stripes   brightness on BOTH sides 1.5 px out (a dark gap between crossing bars or paint lines);
//   score     line - max(sides) - sun side - beyond / 2 - stripes, over a small fan of azimuths around the expected one,
//             top `count` local maxima (detectPoleRoots).
// The root is then refined to 0.1 px: across the line by the darkness-weighted centroid of profiles along it, along the
// line by the half-darkness crossing at the sun-side end. residualPx is the RMS of the across-line centroids about the
// fitted line plus the along-line step, a 1-sigma root uncertainty in pixels.
// Everything here is a pure function of the window: the tool (fetch/poleRoots.mjs) reads the sheet; tests use
// synthetic windows (poleShadow.test.mjs).

export const SUN = Object.freeze({ azimuthDeg: 92.5, elevationDeg: 62 });
const BOX = 7;
const SIDE_PX = 2.5;
const SUN_SIDE_PX = 4;
const FAN_DEG = [-6, -3, 0, 3, 6];

// Unit vector in window pixels (col right = east, row down = south) for a compass bearing, after the grid convergence
// (grid north = true north rotated by convergenceDeg).
export function bearingToPixel(bearingDeg, convergenceDeg = 0) {
  const a = ((bearingDeg - convergenceDeg) * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

export const shadowLengthM = (heightM, elevationDeg = SUN.elevationDeg) => heightM / Math.tan((elevationDeg * Math.PI) / 180);

// Grey from interleaved RGB bytes.
export function toGrey(rgb, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) out[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  return out;
}

// D = box mean - pixel, clipped at 0 (summed-area table). sign -1 gives the brightness (pixel - box mean, clipped).
export function darkness(grey, w, h, box = BOX, sign = 1) {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += grey[y * w + x];
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  const r = box >> 1;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
      out[y * w + x] = Math.max(0, sign * (sum / ((x1 - x0) * (y1 - y0)) - grey[y * w + x]));
    }
  }
  return out;
}

function bilinear(img, w, h, x, y) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0;
  const x0 = Math.min(w - 2, Math.floor(x));
  const y0 = Math.min(h - 2, Math.floor(y));
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * w + x0;
  return (img[i] * (1 - fx) + img[i + 1] * fx) * (1 - fy) + (img[i + w] * (1 - fx) + img[i + w + 1] * fx) * fy;
}

function rayMean(img, w, h, x, y, ux, uy, from, to) {
  let sum = 0;
  let n = 0;
  for (let t = from; t <= to; t += 0.5) {
    sum += bilinear(img, w, h, x + ux * t, y + uy * t);
    n += 1;
  }
  return n ? sum / n : 0;
}

function scoreAt(D, Bt, w, h, x, y, ux, uy, lengthPx, tipPx) {
  const line = rayMean(D, w, h, x, y, ux, uy, 0.5, lengthPx);
  const beyond = rayMean(D, w, h, x, y, ux, uy, tipPx, tipPx + 4);
  const nx = -uy;
  const ny = ux;
  const sideA = rayMean(D, w, h, x + nx * SIDE_PX, y + ny * SIDE_PX, ux, uy, 0.5, lengthPx);
  const sideB = rayMean(D, w, h, x - nx * SIDE_PX, y - ny * SIDE_PX, ux, uy, 0.5, lengthPx);
  const sun = rayMean(D, w, h, x, y, -ux, -uy, 1, SUN_SIDE_PX);
  // a dark gap between two bright stripes (crossing bars, lane paint) is not a shadow
  const stripes = Math.min(rayMean(Bt, w, h, x + nx * 1.5, y + ny * 1.5, ux, uy, 0.5, lengthPx), rayMean(Bt, w, h, x - nx * 1.5, y - ny * 1.5, ux, uy, 0.5, lengthPx));
  return { score: line - Math.max(sideA, sideB) - sun - 0.5 * beyond - stripes, line, side: Math.max(sideA, sideB), sun, beyond };
}

// Pole roots near (seedX, seedY) in window pixels, best first: up to `count` local maxima of the score at least
// MIN_SEPARATION_PX apart. heightM sets the expected line length; the line is scored over 0.7 of it (the far part can
// fall on a wall or a crown) and must end before 1.3 of it (a kerb, rail or crossing gap runs on). Each result is
// { x, y, azimuthDeg, score, line, contrast, lengthPx, residualPx, offsetPx }.
const MIN_SEPARATION_PX = 4;
export function detectPoleRoots(grey, w, h, { seedX, seedY, radiusPx, heightM, gsdM = 0.25, convergenceDeg = 0, sun = SUN, D = null, count = 3 }) {
  const dark = D ?? darkness(grey, w, h);
  const bright = darkness(grey, w, h, BOX, -1);
  const expected = shadowLengthM(heightM, sun.elevationDeg) / gsdM;
  const lengthPx = Math.max(6, Math.min(16, 0.7 * expected));
  const tipPx = Math.max(lengthPx + 2, 1.3 * expected);
  const shadowBearing = sun.azimuthDeg + 180;
  const all = [];
  for (const fan of FAN_DEG) {
    const [ux, uy] = bearingToPixel(shadowBearing + fan, convergenceDeg);
    for (let dy = -radiusPx; dy <= radiusPx; dy += 0.5) {
      for (let dx = -radiusPx; dx <= radiusPx; dx += 0.5) {
        if (dx * dx + dy * dy > radiusPx * radiusPx) continue;
        const x = seedX + dx;
        const y = seedY + dy;
        const s = scoreAt(dark, bright, w, h, x, y, ux, uy, lengthPx, tipPx);
        if (s.line > 0 && s.score > 0) all.push({ ...s, x, y, ux, uy, fan });
      }
    }
  }
  all.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of all) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < MIN_SEPARATION_PX)) continue;
    picked.push(c);
  }
  return picked.map((best) => refine(dark, w, h, best, lengthPx, seedX, seedY, shadowBearing));
}

export const detectPoleRoot = (grey, w, h, options) => detectPoleRoots(grey, w, h, { ...options, count: 1 })[0] ?? null;

// Sub-pixel root: across-line centroid of D on profiles every px along the line (a straight-line fit through them gives
// the line's position and direction), then the half-darkness crossing at the sun-side end along that line.
function refine(D, w, h, best, lengthPx, seedX, seedY, shadowBearing) {
  const { ux, uy } = best;
  const nx = -uy;
  const ny = ux;
  const ts = [];
  const cs = [];
  for (let t = 1; t <= lengthPx; t += 1) {
    let sum = 0;
    let moment = 0;
    for (let s = -2; s <= 2; s += 0.25) {
      const v = bilinear(D, w, h, best.x + ux * t + nx * s, best.y + uy * t + ny * s);
      sum += v;
      moment += v * s;
    }
    if (sum > 0) {
      ts.push(t);
      cs.push(moment / sum);
    }
  }
  // least-squares c = a + b t
  let a = 0;
  let b = 0;
  if (ts.length >= 2) {
    const n = ts.length;
    const mt = ts.reduce((p, v) => p + v, 0) / n;
    const mc = cs.reduce((p, v) => p + v, 0) / n;
    let stt = 0;
    let stc = 0;
    for (let i = 0; i < n; i += 1) {
      stt += (ts[i] - mt) ** 2;
      stc += (ts[i] - mt) * (cs[i] - mc);
    }
    b = stt > 0 ? stc / stt : 0;
    a = mc - b * mt;
  }
  const rms = ts.length ? Math.sqrt(ts.reduce((p, t, i) => p + (cs[i] - (a + b * t)) ** 2, 0) / ts.length) : 1;
  // refined direction and a point on the line at t = 0
  const len = Math.hypot(1, b);
  const vx = (ux + nx * b) / len;
  const vy = (uy + ny * b) / len;
  const ox = best.x + nx * a;
  const oy = best.y + ny * a;
  // along-line: walk from 4 px on the sun side to 4 px into the line, find where D crosses half the line darkness
  const level = best.line / 2;
  let tRoot = 0;
  let prev = bilinear(D, w, h, ox - vx * 4, oy - vy * 4);
  for (let t = -3.9; t <= 4; t += 0.1) {
    const v = bilinear(D, w, h, ox + vx * t, oy + vy * t);
    if (prev < level && v >= level) {
      tRoot = t;
      break;
    }
    prev = v;
  }
  const x = ox + vx * tRoot;
  const y = oy + vy * tRoot;
  const azimuthDeg = ((Math.atan2(vx, -vy) * 180) / Math.PI + 360) % 360;
  return {
    x,
    y,
    azimuthDeg,
    shadowBearingDeg: shadowBearing,
    score: best.score,
    line: best.line,
    contrast: best.side > 0 ? best.line / best.side : Infinity,
    lengthPx,
    residualPx: Math.sqrt(rms * rms + 0.1 * 0.1),
    offsetPx: Math.hypot(x - seedX, y - seedY),
  };
}

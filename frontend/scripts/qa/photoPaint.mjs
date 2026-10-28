// Photo paint masks for the markings audit, read from the NGII 2025 orthophoto (0.25 m/px), independent of every
// detector the model build uses. A pixel is paint when it is brighter (white) or yellower (yellow) than the pavement
// around it (a BOX_M box mean) by the contrasts below, on a dark surround (pavement, not a roof or a sidewalk).
// Connected paint pixels form blobs; a blob's principal extents sort it into thin strokes (lines, stall dividers) and
// areas (islands, hatches, chevrons, triangles, arrows, text, bars).
import { openSheet } from "../campus-model/lib/ngiiSheet.mjs";
import { SCENE_UNITS_PER_METRE as U } from "../campus-model/lib/frame.mjs";
import { pixelToTm, sceneToTm, tmToPixel, tmToScene } from "../../src/geo/epsg5186.mjs";

export const BOX_M = 3.0;
export const WHITE_CONTRAST = 28;
export const YELLOW_CONTRAST = 16;
export const PAVEMENT_MAX = 125;
export const GREY_MAX = 40; // white paint is unsaturated
let sheet = null;

// paint pixels inside the model-metre box [x0, z0, x1, z1]: [{ q: [x, z] metres, colour }], plus blobs
export function paintIn([x0, z0, x1, z1]) {
  sheet ??= openSheet();
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => tmToPixel(...sceneToTm(x * U, z * U), sheet.tfw));
  const c0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]))));
  const r0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]))));
  const W = Math.min(sheet.width, Math.ceil(Math.max(...corners.map((p) => p[0])))) - c0;
  const H = Math.min(sheet.height, Math.ceil(Math.max(...corners.map((p) => p[1])))) - r0;
  if (W <= 0 || H <= 0) return { pixels: [], blobs: [] };
  const rgb = sheet.readWindow(c0, r0, W, H);
  const N = W * H;
  const L = new Float64Array(N), Y = new Float64Array(N), C = new Float64Array(N);
  for (let k = 0; k < N; k += 1) {
    const [r, g, b] = [rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]];
    L[k] = (r + g + b) / 3; Y[k] = (r + g) / 2 - b; C[k] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  // box means by integral images
  const integral = (A) => {
    const S = new Float64Array((W + 1) * (H + 1));
    for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) S[(j + 1) * (W + 1) + i + 1] = A[j * W + i] + S[j * (W + 1) + i + 1] + S[(j + 1) * (W + 1) + i] - S[j * (W + 1) + i];
    return S;
  };
  const SL = integral(L), SY = integral(Y);
  const R = Math.round(BOX_M / 0.25 / 2);
  const mean = (S, i, j) => {
    const a = Math.max(0, i - R), b = Math.max(0, j - R), c = Math.min(W, i + R + 1), d = Math.min(H, j + R + 1);
    return (S[d * (W + 1) + c] - S[b * (W + 1) + c] - S[d * (W + 1) + a] + S[b * (W + 1) + a]) / ((c - a) * (d - b));
  };
  const colour = new Int8Array(N); // 0 none, 1 white, 2 yellow
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
    const k = j * W + i;
    const mL = mean(SL, i, j);
    if (mL > PAVEMENT_MAX) continue;
    if (Y[k] - mean(SY, i, j) > YELLOW_CONTRAST && Y[k] > 25) colour[k] = 2;
    else if (L[k] - mL > WHITE_CONTRAST && C[k] < GREY_MAX) colour[k] = 1;
  }
  const at = (i, j) => tmToScene(...pixelToTm(c0 + i + 0.5, r0 + j + 0.5, sheet.tfw)).map((v) => v / U);
  const pixels = [];
  const blobOf = new Int32Array(N).fill(-1);
  const blobs = [];
  for (let k = 0; k < N; k += 1) {
    if (!colour[k] || blobOf[k] >= 0) continue;
    const id = blobs.length;
    const members = [];
    const stack = [k];
    blobOf[k] = id;
    while (stack.length) {
      const m = stack.pop();
      members.push(m);
      const i = m % W, j = (m - i) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= W || b >= H) continue;
        const n = b * W + a;
        if (colour[n] === colour[k] && blobOf[n] < 0) { blobOf[n] = id; stack.push(n); }
      }
    }
    const pts = members.map((m) => at(m % W, (m - (m % W)) / W));
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let sxx = 0, szz = 0, sxz = 0;
    for (const [x, z] of pts) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
    const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const u = [Math.cos(th), Math.sin(th)], v = [-u[1], u[0]];
    const ext = (d) => { const s = pts.map((p) => (p[0] - cx) * d[0] + (p[1] - cz) * d[1]); return Math.max(...s) - Math.min(...s) + 0.25; };
    const [a, b] = [ext(u), ext(v)];
    const blob = { id, colour: colour[k] === 2 ? "yellow" : "white", centre: [cx, cz], areaM2: pts.length * 0.0625, longM: Math.max(a, b), shortM: Math.min(a, b), axis: a >= b ? u : v, pts };
    blob.type = blob.shortM <= 0.6 && blob.longM >= 1.5 ? "stroke" : blob.areaM2 >= 0.75 ? "area" : "speck";
    blobs.push(blob);
    for (const q of pts) pixels.push({ q, colour: blob.colour, blob: id });
  }
  return { pixels, blobs };
}

// a tolerance-dilated index of model paint triangles (metres) per colour: covers(q, colour) within reach r
export function paintIndex(tris, r) {
  const cell = 1;
  const grid = new Map();
  for (const t of tris) {
    const xs = t.p.map((q) => q[0]), zs = t.p.map((q) => q[1]);
    for (let i = Math.floor((Math.min(...xs) - r) / cell); i <= Math.floor((Math.max(...xs) + r) / cell); i += 1)
      for (let j = Math.floor((Math.min(...zs) - r) / cell); j <= Math.floor((Math.max(...zs) + r) / cell); j += 1) {
        const key = `${i},${j}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(t);
      }
  }
  const segDist = (q, a, b) => {
    const ab = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] ** 2 + ab[1] ** 2 || 1e-12;
    const s = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / l2));
    return Math.hypot(q[0] - a[0] - s * ab[0], q[1] - a[1] - s * ab[1]);
  };
  const inside = (q, [a, b, c]) => {
    const s = (p1, p2) => (p2[0] - p1[0]) * (q[1] - p1[1]) - (p2[1] - p1[1]) * (q[0] - p1[0]);
    const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  return (q, colour) => (grid.get(`${Math.floor(q[0] / cell)},${Math.floor(q[1] / cell)}`) ?? [])
    .some((t) => (!colour || t.colour === colour) && (inside(q, t.p) || Math.min(segDist(q, t.p[0], t.p[1]), segDist(q, t.p[1], t.p[2]), segDist(q, t.p[2], t.p[0])) <= r));
}

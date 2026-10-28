#!/usr/bin/env bun
// Centre lines and edge lines campus-wide, read from the NGII 2025 orthophoto (sheet 34702020, 0.25 m;
// .cache/ngii-ortho), written to data/photo/road-lines.json for stages/markings.mjs (drawn as line candidates on the
// standard templates) and scripts/qa/markings-audit.mjs (photo-evidence coverage: a stretch of road whose photo shows a
// centre or edge line must have one in the model).
//
// In the sheet's own pixels over EXTENT:
//   1. paint masks. Yellow: yellowness (R + G) / 2 - B above its 9 x 9 px mean by YELLOW_CONTRAST, not darker than that
//      surround. White: brightness above its 9 x 9 mean by WHITE_CONTRAST and nearly grey. Both only where the
//      surround is pavement (mean brightness below PAVEMENT_MAX: roofs, sidewalks and kerb stones are brighter);
//   2. strokes: 8-connected components of a mask, at least STROKE_MIN_M long (principal axis) and at most
//      STROKE_MAX_W_M thick (area / length), with dark pavement SIDE_PX either side along their middle (a kerb stone has
//      a sidewalk on one side) and outside every photo stall row (data/photo/parking-lots.json: the stall lines);
//   3. lines: strokes of one colour chained end to end when their directions agree within LINK_DEG, the gap is at most
//      LINK_GAP_M (a hidden dash of the 3 m / 5 m lane pattern) and the lateral offset at most LINK_LATERAL_M. A chain
//      at least LINE_MIN_M long is a photo line; its fill (painted share of its length) says solid (FILL_SOLID or more)
//      or dashed. Two yellow chains 0.15-0.5 m apart and parallel over most of their length are one double centre line.
// Recorded per line: kind (centre_line_yellow, edge_line or lane_line_dashed), colour, pattern, double, length, fill
// and the points of its strokes (WGS84), in order.
//
//   bun scripts/campus-model/bake/road-lines.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSheet } from "../lib/ngiiSheet.mjs";
import { EXTENT, geoToModel, modelToGeo, SCENE_UNITS_PER_METRE as U } from "../lib/frame.mjs";
import { pixelToTm, sceneToTm, tmToPixel, tmToScene } from "../../../src/geo/epsg5186.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data");
const OUT = path.join(DATA, "photo", "road-lines.json");
const PX_M = 0.25;
const R = 4; // 9 x 9 px surround
const YELLOW_CONTRAST = 14;
const WHITE_CONTRAST = 24;
const PAVEMENT_MAX = 128;
const SIDE_PX = 3;
const STROKE_MIN_M = 2.0;
const STROKE_MAX_W_M = 0.55;
const LINK_DEG = 12;
const LINK_GAP_M = 6;
const LINK_LATERAL_M = 0.45;
const LINE_MIN_M = 8;
const FILL_SOLID = 0.75;

// ---------------------------------------------------------------- window over EXTENT
const sheet = openSheet();
const corners = [[EXTENT.minX, EXTENT.minZ], [EXTENT.maxX, EXTENT.minZ], [EXTENT.maxX, EXTENT.maxZ], [EXTENT.minX, EXTENT.maxZ]]
  .map(([x, z]) => tmToPixel(...sceneToTm(x, z), sheet.tfw));
const c0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]))));
const r0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]))));
const W = Math.min(sheet.width, Math.ceil(Math.max(...corners.map((p) => p[0])))) - c0;
const H = Math.min(sheet.height, Math.ceil(Math.max(...corners.map((p) => p[1])))) - r0;
const rgb = sheet.readWindow(c0, r0, W, H);
const N = W * H;
const L = new Float32Array(N), Y = new Float32Array(N), C = new Float32Array(N);
for (let k = 0; k < N; k += 1) {
  const [r, g, b] = [rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]];
  L[k] = (r + g + b) / 3; Y[k] = (r + g) / 2 - b; C[k] = Math.max(r, g, b) - Math.min(r, g, b);
}
function boxMean(a) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) I[(j + 1) * (W + 1) + i + 1] = a[j * W + i] + I[j * (W + 1) + i + 1] + I[(j + 1) * (W + 1) + i] - I[j * (W + 1) + i];
  const m = new Float32Array(N);
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
    const x0 = Math.max(0, i - R), x1 = Math.min(W, i + R + 1), y0 = Math.max(0, j - R), y1 = Math.min(H, j + R + 1);
    m[j * W + i] = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  }
  return m;
}
const mL = boxMean(L), mY = boxMean(Y);
const toScene = (i, j) => tmToScene(...pixelToTm(c0 + i, r0 + j, sheet.tfw)); // scene units
const inExtent = ([x, z]) => x > EXTENT.minX + 1 && x < EXTENT.maxX - 1 && z > EXTENT.minZ + 1 && z < EXTENT.maxZ - 1;

// stall rows of the photo (the stall front/back lines are not road lines)
const stallBoxes = JSON.parse(readFileSync(path.join(DATA, "photo", "parking-lots.json"), "utf8")).lots.flatMap((l) => l.rows).map((r) => {
  const s = geoToModel(...r.start), e = geoToModel(...r.end);
  const b = (r.depthBearing * Math.PI) / 180;
  const v = [Math.sin(b) * U, -Math.cos(b) * U];
  const d = 5.6;
  const ext = 0.6 * U;
  const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
  const u = [(e[0] - s[0]) / len, (e[1] - s[1]) / len];
  return [[s[0] - u[0] * ext - v[0] * 0.6, s[1] - u[1] * ext - v[1] * 0.6], [e[0] + u[0] * ext - v[0] * 0.6, e[1] + u[1] * ext - v[1] * 0.6], [e[0] + u[0] * ext + v[0] * d, e[1] + u[1] * ext + v[1] * d], [s[0] - u[0] * ext + v[0] * d, s[1] - u[1] * ext + v[1] * d]];
});
function inRing([x, z], ring) {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) r = !r;
  }
  return r;
}

// ---------------------------------------------------------------- masks and strokes
function strokes(colour) {
  const mask = new Uint8Array(N);
  for (let k = 0; k < N; k += 1) {
    if (mL[k] > PAVEMENT_MAX) continue;
    if (colour === "yellow") mask[k] = Y[k] - mY[k] > YELLOW_CONTRAST && L[k] >= mL[k] - 4 ? 1 : 0;
    else mask[k] = L[k] - mL[k] > WHITE_CONTRAST && C[k] < 45 ? 1 : 0;
  }
  const seen = new Uint8Array(N);
  const out = [];
  for (let k0 = 0; k0 < N; k0 += 1) {
    if (!mask[k0] || seen[k0]) continue;
    const stack = [k0];
    seen[k0] = 1;
    const px = [];
    while (stack.length) {
      const k = stack.pop();
      px.push(k);
      const i = k % W, j = (k / W) | 0;
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const kk = jj * W + ii;
        if (mask[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
      }
    }
    if (px.length < STROKE_MIN_M / PX_M) continue;
    // principal axis in pixels
    let sx = 0, sy = 0;
    for (const k of px) { sx += k % W; sy += (k / W) | 0; }
    const cx = sx / px.length, cy = sy / px.length;
    let xx = 0, xy = 0, yy = 0;
    for (const k of px) { const dx = (k % W) - cx, dy = ((k / W) | 0) - cy; xx += dx * dx; xy += dx * dy; yy += dy * dy; }
    const a = 0.5 * Math.atan2(2 * xy, xx - yy);
    const d = [Math.cos(a), Math.sin(a)];
    const t = px.map((k) => ((k % W) - cx) * d[0] + (((k / W) | 0) - cy) * d[1]);
    const len = (Math.max(...t) - Math.min(...t) + 1) * PX_M;
    const thick = (px.length * PX_M * PX_M) / len;
    if (len < STROKE_MIN_M || thick > STROKE_MAX_W_M) continue;
    // pavement either side along the middle half
    const n = [-d[1], d[0]];
    let dark = 0, tot = 0;
    for (let s = -len / PX_M / 4; s <= len / PX_M / 4; s += 1) {
      for (const side of [1, -1]) {
        const ii = Math.round(cx + d[0] * s + n[0] * side * SIDE_PX), jj = Math.round(cy + d[1] * s + n[1] * side * SIDE_PX);
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        tot += 1;
        if (L[jj * W + ii] < PAVEMENT_MAX - 8) dark += 1;
      }
    }
    if (!tot || dark / tot < 0.85) continue;
    const tMin = Math.min(...t), tMax = Math.max(...t);
    const A = toScene(cx + d[0] * tMin, cy + d[1] * tMin), B = toScene(cx + d[0] * tMax, cy + d[1] * tMax);
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    if (!inExtent(mid) || stallBoxes.some((ring) => inRing(mid, ring))) continue;
    out.push({ a: A.map((v) => v / U), b: B.map((v) => v / U), len, colour });
  }
  return out;
}

// ---------------------------------------------------------------- chains
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const norm = (p) => Math.hypot(p[0], p[1]);
function chains(list) {
  const dirOf = (s) => { const v = sub(s.b, s.a); const l = norm(v); return [v[0] / l, v[1] / l]; };
  list.forEach((s) => { s.d = dirOf(s); });
  const cos = Math.cos((LINK_DEG * Math.PI) / 180);
  const parent = list.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const cell = 8;
  const grid = new Map();
  list.forEach((s, i) => {
    for (const p of [s.a, s.b]) {
      const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  });
  list.forEach((s, i) => {
    for (const p of [s.a, s.b]) {
      for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
        for (const j of grid.get(`${Math.floor(p[0] / cell) + dx},${Math.floor(p[1] / cell) + dz}`) ?? []) {
          if (j <= i) continue;
          const o = list[j];
          if (Math.abs(dot(s.d, o.d)) < cos) continue;
          // end-to-end gap along the line and lateral offset of o's ends from s's line
          const ends = [[s.a, o.a], [s.a, o.b], [s.b, o.a], [s.b, o.b]];
          const gap = Math.min(...ends.map(([p1, p2]) => norm(sub(p1, p2))));
          const lat = Math.max(...[o.a, o.b].map((q) => Math.abs(dot(sub(q, s.a), [-s.d[1], s.d[0]]))));
          const overlapAlong = Math.min(...[o.a, o.b].map((q) => dot(sub(q, s.a), s.d))) < norm(sub(s.b, s.a)) && Math.max(...[o.a, o.b].map((q) => dot(sub(q, s.a), s.d))) > 0;
          if (gap <= LINK_GAP_M && lat <= LINK_LATERAL_M && !overlapAlong) parent[root(i)] = root(j);
        }
      }
    }
  });
  const groups = new Map();
  list.forEach((s, i) => { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
  const out = [];
  for (const g of groups.values()) {
    // order along the group's mean direction
    let d = g[0].d;
    const md = g.reduce((acc, s) => { const sg = dot(s.d, d) >= 0 ? 1 : -1; return [acc[0] + s.d[0] * s.len * sg, acc[1] + s.d[1] * s.len * sg]; }, [0, 0]);
    d = [md[0] / norm(md), md[1] / norm(md)];
    const o = g[0].a;
    const pts = g.flatMap((s) => [s.a, s.b]).map((p) => ({ p, t: dot(sub(p, o), d) })).sort((x, y) => x.t - y.t);
    const span = pts.at(-1).t - pts[0].t;
    if (span < LINE_MIN_M) continue;
    const painted = g.reduce((a, s) => a + s.len, 0);
    out.push({ strokes: g.length, span, fill: Math.min(1, painted / span), pts: pts.map((x) => x.p), d, colour: g[0].colour });
  }
  return out;
}

// ---------------------------------------------------------------- doubles and output
const toGeo = ([x, z]) => modelToGeo(x * U, z * U).map((v) => +v.toFixed(8));
const yellow = chains(strokes("yellow"));
const white = chains(strokes("white"));
// two yellow chains 0.15-0.5 m apart and parallel: one double line (its centreline)
const used = new Set();
const lines = [];
for (let i = 0; i < yellow.length; i += 1) {
  if (used.has(i)) continue;
  const a = yellow[i];
  let pair = -1;
  for (let j = i + 1; j < yellow.length; j += 1) {
    if (used.has(j)) continue;
    const b = yellow[j];
    if (Math.abs(dot(a.d, b.d)) < 0.97) continue;
    const n = [-a.d[1], a.d[0]];
    const offs = b.pts.map((q) => dot(sub(q, a.pts[0]), n));
    const along = b.pts.map((q) => dot(sub(q, a.pts[0]), a.d));
    const off = offs.reduce((x, y) => x + y, 0) / offs.length;
    const overlap = Math.min(Math.max(...along), a.span) - Math.max(Math.min(...along), 0);
    if (Math.abs(off) >= 0.15 && Math.abs(off) <= 0.5 && overlap >= 0.5 * Math.min(a.span, b.span)) { pair = j; break; }
  }
  if (pair >= 0) {
    used.add(pair);
    const b = yellow[pair];
    const n = [-a.d[1], a.d[0]];
    const off = b.pts.reduce((s, q) => s + dot(sub(q, a.pts[0]), n), 0) / b.pts.length;
    a.pts = a.pts.map((p) => [p[0] + (n[0] * off) / 2, p[1] + (n[1] * off) / 2]);
    a.double = true;
    a.fill = Math.max(a.fill, b.fill);
  }
  lines.push(a);
}
lines.push(...white);
let k = 0;
const records = lines.map((l) => {
  const pattern = l.fill >= FILL_SOLID ? "solid" : "dashed";
  const kind = l.colour === "yellow" ? "centre_line_yellow" : pattern === "solid" ? "edge_line" : "lane_line_dashed";
  return { id: `RL${String(++k).padStart(4, "0")}`, kind, colour: l.colour, pattern, double: Boolean(l.double), lengthM: +l.span.toFixed(1), fill: +l.fill.toFixed(2), strokes: l.strokes, points: l.pts.map(toGeo) };
});
writeFileSync(OUT, `${JSON.stringify({
  source: "NGII 2025 orthophoto sheet 34702020 (0.25 m), read by bake/road-lines.mjs over EXTENT",
  method: "yellow and white paint masks on pavement (9 x 9 px top-hat), thin strokes at least 2 m long with pavement on both sides and outside the photo stall rows, chained end to end (12 deg, 6 m gap, 0.45 m lateral) into lines at least 8 m long; double yellow pairs 0.15-0.5 m apart merged",
  lines: records,
}, null, 1)}\n`);
const sum = (f) => records.filter(f).reduce((a, l) => a + l.lengthM, 0).toFixed(0);
console.log(`${records.length} photo lines: ${records.filter((l) => l.kind === "centre_line_yellow").length} centre (${records.filter((l) => l.double).length} double, ${sum((l) => l.colour === "yellow")} m), ${records.filter((l) => l.kind === "edge_line").length} white solid, ${records.filter((l) => l.kind === "lane_line_dashed").length} white dashed (${sum((l) => l.colour === "white")} m) -> ${path.relative(process.cwd(), OUT)}`);

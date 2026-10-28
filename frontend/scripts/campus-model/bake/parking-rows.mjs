#!/usr/bin/env bun
// Parking lots and their stall rows, read from the NGII 2025 orthophoto (sheet 34702020, 0.25 m; .cache/ngii-ortho),
// written to data/photo/parking-lots.json for stages/markingsStandard.mjs (the stall templates) and
// scripts/qa/markings-audit.mjs (the photo stall count per lot).
//
// Sites: every traced stall piece of data/photo/markings*.geojson (parking_line, disabled_parking; any gate verdict)
// and every OSM parking polygon of data/osm-ground.json, clustered within SITE_LINK_M; a site's search area is its
// oriented box grown by SITE_MARGIN_M. data/photo/parking-review.json adds search areas the traces miss and rejects
// rows by eye (each with its reason).
// Per site, on the photo:
//   1. paint: pixels brighter than their 2.1 m surround by PAINT_CONTRAST and nearly grey (white paint), 0.1 m grid;
//   2. dividers: for every direction (1 deg steps) the paint is smoothed 1.2 m along the direction and compared with
//      its sides 0.5 m away: thin lines along it at least 2 m long are divider candidates; the direction with the most
//      divider length, and every other local maximum with at least 40 % of it, are the site's row directions;
//   3. rows: dividers of one direction whose extents along it overlap (the same band) and whose spacing is a stall
//      pitch (2.2-3.6 m, a hidden divider counted as two pitches) form a row; at least ROW_MIN_DIVIDERS;
//   4. depth: the row's front and back lines are the paint peaks across the row (sampled between dividers) 4.5-5.5 m
//      apart that cover the dividers; without both, the row is centred on its dividers;
//   5. accessible bays: a bay whose interior is mostly blue paint (blue over its surround).
// The photo stall count of a row is its bays between its first and last divider; the stage draws exactly those bays at
// the statute widths (2.5 m, 3.3 m accessible), centred on the photo row. Recorded per row: the fitted direction, the
// photo pitch, the RMS of the photo dividers from their fitted grid, and the residual of the drawn dividers from the
// photo ones (the photo pitch differs from the statute 2.5 m by a few centimetres per bay).
//
//   bun scripts/campus-model/bake/parking-rows.mjs [--site <id>]
import { readMarkings } from "../../qa/markings-audit.mjs";
import { paintIn } from "../../qa/photoPaint.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSheet } from "../lib/ngiiSheet.mjs";
import { geoToModel, modelToGeo, SCENE_UNITS_PER_METRE as U } from "../lib/frame.mjs";
import { sceneToTm, tmToPixel } from "../../../src/geo/epsg5186.mjs";
import { rowGeometry } from "../lib/parkingRows.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data");
const OUT = path.join(DATA, "photo", "parking-lots.json");
// --site <id> prints one site's rows and writes nothing
const REVIEW = path.join(DATA, "photo", "parking-review.json");
const STEP = 0.1;
const PAINT_CONTRAST = 12;
const SITE_LINK_M = 8;
const SITE_MARGIN_M = 5;
const ROW_MIN_DIVIDERS = 3;
const PITCH_M = [2.2, 3.6];
const DEPTH_M = [4.5, 5.5];
const PARTIAL_MIN_DIVIDERS = 5;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (a) => Math.hypot(a[0], a[1]);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const toMetres = ([lon, lat]) => geoToModel(lon, lat).map((v) => v / U);
// 경사주차 rows (review.angledAreas, each an area drawn by eye around a row of angled stalls and a point in its aisle):
// the white paint in the area (qa/photoPaint.mjs, relaxed for the light lot surface) gives the two line directions
// (the two sharpest local maxima of the projection histograms, 25 deg or more apart): the one along the area's long side is the aisle, the other
// the dividers, and their angle is the photo angle; the divider peaks along the aisle give the bays and the pitch
// square to the dividers; the front line is the paint's extreme on the aisle side.
function angledRow(area) {
  const ring = area.ring.map(toMetres);
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  const inside = ([x, z]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const px = paintIn([Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], { whiteContrast: 14, pavementMax: 175 }).blobs
    .filter((b) => b.colour === "white" && b.type !== "car" && b.type !== "speck").flatMap((b) => b.pts).filter(inside);
  if (px.length < 50) return null;
  const sharp = (deg) => { const a = (deg * Math.PI) / 180, n = [-Math.sin(a), Math.cos(a)]; const h = new Map(); for (const q of px) { const k = Math.round((q[0] * n[0] + q[1] * n[1]) / 0.25); h.set(k, (h.get(k) ?? 0) + 1); } let s = 0; for (const v of h.values()) s += v * v; return s; };
  const all = Array.from({ length: 180 }, (_, d) => ({ d, s: sharp(d) }));
  // local maxima only (a direction sharper than every direction within 4 deg), so a shoulder of one line is not a second
  const scores = all.filter((x) => [1, 2, 3, 4].every((k) => x.s >= all[(x.d + k) % 180].s && x.s >= all[(x.d - k + 180) % 180].s)).sort((a, b) => b.s - a.s);
  const first = scores[0];
  const second = scores.find((x) => Math.min(Math.abs(x.d - first.d), 180 - Math.abs(x.d - first.d)) >= 25);
  if (!second) return null;
  const dirOf = (d) => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)];
  // the aisle runs along the area's long side
  const c = [px.reduce((s, q) => s + q[0], 0) / px.length, px.reduce((s, q) => s + q[1], 0) / px.length];
  const spread = (d) => { const u = dirOf(d); const s = px.map((q) => (q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1]); return Math.max(...s) - Math.min(...s); };
  const [ua, ud] = spread(first.d) >= spread(second.d) ? [dirOf(first.d), dirOf(second.d)] : [dirOf(second.d), dirOf(first.d)];
  const angle = (Math.acos(Math.min(1, Math.abs(ua[0] * ud[0] + ua[1] * ud[1]))) * 180) / Math.PI;
  // dividers: peaks of the paint across the divider direction
  const nd = [-ud[1], ud[0]];
  const h = new Map();
  for (const q of px) { const k = Math.round((q[0] * nd[0] + q[1] * nd[1]) / 0.1); h.set(k, (h.get(k) ?? 0) + 1); }
  const keys = [...h.keys()].sort((a, b) => a - b);
  const mx = Math.max(...h.values());
  const peaks = [];
  for (const k of keys) { const v = h.get(k); if (v >= 0.35 * mx && v >= (h.get(k - 1) ?? 0) && v >= (h.get(k + 1) ?? 0) && v >= (h.get(k - 2) ?? 0) && v >= (h.get(k + 2) ?? 0)) { if (!peaks.length || k * 0.1 - peaks.at(-1) > 1.5) peaks.push(k * 0.1); } }
  if (peaks.length < 2) return null;
  const gaps = peaks.slice(1).map((p, i) => p - peaks[i]).sort((a, b) => a - b);
  const pitch = gaps[gaps.length >> 1];
  // the front line: the paint's extreme toward the aisle point, along the aisle normal
  const na0 = [-ua[1], ua[0]];
  const aisle = toMetres(area.aisle);
  const na = (aisle[0] - c[0]) * na0[0] + (aisle[1] - c[1]) * na0[1] > 0 ? na0 : [-na0[0], -na0[1]];
  const across = px.map((q) => (q[0] - c[0]) * na[0] + (q[1] - c[1]) * na[1]).sort((a, b) => a - b);
  // the front line: the strongest paint line along the aisle on the aisle side of the area's centre (0.1 m bins,
  // smoothed over 0.3 m)
  const hb = new Map();
  for (const t of across) { const k = Math.round(t / 0.1); hb.set(k, (hb.get(k) ?? 0) + 1); }
  let front = null, bestV = -1;
  for (const k of hb.keys()) { if (k <= 0) continue; const v = (hb.get(k - 1) ?? 0) + hb.get(k) + (hb.get(k + 1) ?? 0); if (v > bestV) { bestV = v; front = k * 0.1; } }
  if (front === null) return null;
  // each divider's front end: where its line (offset p along nd) meets the front line
  const vd = (ud[0] * -na[0] + ud[1] * -na[1]) >= 0 ? ud : [-ud[0], -ud[1]]; // from the front into the stall
  const ends = peaks.map((p) => {
    // point on the divider line: x = nd * p + t * vd; on the front line: (x - c) . na = front
    const base = [nd[0] * p, nd[1] * p];
    const t = (front - ((base[0] - c[0]) * na[0] + (base[1] - c[1]) * na[1])) / (vd[0] * na[0] + vd[1] * na[1]);
    return [base[0] + vd[0] * t, base[1] + vd[1] * t];
  });
  const uAlong = (ends.at(-1)[0] - ends[0][0]) * ua[0] + (ends.at(-1)[1] - ends[0][1]) * ua[1] >= 0 ? ua : [-ua[0], -ua[1]];
  // a fit outside the statute angles (45 / 60 deg, +-10) or with a pitch under 2.2 m read the wrong lines: not drawn
  if (angle < 35 || angle > 70 || pitch < 2.2) return { rejected: `fit ${angle.toFixed(0)} deg, pitch ${pitch.toFixed(2)} m` };
  if (process.env.ANGLED_DEBUG) console.log(JSON.stringify({ id: area.id, c, aisle, na, vd, ua, ud, front, peaks, ends, px: px.length }));
  const bearing = (d) => +(((Math.atan2(d[0], -d[1]) * 180) / Math.PI + 360) % 360).toFixed(2);
  return {
    site: `angled ${area.id}`, u: uAlong, centre: c, dividers: peaks.length, sources: [`review ${area.id}`], start: ends[0], end: ends.at(-1), v: vd,
    bays: peaks.length - 1, pitch, accessiblePitch: 3.3, depthPhoto: 5.0, lines: true, partial: false, accessible: [], rms: 0,
    photoDividers: ends, aisle: { photoAngleDeg: +angle.toFixed(1), aisleBearing: bearing(uAlong) }, angledArea: ring,
  };
}
const toGeo = ([x, z]) => modelToGeo(x * U, z * U).map((v) => +v.toFixed(8));

function pointInRing([x, z], ring) {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) r = !r;
  }
  return r;
}
// Minimum-area oriented box of points (metres): centre, unit axes, half sizes.
function orientedBox(points) {
  let best = null;
  for (let a = 0; a < 180; a += 1) {
    const u = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
    const v = [-u[1], u[0]];
    const s = points.map((p) => dot(p, u)), t = points.map((p) => dot(p, v));
    const [s0, s1, t0, t1] = [Math.min(...s), Math.max(...s), Math.min(...t), Math.max(...t)];
    if (!best || (s1 - s0) * (t1 - t0) < best.area) best = { area: (s1 - s0) * (t1 - t0), u, v, s0, s1, t0, t1 };
  }
  return best;
}

// ---------------------------------------------------------------- photo sampling
const sheet = openSheet();
const rgb = [0, 0, 0];
function photo(x, z) {
  const [c, r] = tmToPixel(...sceneToTm(x * U, z * U), sheet.tfw);
  const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0;
  const acc = [0, 0, 0];
  for (const [dc, dr, w] of [[0, 0, (1 - fc) * (1 - fr)], [1, 0, fc * (1 - fr)], [0, 1, (1 - fc) * fr], [1, 1, fc * fr]]) {
    sheet.sample(c0 + dc, r0 + dr, rgb);
    acc[0] += rgb[0] * w; acc[1] += rgb[1] * w; acc[2] += rgb[2] * w;
  }
  return acc;
}

// Paint (white) and blue masks over a ring (metres) on a STEP grid.
function paintField(ring) {
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  const [x0, z0] = [Math.min(...xs), Math.min(...zs)];
  const W = Math.ceil((Math.max(...xs) - x0) / STEP), H = Math.ceil((Math.max(...zs) - z0) / STEP);
  const L = new Float32Array(W * H), C = new Float32Array(W * H), B = new Float32Array(W * H), inside = new Uint8Array(W * H);
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
    const x = x0 + (i + 0.5) * STEP, z = z0 + (j + 0.5) * STEP, k = j * W + i;
    inside[k] = pointInRing([x, z], ring) ? 1 : 0;
    const [r, g, b] = photo(x, z);
    L[k] = (r + g + b) / 3; C[k] = Math.max(r, g, b) - Math.min(r, g, b); B[k] = b - (r + g) / 2;
  }
  const I = new Float64Array((W + 1) * (H + 1));
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) I[(j + 1) * (W + 1) + i + 1] = L[j * W + i] + I[j * (W + 1) + i + 1] + I[(j + 1) * (W + 1) + i] - I[j * (W + 1) + i];
  const R = 10;
  const paint = new Float32Array(W * H), blue = new Uint8Array(W * H);
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
    const a = Math.max(0, i - R), b = Math.min(W, i + R + 1), c = Math.max(0, j - R), d = Math.min(H, j + R + 1);
    const mean = (I[d * (W + 1) + b] - I[c * (W + 1) + b] - I[d * (W + 1) + a] + I[c * (W + 1) + a]) / ((b - a) * (d - c));
    const k = j * W + i;
    const t = L[k] - mean;
    const need = Math.max(8, Math.min(PAINT_CONTRAST, 0.2 * mean));
    // white paint is nearly grey; in a cast shadow it takes the sky's blue, so the grey test is looser there
    const grey = mean < 100 ? 75 : 55;
    paint[k] = inside[k] && C[k] < grey && t > need ? Math.min(1, (t - need) / 20) : 0;
    blue[k] = inside[k] && B[k] > 40 && L[k] > 95 ? 1 : 0;
  }
  const idx = (x, z) => {
    const i = Math.floor((x - x0) / STEP), j = Math.floor((z - z0) / STEP);
    return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i;
  };
  return {
    at: (x, z) => { const k = idx(x, z); return k < 0 ? 0 : paint[k]; },
    blueAt: (x, z) => { const k = idx(x, z); return k < 0 ? 0 : blue[k]; },
    isIn: (x, z) => { const k = idx(x, z); return k >= 0 && inside[k] === 1; },
    centre: [x0 + (W * STEP) / 2, z0 + (H * STEP) / 2], half: Math.hypot(W, H) * STEP / 2,
  };
}

// Divider segments along direction deg: [{ u, v0, v1 }] in the frame (u across, v along the dividers) around f.centre.
function dividers(f, deg) {
  const a = (deg * Math.PI) / 180;
  const v = [Math.cos(a), Math.sin(a)];
  const u = [-v[1], v[0]];
  const n = Math.ceil((2 * f.half) / STEP);
  const g = new Float32Array(n * n), ins = new Uint8Array(n * n);
  for (let jv = 0; jv < n; jv += 1) for (let iu = 0; iu < n; iu += 1) {
    const s = -f.half + (iu + 0.5) * STEP, t = -f.half + (jv + 0.5) * STEP;
    const x = f.centre[0] + u[0] * s + v[0] * t, z = f.centre[1] + u[1] * s + v[1] * t;
    g[jv * n + iu] = f.at(x, z); ins[jv * n + iu] = f.isIn(x, z) ? 1 : 0;
  }
  const win = 6;
  const V = new Float32Array(n * n);
  for (let i = 0; i < n; i += 1) {
    let acc = 0;
    for (let j = 0; j < n; j += 1) {
      acc += g[j * n + i];
      if (j - 2 * win - 1 >= 0) acc -= g[(j - 2 * win - 1) * n + i];
      if (j - win >= 0) V[(j - win) * n + i] = acc / (2 * win + 1);
    }
  }
  const side = 5;
  const D = new Uint8Array(n * n);
  for (let j = 0; j < n; j += 1) for (let i = side; i < n - side; i += 1) {
    const k = j * n + i;
    const c = Math.max(V[k], V[k - 1], V[k + 1]);
    D[k] = c - (V[k - side] + V[k + side]) / 2 > 0.22 && ins[k] ? 1 : 0;
  }
  const seen = new Uint8Array(n * n);
  const segs = [];
  for (let k0 = 0; k0 < n * n; k0 += 1) {
    if (!D[k0] || seen[k0]) continue;
    const stack = [k0];
    seen[k0] = 1;
    let su = 0, cnt = 0, vmin = Infinity, vmax = -Infinity, umin = Infinity, umax = -Infinity;
    while (stack.length) {
      const k = stack.pop();
      const i = k % n, j = (k / n) | 0;
      su += i; cnt += 1; vmin = Math.min(vmin, j); vmax = Math.max(vmax, j); umin = Math.min(umin, i); umax = Math.max(umax, i);
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const kk = jj * n + ii;
        if (D[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
      }
    }
    const len = (vmax - vmin + 1) * STEP;
    if (len < 2 || (umax - umin) * STEP > 0.9) continue;
    segs.push({ u: -f.half + (su / cnt + 0.5) * STEP, v0: -f.half + vmin * STEP, v1: -f.half + (vmax + 1) * STEP });
  }
  return { u, v, segs };
}

// Rows of one direction: bands of overlapping divider extents, runs of stall-pitch spacing inside each band.
function rowsOf(f, frame) {
  let segs = frame.segs.flatMap((s) => (s.v1 - s.v0 > 7.5 ? [{ ...s, v1: (s.v0 + s.v1) / 2 }, { ...s, v0: (s.v0 + s.v1) / 2 }] : [s]));
  segs = segs.sort((a, b) => (a.v0 + a.v1) / 2 - (b.v0 + b.v1) / 2);
  const bands = [];
  for (const s of segs) {
    const band = bands.find((b) => {
      const ov = Math.min(b.v1, s.v1) - Math.max(b.v0, s.v0);
      return ov >= 0.5 * Math.min(b.v1 - b.v0, s.v1 - s.v0);
    });
    if (band) { band.segs.push(s); band.v0 = median(band.segs.map((x) => x.v0)); band.v1 = median(band.segs.map((x) => x.v1)); }
    else bands.push({ segs: [s], v0: s.v0, v1: s.v1 });
  }
  const rows = [];
  for (const band of bands) {
    const list = band.segs.sort((a, b) => a.u - b.u);
    // drop near-duplicates (one line read twice)
    const us = [];
    for (const s of list) if (!us.length || s.u - us.at(-1).u > 1.2) us.push(s);
    let run = [us[0]];
    const flush = () => { if (run.length >= ROW_MIN_DIVIDERS) rows.push(...[fitRow(f, frame, run)].flat()); };
    for (let i = 1; i < us.length; i += 1) {
      // a run continues over up to five hidden dividers (parked cars); the gap fit decides how many bays it holds
      if (us[i].u - us[i - 1].u > 5 * PITCH_M[1]) { flush(); run = [us[i]]; } else run.push(us[i]);
    }
    if (run.length) flush();
  }
  return rows.filter(Boolean);
}

const why = {};
const reject = (r) => { why[r] = (why[r] ?? 0) + 1; return null; };
function fitRow(f, frame, all) {
  // one divider per line: of two closer than 1.6 m the longer stays
  const m = [];
  for (const s of [...all].sort((a, b) => a.u - b.u)) {
    const last = m.at(-1);
    if (last && s.u - last.u < 1.6) { if (s.v1 - s.v0 > last.v1 - last.v0) m[m.length - 1] = s; } else m.push(s);
  }
  const us = m.map((s) => s.u);
  const gaps = us.slice(1).map((x, i) => x - us[i]);
  const normal = gaps.filter((g) => g >= 2.3 && g <= 2.8);
  if (normal.length < 1) return reject("gaps");
  const p = median(normal);
  const wide = gaps.filter((g) => g >= 3.1 && g <= 3.75);
  const pa = wide.length ? median(wide) : 3.4;
  // each gap as a normal and b accessible bays (a hidden divider makes a gap of several bays); accessible bays only
  // where the photo shows the blue of a 장애인전용 bay in that gap
  const P0 = (s_, t) => [f.centre[0] + frame.u[0] * s_ + frame.v[0] * t, f.centre[1] + frame.u[1] * s_ + frame.v[1] * t];
  const sv0 = median(m.map((x) => x.v0)), sv1 = median(m.map((x) => x.v1));
  const blueIn = (a, b) => {
    let blue = 0, n = 0;
    for (let x = 0.15; x <= 0.85; x += 0.1) for (let y = 0.2; y <= 0.8; y += 0.1) { const q = P0(a + (b - a) * x, sv0 + (sv1 - sv0) * y); blue += f.blueAt(q[0], q[1]); n += 1; }
    return blue / n;
  };
  const bays = [];
  const res = [];
  for (let gi = 0; gi < gaps.length; gi += 1) {
    const g = gaps[gi];
    let best = null;
    const blueGap = blueIn(us[gi], us[gi + 1]) > 0.15;
    for (let a = 0; a <= 5; a += 1) for (let b = 0; b <= (blueGap ? 2 : 0); b += 1) {
      if (!a && !b) continue;
      const e = Math.abs(g - a * p - b * pa);
      if (!best || e < best.e) best = { a, b, e };
    }
    // a gap of several bays (hidden dividers) must show the row's front or back line across it; else it is an aisle
    // or a walkway between two rows, not stalls
    if (best && best.a + best.b > 1) {
      const lineIn = (t) => {
        let acc = 0, n = 0;
        for (let x = us[gi] + 0.3; x < us[gi + 1] - 0.3; x += 0.2) { const q = P0(x, t); acc += f.at(q[0], q[1]) > 0 ? 1 : 0; n += 1; }
        return n ? acc / n : 0;
      };
      if (Math.max(lineIn(sv0), lineIn(sv1), lineIn(sv0 + 0.1), lineIn(sv1 - 0.1), lineIn(sv0 - 0.1), lineIn(sv1 + 0.1)) < 0.5) best.e = Infinity;
    }
    if (best.e > 0.3) {
      // not a stall spacing: split the run there
      reject("gap split");
      const left = m.slice(0, gi + 1), right = m.slice(gi + 1);
      return [left, right].filter((x) => x.length >= ROW_MIN_DIVIDERS).flatMap((x) => [fitRow(f, frame, x)].flat()).filter(Boolean);
    }
    for (let k = 0; k < best.b; k += 1) bays.push("accessible");
    for (let k = 0; k < best.a; k += 1) bays.push("normal");
    res.push(best.e / (best.a + best.b));
  }
  const rms = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length);
  if (rms > 0.12) return reject(`rms ${rms.toFixed(2)}`);
  const u0 = us[0];
  const uEnd = us.at(-1);
  const kmin = 0;
  const kmax = bays.length;
  let v0 = median(m.map((s) => s.v0)), v1 = median(m.map((s) => s.v1));
  const P = (s, t) => [f.centre[0] + frame.u[0] * s + frame.v[0] * t, f.centre[1] + frame.u[1] * s + frame.v[1] * t];
  // front and back lines
  const prof = [];
  for (let t = v0 - 4; t <= v1 + 4; t += 0.1) {
    let acc = 0, n = 0;
    for (let k = 0; k < gaps.length; k += 1) for (const q of [0.3, 0.5, 0.7]) { const xy = P(us[k] + gaps[k] * q, t); acc += f.at(xy[0], xy[1]); n += 1; }
    prof.push({ t, m: acc / Math.max(1, n) });
  }
  const peaks = prof.filter((x, i) => x.m > 0.25 && x.m >= (prof[i - 1]?.m ?? 0) && x.m >= (prof[i + 1]?.m ?? 0));
  let best = null;
  for (const a of peaks) for (const b of peaks) {
    const d = b.t - a.t;
    if (d < DEPTH_M[0] || d > DEPTH_M[1]) continue;
    const covers = Math.min(b.t, v1) - Math.max(a.t, v0);
    if (covers < 0.6 * (v1 - v0)) continue;
    const score = a.m + b.m + covers;
    if (!best || score > best.score) best = { a: a.t, b: b.t, score };
  }
  const lines = Boolean(best);
  if (best) { v0 = best.a; v1 = best.b; }
  let partial = false;
  if (!lines && v1 - v0 < 3) {
    // dividers seen over part of their length only (the rest under an overhang or a canopy): with at least
    // PARTIAL_MIN_DIVIDERS of them, the row's one visible long line (a paint peak at either end of the dividers) is its
    // aisle end and the stalls run the statute depth from it into the hidden part
    const at = (t) => prof.reduce((b, x) => (Math.abs(x.t - t) <= 0.4 && x.m > (b?.m ?? 0.25) ? x : b), null);
    const [p0, p1] = [at(v0), at(v1)];
    if (m.length < PARTIAL_MIN_DIVIDERS || (!p0 && !p1)) return reject("depth");
    if (p1 && (!p0 || p1.m >= p0.m)) { v1 = p1.t; v0 = v1 - 5.0; } else { v0 = p0.t; v1 = v0 + 5.0; }
    partial = true;
  }
  // accessible bays: blue over most of the bay interior
  // bay positions along the row (photo widths), and blue over most of a bay: accessible
  const starts = [];
  let at = u0;
  for (const b of bays) { starts.push(at); at += b === "accessible" ? pa : p; }
  const accessible = [];
  bays.forEach((b, k) => {
    const w = b === "accessible" ? pa : p;
    let blue = 0, n = 0;
    for (let a = 0.2; a <= 0.8; a += 0.1) for (let c = 0.2; c <= 0.8; c += 0.1) { const xy = P(starts[k] + w * a, v0 + (v1 - v0) * c); blue += f.blueAt(xy[0], xy[1]); n += 1; }
    // accessible: a wide bay (gap fit) or a bay mostly painted the 장애인전용 blue
    if (b === "accessible" || blue / n > 0.3) accessible.push(k);
  });
  return {
    centre: f.centre, u: frame.u, v: frame.v, start: P(u0, v0), end: P(uEnd, v0), depthPhoto: v1 - v0, lines, partial,
    pitch: p, accessiblePitch: pa, bays: kmax - kmin, dividers: m.length, rms, accessible, photoDividers: us.map((x) => P(x, v0)),
  };
}

// ---------------------------------------------------------------- sites
function sites(review) {
  const pts = [];
  for (const fn of ["markings.geojson", "markings-extra.geojson"]) {
    for (const ft of JSON.parse(readFileSync(path.join(DATA, "photo", fn), "utf8")).features) {
      if (!["parking_line", "disabled_parking"].includes(ft.properties.kind)) continue;
      const c = ft.geometry.type === "Polygon" ? ft.geometry.coordinates[0] : ft.geometry.coordinates;
      for (const q of c) pts.push({ p: toMetres(q), src: ft.properties.id });
    }
  }
  const ground = JSON.parse(readFileSync(path.join(DATA, "osm-ground.json"), "utf8"));
  for (const ft of ground.osm.features.filter((x) => x.kind === "parking")) for (const q of ft.rings[0]) pts.push({ p: toMetres(q), src: ft.id });
  for (const area of (review.addAreas ?? []).filter((a) => !a.alone)) for (const q of area.ring) pts.push({ p: toMetres(q), src: area.id });
  const parent = pts.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const cell = new Map();
  pts.forEach((q, i) => {
    const key = `${Math.floor(q.p[0] / SITE_LINK_M)},${Math.floor(q.p[1] / SITE_LINK_M)}`;
    if (!cell.has(key)) cell.set(key, []);
    cell.get(key).push(i);
  });
  pts.forEach((q, i) => {
    const [cx, cz] = [Math.floor(q.p[0] / SITE_LINK_M), Math.floor(q.p[1] / SITE_LINK_M)];
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? []) if (j > i && norm(sub(pts[j].p, q.p)) <= SITE_LINK_M) parent[root(i)] = root(j);
    }
  });
  const groups = new Map();
  pts.forEach((q, i) => { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(q); });
  const extent = (p) => { const [x, z] = [p[0] * U, p[1] * U]; return x >= -2 && x <= 502 && z >= -376 && z <= 2; };
  return [...groups.values()]
    .filter((g) => extent(g.reduce((a, q) => [a[0] + q.p[0] / g.length, a[1] + q.p[1] / g.length], [0, 0])))
    .map((g) => {
      const b = orientedBox(g.map((q) => q.p));
      const m = SITE_MARGIN_M;
      const corner = (s, t) => [b.u[0] * s + b.v[0] * t, b.u[1] * s + b.v[1] * t];
      return { ring: [corner(b.s0 - m, b.t0 - m), corner(b.s1 + m, b.t0 - m), corner(b.s1 + m, b.t1 + m), corner(b.s0 - m, b.t1 + m)], sources: [...new Set(g.map((q) => q.src))] };
    })
    .sort((a, b) => a.ring[0][1] - b.ring[0][1] || a.ring[0][0] - b.ring[0][0])
    // a review area marked `alone` is searched as drawn, on its own (a large neighbouring site's row directions would
    // hide its own)
    .concat((review.addAreas ?? []).filter((a) => a.alone).map((a) => ({ ring: a.ring.map(toMetres), sources: [a.id] })));
}

// Rows found twice (two directions or overlapping sites): the one with more dividers stays.
function rowBox(r) {
  const n = [-r.u[1], r.u[0]];
  void n;
  return [r.start, r.end, [r.end[0] + r.v[0] * r.depthPhoto, r.end[1] + r.v[1] * r.depthPhoto], [r.start[0] + r.v[0] * r.depthPhoto, r.start[1] + r.v[1] * r.depthPhoto]];
}
function overlapShare(a, b) {
  const ba = rowBox(a), bb = rowBox(b);
  let inside = 0, total = 0;
  for (let s = 0.1; s < 1; s += 0.2) for (let t = 0.1; t < 1; t += 0.2) {
    const p = [ba[0][0] + (ba[1][0] - ba[0][0]) * s + (ba[3][0] - ba[0][0]) * t, ba[0][1] + (ba[1][1] - ba[0][1]) * s + (ba[3][1] - ba[0][1]) * t];
    total += 1;
    if (pointInRing(p, bb)) inside += 1;
  }
  return inside / total;
}

// Whether any painted rectangle of row a intersects any of row b (separating-axis test on the rectangles, metres).
function rectsIntersect(p, q) {
  for (const poly of [p, q]) for (let i = 0; i < 4; i += 1) {
    const e = sub(poly[(i + 1) % 4], poly[i]);
    const n = [-e[1], e[0]];
    const pa = p.map((x) => dot(x, n)), pb = q.map((x) => dot(x, n));
    if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
  }
  return true;
}
function paintTouches(a, b) {
  const ra = rowGeometry(a).rects.filter((r) => !r.shared).map((r) => r.ring);
  const rb = rowGeometry(b).rects.filter((r) => !r.shared).map((r) => r.ring);
  return ra.some((x) => rb.some((y) => rectsIntersect(x, y)));
}
// Drop the end bay of `row` nearer `other` (start or end moves in by that bay's photo width).
function trimEndBay(row, other) {
  if (row.photoBays <= 1) { row.drop = true; return; }
  const s = toMetres(row.start), e = toMetres(row.end);
  const oc = rowGeometry(other).origin;
  const u = [(e[0] - s[0]) / norm(sub(e, s)), (e[1] - s[1]) / norm(sub(e, s))];
  const atStart = norm(sub(s, oc)) < norm(sub(e, oc));
  const k = atStart ? 0 : row.photoBays - 1;
  const w = row.accessible.includes(k) ? (row.photoAccessiblePitchM ?? 3.4) : row.photoPitchM;
  if (atStart) row.start = toGeo([s[0] + u[0] * w, s[1] + u[1] * w]);
  else row.end = toGeo([e[0] - u[0] * w, e[1] - u[1] * w]);
  row.photoBays -= 1;
  row.accessible = row.accessible.filter((x) => x !== k).map((x) => (atStart ? x - 1 : x));
  row.trimmedBays = (row.trimmedBays ?? 0) + 1;
}

function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// ---------------------------------------------------------------- main
const review = JSON.parse(readFileSync(REVIEW, "utf8"));
const only = process.argv.includes("--site") ? process.argv[process.argv.indexOf("--site") + 1] : null;
const allSites = sites(review);
const found = [];
allSites.forEach((site, si) => {
  const id = `S${String(si + 1).padStart(2, "0")}`;
  if (only && id !== only && !site.sources.includes(only)) return;
  const f = paintField(site.ring);
  const scores = [];
  const frames = [];
  for (let deg = 0; deg < 180; deg += 1) {
    const fr = dividers(f, deg);
    frames.push(fr);
    scores.push(fr.segs.reduce((a, s) => a + (s.v1 - s.v0), 0));
  }
  const top = Math.max(...scores);
  const peaks = scores.map((s, i) => ({ s, i })).filter(({ s, i }) => s >= 0.4 * top && s >= 10 && [1, 2, 3].every((d) => s >= scores[(i + d) % 180] && s >= scores[(i + 180 - d) % 180]));
  const rows = peaks.flatMap(({ i }) => rowsOf(f, frames[i]).map((r) => ({ ...r, deg: i })));
  rows.forEach((r) => { r.site = id; r.sources = site.sources; });
  if (process.env.PARKING_DEBUG_DIR) {
    const P = (fr, s, t) => [f.centre[0] + fr.u[0] * s + fr.v[0] * t, f.centre[1] + fr.u[1] * s + fr.v[1] * t];
    writeFileSync(path.join(process.env.PARKING_DEBUG_DIR, `${id}.json`), JSON.stringify({
      ring: site.ring, sources: site.sources,
      segs: peaks.flatMap(({ i }) => frames[i].segs.map((sg) => [P(frames[i], sg.u, sg.v0), P(frames[i], sg.u, sg.v1)])),
      rows: rows.map((r) => ({ start: r.start, end: r.end, v: r.v, depth: r.depthPhoto, bays: r.bays, pitch: r.pitch })),
    }));
  }
  found.push(...rows);
  console.log(`${id}: ${site.sources.length} sources, directions ${peaks.map((p) => p.i).join("/") || "-"}, ${rows.length} rows (${rows.map((r) => `${r.bays}x${r.pitch.toFixed(2)}`).join(", ")})`);
});
found.sort((a, b) => b.dividers - a.dividers);
const rows = [];
for (const r of found) if (!rows.some((q) => overlapShare(r, q) > 0.3 || overlapShare(q, r) > 0.3)) rows.push(r);
// review rejections (by eye, with reasons) and lots: rows within LOT_LINK_M
const rejected = new Map((review.rejectRows ?? []).map((x) => [x.near.join(","), x]));
const kept = rows.filter((r) => ![...rejected.values()].some((x) => norm(sub(toMetres(x.near), [(r.start[0] + r.end[0]) / 2, (r.start[1] + r.end[1]) / 2])) < 3));
const rejectedRows = rows.length - kept.length;
// rows along a front line drawn by eye (review.rowLines: the row's front line and a point on its stall side), where the
// cars hide too many dividers for the divider search: the dividers are read along the line on the photo (white paint
// peaks within 0.5-4.5 m of the front, 0.1 m steps), the pitch is the one (2.3-3.0 m) that puts the most read dividers on
// its grid, the bays are the line's length over that pitch; a bay holding the review's accessible point is accessible
function lineRow(e) {
  // parallel rows (평행주차, review flag `parallel`): 2.0 m deep, dividers 5.5-7.0 m apart, drawn at least 6.0 m
  const [tMin, tMax, pMin, pMax, wMin, depth] = e.parallel ? [0.3, 1.7, 5.5, 7.0, 6.0, 2.0] : [0.5, 4.5, 2.3, 3.0, 2.5, 5.0];
  const a = toMetres(e.front[0]), b = toMetres(e.front[1]), side = toMetres(e.side);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let v = [-u[1], u[0]];
  if ((side[0] - a[0]) * v[0] + (side[1] - a[1]) * v[1] < 0) v = [-v[0], -v[1]];
  const pts = [a, b, [a[0] + v[0] * depth, a[1] + v[1] * depth], [b[0] + v[0] * depth, b[1] + v[1] * depth]];
  const box = [Math.min(...pts.map((p) => p[0])) - 1, Math.min(...pts.map((p) => p[1])) - 1, Math.max(...pts.map((p) => p[0])) + 1, Math.max(...pts.map((p) => p[1])) + 1];
  const px = paintIn(box, { whiteContrast: 14, pavementMax: 175 }).blobs.filter((bl) => bl.colour === "white" && bl.type !== "car").flatMap((bl) => bl.pts);
  const prof = [];
  for (let sv = 0; sv <= L; sv += 0.1) {
    let n = 0;
    for (const q of px) { const d = [q[0] - a[0], q[1] - a[1]]; const t = d[0] * v[0] + d[1] * v[1], ss = d[0] * u[0] + d[1] * u[1]; if (t >= tMin && t <= tMax && Math.abs(ss - sv) <= 0.15) n += 1; }
    prof.push(n);
  }
  const mx = Math.max(...prof);
  const peaks = [];
  prof.forEach((n, i) => { if (n >= Math.max(4, 0.3 * mx) && n >= (prof[i - 1] ?? 0) && n >= (prof[i + 1] ?? 0) && (!peaks.length || i * 0.1 - peaks.at(-1) > 1.2)) peaks.push(i * 0.1); });
  if (peaks.length < 2 && !e.parallel) return null;
  let best = peaks.length < 2 ? { p: wMin, p0: 0, hits: peaks } : null;
  if (peaks.length >= 2) for (let p = pMin; p <= pMax + 1e-9; p += 0.01) for (const p0 of peaks) {
    const hits = peaks.filter((x) => { const r = (((x - p0) % p) + p) % p; return Math.min(r, p - r) <= 0.15; });
    if (!best || hits.length > best.hits.length || (hits.length === best.hits.length && Math.abs(p - wMin) < Math.abs(best.p - wMin))) best = { p, p0, hits };
  }
  const first = best.p0 - Math.floor((best.p0 + 0.3) / best.p) * best.p;
  // the bays the painted length holds at the drawn (statute-clamped) width
  // (a parallel frame whose middle dividers the photo does not show: its length over the 6.0 m standard bay)
  const bays = e.parallel ? Math.max(1, Math.round(L / Math.max(best.p, wMin))) : Math.floor((L - first + 0.3) / Math.max(best.p, wMin));
  if (bays < 1) return null;
  const start = [a[0] + u[0] * first, a[1] + u[1] * first];
  const end = [start[0] + u[0] * bays * Math.max(best.p, wMin), start[1] + u[1] * bays * Math.max(best.p, wMin)];
  const acc = e.accessible ? toMetres(e.accessible) : null;
  const accessible = acc ? [Math.floor(((acc[0] - start[0]) * u[0] + (acc[1] - start[1]) * u[1]) / best.p)].filter((k) => k >= 0 && k < bays) : [];
  return {
    site: `line ${e.id}`, u, v, centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dividers: best.hits.length, sources: [`review ${e.id}`], start, end,
    bays, pitch: best.p, accessiblePitch: 3.3, depthPhoto: depth, lines: true, partial: false, accessible, rms: 0, parallel: Boolean(e.parallel),
    photoDividers: best.hits.map((x) => [a[0] + u[0] * x, a[1] + u[1] * x]),
  };
}
for (const e of review.rowLines ?? []) {
  const r = lineRow(e);
  console.log(`row line ${e.id}: ${r ? `${r.bays} bays at ${r.pitch.toFixed(2)} m (${r.dividers} dividers read on the photo)` : "no dividers read"}`);
  if (!r) continue;
  // the divider search's own reads along this line are replaced
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    const q = kept[i];
    const m = [(q.start[0] + q.end[0]) / 2 - r.start[0], (q.start[1] + q.end[1]) / 2 - r.start[1]];
    const along = m[0] * r.u[0] + m[1] * r.u[1], across = m[0] * r.v[0] + m[1] * r.v[1];
    if (along >= -1 && along <= r.bays * r.pitch + 1 && across >= -2 && across <= 6) kept.splice(i, 1);
  }
  kept.push(r);
}
// rows found in the re-search areas (review.addAreas) are trimmed at their ends to the painted dividers: an end bay
// whose outer divider shows white paint over less than TRIM_SHARE of its length on the photo is dropped
const TRIM_SHARE = 0.3;
let trimmedBays = 0;
for (const r of kept) {
  if (!r.sources.some((x) => /^lot-|recheck|B7-south/.test(x))) continue;
  const box = (() => { const pts = [r.start, r.end, [r.end[0] + r.v[0] * r.depthPhoto, r.end[1] + r.v[1] * r.depthPhoto], [r.start[0] + r.v[0] * r.depthPhoto, r.start[1] + r.v[1] * r.depthPhoto]]; return [Math.min(...pts.map((p) => p[0])) - 1, Math.min(...pts.map((p) => p[1])) - 1, Math.max(...pts.map((p) => p[0])) + 1, Math.max(...pts.map((p) => p[1])) + 1]; })();
  const paint = paintIn(box, { whiteContrast: 14, pavementMax: 175 }).blobs.filter((b) => b.colour === "white" && b.type !== "car").flatMap((b) => b.pts);
  const painted = (s) => {
    const o = [r.start[0] + r.u[0] * s, r.start[1] + r.u[1] * s];
    let hit = 0, n = 0;
    for (let t = 0.3; t <= r.depthPhoto - 0.3; t += 0.25) { n += 1; const q = [o[0] + r.v[0] * t, o[1] + r.v[1] * t]; if (paint.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 0.25)) hit += 1; }
    return hit / n;
  };
  const len = Math.hypot(r.end[0] - r.start[0], r.end[1] - r.start[1]);
  let a = 0, b = r.bays;
  while (b - a > 1 && painted((a * len) / r.bays) < TRIM_SHARE) a += 1;
  while (b - a > 1 && painted((b * len) / r.bays) < TRIM_SHARE) b -= 1;
  if (a === 0 && b === r.bays) continue;
  const step = len / r.bays;
  const s0 = [r.start[0] + r.u[0] * a * step, r.start[1] + r.u[1] * a * step];
  r.end = [r.start[0] + r.u[0] * b * step, r.start[1] + r.u[1] * b * step];
  r.start = s0;
  r.photoDividers = r.photoDividers.filter((p) => { const s = (p[0] - s0[0]) * r.u[0] + (p[1] - s0[1]) * r.u[1]; return s >= -0.3 && s <= (b - a) * step + 0.3; });
  r.accessible = r.accessible.filter((k) => k >= a && k < b).map((k) => k - a);
  trimmedBays += r.bays - (b - a);
  r.bays = b - a;
}
console.log(`re-search rows trimmed to their painted dividers: ${trimmedBays} bays dropped`);
// end bays under a building of the model (the up-facing triangles of its BLD_* nodes in public/campus-v2.glb, as the
// markings audit's stall-building check reads them) are dropped: no stall crosses a building
{
  const { roofs } = await readMarkings(path.join(HERE, "..", "..", "..", "public", "campus-v2.glb"));
  const grid = new Map();
  for (const t of roofs) { const xs = t.map((q) => q[0]), zs = t.map((q) => q[1]); for (let i = Math.floor(Math.min(...xs) / 4); i <= Math.floor(Math.max(...xs) / 4); i += 1) for (let j = Math.floor(Math.min(...zs) / 4); j <= Math.floor(Math.max(...zs) / 4); j += 1) { const k = `${i},${j}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); } }
  const inTri = (q, [a, b, c]) => { const f = (p1, p2) => (p2[0] - p1[0]) * (q[1] - p1[1]) - (p2[1] - p1[1]) * (q[0] - p1[0]); const d1 = f(a, b), d2 = f(b, c), d3 = f(c, a); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  const under = (q) => (grid.get(`${Math.floor(q[0] / 4)},${Math.floor(q[1] / 4)}`) ?? []).some((t) => inTri(q, t));
  let dropped = 0;
  // the drawn geometry (lib/parkingRows.mjs rowGeometry on the row as written), every stroke corner tested as the audit
  // does: under a roof together with the four points 0.5 m from it
  const deep = (q) => [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].every(([dx, dz]) => under([q[0] + dx, q[1] + dz]));
  const asWritten = (r) => ({ start: toGeo(r.start), end: toGeo(r.end), depthBearing: +(((Math.atan2(r.v[0], -r.v[1]) * 180) / Math.PI + 360) % 360).toFixed(2), photoBays: r.bays, photoPitchM: r.pitch, accessible: r.accessible, photoDividers: r.photoDividers.map(toGeo), ...(r.aisle ?? {}), ...(r.parallel ? { parallel: true } : {}) });
  for (const r of kept) {
    for (let guard = 0; guard < 40 && r.bays > 0; guard += 1) {
      const g = rowGeometry(asWritten(r));
      // a bay stands in a building when its centre lies under a roof of the model (an overhang over the back of the
      // stall, as the photo shows at B7, is not the building's footprint)
      const bad = new Set();
      let s0 = 0;
      g.widths.forEach((w, k) => { const c = [g.origin[0] + g.u[0] * (s0 + w / 2) + g.v[0] * g.depth / 2, g.origin[1] + g.u[1] * (s0 + w / 2) + g.v[1] * g.depth / 2]; if (deep(c)) bad.add(k); s0 += w; });
      if (!bad.size) break;
      const len = Math.hypot(r.end[0] - r.start[0], r.end[1] - r.start[1]), step = len / r.bays;
      const k = Math.min(...bad);
      const fromStart = k <= r.bays / 2;
      if (fromStart) r.start = [r.start[0] + r.u[0] * step, r.start[1] + r.u[1] * step];
      else r.end = [r.end[0] - r.u[0] * step, r.end[1] - r.u[1] * step];
      r.accessible = r.accessible.filter((x) => (fromStart ? x >= 1 : x < r.bays - 1)).map((x) => (fromStart ? x - 1 : x));
      r.bays -= 1;
      dropped += 1;
    }
  }
  // every row registered on the photo paint: the drawn strokes (statute widths, lib/parkingRows.mjs) moved along and
  // across the row (+-1.4 m: over half a bay, +-3.0 m) and turned (+-3 deg), coarse then fine (0.05 m, 0.5 deg), to cover the most white paint the photo
  // shows within 0.1 m of them (qa/photoPaint.mjs, light-lot setting); the row keeps that placement (registered)
  let registered = 0;
  for (const r of kept) {
    // (rows along a by-eye front line keep that line: the cars over them leave too little paint to register on)
    if (r.aisle || r.bays < 1 || r.sources.some((x) => x.startsWith("review "))) continue;
    const g0 = rowGeometry(asWritten(r));
    const ring = g0.rects.flatMap((rc) => rc.ring);
    const xs = ring.map((q) => q[0]), zs = ring.map((q) => q[1]);
    const box = [Math.min(...xs) - 2.5, Math.min(...zs) - 2.5, Math.max(...xs) + 2.5, Math.max(...zs) + 2.5];
    // (paint under a roof of the model is left out)
    const nearRoof = (q) => under(q);
    const paint = new Set(paintIn(box, { whiteContrast: 14, pavementMax: 175 }).blobs.filter((b) => b.colour === "white" && b.type !== "car").flatMap((b) => b.pts).filter((q) => !nearRoof(q)).map((q) => Math.round(q[0] * 10) * 100003 + Math.round(q[1] * 10)));
    if (paint.size < 20) continue;
    // stroke sample points of the drawn row, relative to its first divider's front corner
    const o = g0.origin;
    const samples = [];
    for (const rc of g0.rects) {
      const [a, b, , d] = rc.ring;
      const e1 = [b[0] - a[0], b[1] - a[1]], e2 = [d[0] - a[0], d[1] - a[1]];
      const n1 = Math.max(1, Math.round(Math.hypot(...e1) / 0.1)), n2 = Math.max(1, Math.round(Math.hypot(...e2) / 0.1));
      for (let i = 0; i <= n1; i += 1) for (let j = 0; j <= n2; j += 1) samples.push([a[0] + (e1[0] * i) / n1 + (e2[0] * j) / n2 - o[0], a[1] + (e1[1] * i) / n1 + (e2[1] * j) / n2 - o[1]]);
    }
    const rotCache = new Map();
    const rotated = (deg) => { if (!rotCache.has(deg)) { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); rotCache.set(deg, samples.map(([x, z]) => [o[0] + x * c - z * s, o[1] + x * s + z * c])); } return rotCache.get(deg); };
    const score = (ds, dt, deg) => {
      const sx = g0.u[0] * ds + g0.v[0] * dt, sz = g0.u[1] * ds + g0.v[1] * dt;
      let n = 0;
      for (const q of rotated(deg)) if (paint.has(Math.round((q[0] + sx) * 10) * 100003 + Math.round((q[1] + sz) * 10))) n += 1;
      return n;
    };
    let best = { n: score(0, 0, 0), ds: 0, dt: 0, deg: 0 };
    const base = best.n;
    // coarse (0.2 m, 1 deg), then fine (0.05 m, 0.5 deg) around the coarse best
    // (a row along a by-eye front line keeps that line's direction: moved, not turned)
    const degs = r.sources.some((x) => x.startsWith("review ")) ? [0] : [-3, -2, -1, 0, 1, 2, 3];
    for (const deg of degs) for (let ds = -1.4; ds <= 1.4 + 1e-9; ds += 0.2) for (let dt = -3.0; dt <= 3.0 + 1e-9; dt += 0.2) { const n = score(ds, dt, deg); if (n > best.n * 1.02) best = { n, ds, dt, deg }; }
    const c0 = { ...best };
    for (const deg of degs.length === 1 ? [0] : [c0.deg - 1, c0.deg - 0.5, c0.deg, c0.deg + 0.5, c0.deg + 1]) for (let ds = c0.ds - 0.2; ds <= c0.ds + 0.2 + 1e-9; ds += 0.05) for (let dt = c0.dt - 0.2; dt <= c0.dt + 0.2 + 1e-9; dt += 0.05) { const n = score(ds, dt, deg); if (n > best.n) best = { n, ds, dt, deg }; }
    if (best.n <= base) continue;
    const c = Math.cos((best.deg * Math.PI) / 180), s = Math.sin((best.deg * Math.PI) / 180);
    const rot = (p) => [o[0] + (p[0] - o[0]) * c - (p[1] - o[1]) * s + g0.u[0] * best.ds + g0.v[0] * best.dt, o[1] + (p[0] - o[0]) * s + (p[1] - o[1]) * c + g0.u[1] * best.ds + g0.v[1] * best.dt];
    const rv = (v) => [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
    // the written row: start at the drawn first divider, end after its bays at the drawn widths, no further shift
    const len = g0.widths.reduce((acc, w) => acc + w, 0);
    r.start = rot(o);
    r.u = rv(g0.u); r.v = rv(g0.v);
    r.end = [r.start[0] + r.u[0] * len, r.start[1] + r.u[1] * len];
    r.photoDividers = r.photoDividers.map(rot);
    r.registered = { ds: +best.ds.toFixed(2), dt: +best.dt.toFixed(2), deg: best.deg, gain: +(best.n / Math.max(1, base)).toFixed(2) };
    registered += 1;
  }
  console.log(`rows registered on the photo paint: ${registered}`);
  // (and single-bay reads, too weak to stand as a row)
  for (let i = kept.length - 1; i >= 0; i -= 1) if (kept[i].bays < (kept[i].parallel ? 1 : 2)) kept.splice(i, 1);
  console.log(`end bays under a building of the model dropped: ${dropped}`);
}
// angled rows by area: the perpendicular reads inside an angled area are its dividers read square, replaced
for (const area of review.angledAreas ?? []) {
  const r = angledRow(area);
  // the square reads inside an angled area are its dividers read square: left out either way
  const ringA = area.ring.map(toMetres);
  const inA = (q) => { let c = false; for (let i = 0, j = ringA.length - 1; i < ringA.length; j = i, i += 1) { const [xi, zi] = ringA[i], [xj, zj] = ringA[j]; if ((zi > q[1]) !== (zj > q[1]) && q[0] < ((xj - xi) * (q[1] - zi)) / (zj - zi) + xi) c = !c; } return c; };
  for (let i = kept.length - 1; i >= 0; i -= 1) if (!kept[i].aisle && inA([(kept[i].start[0] + kept[i].end[0]) / 2, (kept[i].start[1] + kept[i].end[1]) / 2])) kept.splice(i, 1);
  if (r?.rejected) { console.log(`angled area ${area.id}: ${r.rejected}, outside the statute angles: left out (residual)`); continue; }
  console.log(`angled area ${area.id}: ${r ? `${r.bays} bays, pitch ${r.pitch.toFixed(2)} m square to the dividers, photo angle ${r.aisle.photoAngleDeg} deg` : "no paint read"}`);
  if (!r) continue;
  const inArea = (q) => { const ring = r.angledArea; let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > q[1]) !== (zj > q[1]) && q[0] < ((xj - xi) * (q[1] - zi)) / (zj - zi) + xi) c = !c; } return c; };
  for (let i = kept.length - 1; i >= 0; i -= 1) if (inArea([(kept[i].start[0] + kept[i].end[0]) / 2, (kept[i].start[1] + kept[i].end[1]) / 2])) kept.splice(i, 1);
  kept.push(r);
}
const LOT_LINK_M = 9;
const lp = kept.map((_, i) => i);
const lroot = (i) => (lp[i] === i ? i : (lp[i] = lroot(lp[i])));
const near = (a, b) => rowBox(a).some((p) => rowBox(b).some((q) => norm(sub(p, q)) < LOT_LINK_M));
for (let i = 0; i < kept.length; i += 1) for (let j = i + 1; j < kept.length; j += 1) if (near(kept[i], kept[j])) lp[lroot(i)] = lroot(j);
const lotGroups = new Map();
kept.forEach((r, i) => { const k = lroot(i); if (!lotGroups.has(k)) lotGroups.set(k, []); lotGroups.get(k).push(r); });
// Rows as written, then per lot: back-to-back rows share one back line (the second row moved onto the first one's line,
// its own back line left out), modelled rows that still overlap keep the one with more bays (a duplicate read), and the
// lot polygon is the hull of the modelled rows grown by LOT_RING_MARGIN_M.
const LOT_RING_MARGIN_M = 0.3;
const dropped = [];
const lots = [...lotGroups.values()]
  .map((rs) => ({ rs, c: rs.reduce((a, r) => [a[0] + r.start[0] / rs.length, a[1] + r.start[1] / rs.length], [0, 0]) }))
  .sort((a, b) => a.c[1] - b.c[1] || a.c[0] - b.c[0])
  .map(({ rs }, li) => {
    const id = `P${String(li + 1).padStart(2, "0")}`;
    let rows = rs.sort((a, b) => a.start[1] - b.start[1] || a.start[0] - b.start[0]).map((r, k) => ({
      id: `${id}-R${k + 1}`,
      site: r.site,
      evidence: `NGII 34702020 dividers (${r.dividers} read); traces ${r.sources.slice(0, 4).join(", ")}${r.sources.length > 4 ? ` +${r.sources.length - 4}` : ""}`,
      start: toGeo(r.start),
      end: toGeo(r.end),
      depthBearing: +(((Math.atan2(r.v[0], -r.v[1]) * 180) / Math.PI + 360) % 360).toFixed(2),
      ...(r.aisle ?? {}),
      ...(r.parallel ? { parallel: true } : {}),
      ...(r.registered ? { registered: r.registered } : {}),
      photoBays: r.bays,
      photoPitchM: +r.pitch.toFixed(3),
      photoAccessiblePitchM: +r.accessiblePitch.toFixed(3),
      photoDepthM: +r.depthPhoto.toFixed(2),
      frontBackLines: r.lines,
      ...(r.partial ? { partialDepth: true } : {}),
      dividerRmsCm: +(r.rms * 100).toFixed(1),
      accessible: r.accessible,
      photoDividers: r.photoDividers.map(toGeo),
    }));
    // back-to-back pairs
    for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
      const [A, B] = [rows[i], rows[j]];
      if (B.shareBackWith || A.shareBackWith === B.id) continue;
      const [gA, gB] = [rowGeometry(A), rowGeometry(B)];
      if (Math.abs(dot(gA.u, gB.u)) < Math.cos((3 * Math.PI) / 180) || dot(gA.v, gB.v) > -0.99) continue;
      const sA = toMetres(A.start), sB = toMetres(B.start);
      const shift = dot(sub(sB, sA), gA.v) - gB.depth - gA.depth;
      if (Math.abs(shift) > 0.6) continue;
      const along = (g, q) => dot(sub(q, sA), gA.u);
      const spanA = gA.rects.flatMap((r) => r.ring).map((q) => along(gA, q));
      const spanB = gB.rects.flatMap((r) => r.ring).map((q) => along(gB, q));
      if (Math.min(Math.max(...spanA), Math.max(...spanB)) - Math.max(Math.min(...spanA), Math.min(...spanB)) <= 0) continue;
      Object.assign(B, { shiftM: +shift.toFixed(3), backLine: false, shareBackWith: A.id });
    }
    // duplicates: modelled rows (beyond a shared back line) that overlap
    const area = (ra, rb) => {
      const ga = rowGeometry(ra), gb = rowGeometry(rb);
      const boxA = [ga.rects[0].ring[0], ga.rects[0].ring[1]].concat([ga.rects[1].ring[2], ga.rects[1].ring[3]]);
      const boxB = [gb.rects[0].ring[0], gb.rects[0].ring[1]].concat([gb.rects[1].ring[2], gb.rects[1].ring[3]]);
      let n = 0;
      for (let x = 0.05; x < 1; x += 0.1) for (let y = 0.05; y < 1; y += 0.1) {
        const q = [boxA[0][0] + (boxA[1][0] - boxA[0][0]) * x + (boxA[3][0] - boxA[0][0]) * y, boxA[0][1] + (boxA[1][1] - boxA[0][1]) * x + (boxA[3][1] - boxA[0][1]) * y];
        if (pointInRing(q, boxB)) n += 1;
      }
      return n / 100;
    };
    for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
      const [A, B] = [rows[i], rows[j]];
      if (A.drop || B.drop || A.shareBackWith === B.id || B.shareBackWith === A.id) continue;
      if (area(A, B) > 0.2 || area(B, A) > 0.2) {
        const loser = A.photoBays >= B.photoBays ? B : A;
        loser.drop = true;
        dropped.push(`${loser.id} (overlaps ${loser === A ? B.id : A.id}: one row read twice)`);
        continue;
      }
      // rows that only meet at their ends (an L-shaped corner): the shorter row gives up its end bays there, one by
      // one, until no painted line of one touches the other's
      let guard = 0;
      while (!A.drop && !B.drop && paintTouches(A, B) && guard < 40) {
        guard += 1;
        const loser = A.photoBays <= B.photoBays ? A : B;
        const other = loser === A ? B : A;
        trimEndBay(loser, other);
        dropped.push(`${loser.id}: end bay given up where it meets ${other.id}`);
      }
    }
    rows = rows.filter((r) => !r.drop);
    for (const r of rows) if (r.shareBackWith && !rows.some((q) => q.id === r.shareBackWith)) { delete r.shareBackWith; delete r.shiftM; delete r.backLine; }
    const corners = rows.flatMap((r) => {
      const g = rowGeometry(r);
      return g.rects.flatMap((x) => x.ring).flatMap((q) => [[q[0] - LOT_RING_MARGIN_M, q[1] - LOT_RING_MARGIN_M], [q[0] + LOT_RING_MARGIN_M, q[1] - LOT_RING_MARGIN_M], [q[0] + LOT_RING_MARGIN_M, q[1] + LOT_RING_MARGIN_M], [q[0] - LOT_RING_MARGIN_M, q[1] + LOT_RING_MARGIN_M]]);
    });
    return {
      id,
      ring: hull(corners).map(toGeo),
      photoStalls: rows.reduce((a, r) => a + r.photoBays, 0),
      photoAccessible: rows.reduce((a, r) => a + r.accessible.length, 0),
      rows,
    };
  })
  .filter((l) => l.rows.length);
if (!only) writeFileSync(OUT, `${JSON.stringify({
  source: "NGII 2025 orthophoto sheet 34702020 (0.25 m), read by bake/parking-rows.mjs; review: data/photo/parking-review.json",
  method: "divider lines per direction, rows of stall-pitch spacing, front/back lines for depth; counts are the bays between the first and last photo divider of each row",
  droppedDuplicates: dropped,
  note: "a row's photoBays excludes end bays it gives up where it meets another row (trimmedBays): those bays are the other row's",
  lots,
}, null, 1)}\n`);
if (only) console.log("rejected rows:", JSON.stringify(why));
console.log(`${allSites.length} sites, ${found.length} rows found, ${rows.length} after duplicates, ${kept.length} after review (${rejectedRows} rejected by eye) -> ${lots.length} lots, ${lots.reduce((a, l) => a + l.photoStalls, 0)} stalls -> ${path.relative(process.cwd(), OUT)}`);

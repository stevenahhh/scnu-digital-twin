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

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (a) => Math.hypot(a[0], a[1]);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const toMetres = ([lon, lat]) => geoToModel(lon, lat).map((v) => v / U);
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
  if (!lines && v1 - v0 < 3) return reject("depth");
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
    centre: f.centre, u: frame.u, v: frame.v, start: P(u0, v0), end: P(uEnd, v0), depthPhoto: v1 - v0, lines,
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
  for (const area of review.addAreas ?? []) for (const q of area.ring) pts.push({ p: toMetres(q), src: area.id });
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
    .sort((a, b) => a.ring[0][1] - b.ring[0][1] || a.ring[0][0] - b.ring[0][0]);
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
  if (only && id !== only) return;
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
      photoBays: r.bays,
      photoPitchM: +r.pitch.toFixed(3),
      photoDepthM: +r.depthPhoto.toFixed(2),
      frontBackLines: r.lines,
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
      if (area(A, B) > 0.02 || area(B, A) > 0.02) {
        const loser = A.photoBays >= B.photoBays ? B : A;
        loser.drop = true;
        dropped.push(`${loser.id} (overlaps ${loser === A ? B.id : A.id}: one row read twice)`);
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
  lots,
}, null, 1)}\n`);
if (only) console.log("rejected rows:", JSON.stringify(why));
console.log(`${allSites.length} sites, ${found.length} rows found, ${rows.length} after duplicates, ${kept.length} after review (${rejectedRows} rejected by eye) -> ${lots.length} lots, ${lots.reduce((a, l) => a + l.photoStalls, 0)} stalls -> ${path.relative(process.cwd(), OUT)}`);

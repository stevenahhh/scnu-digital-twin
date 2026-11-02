#!/usr/bin/env bun
// Parking row estimator (design §6.2, plan campus-ground-truth-redesign todo 11): proposes parametric rows for a lot
// from the photo, for a person to copy into data/ground/parking.json. It never writes parking.json itself.
//
// Inputs, all in EPSG:5186 metres: the lot ring, the parking_line / disabled_parking marking pieces inside it, and a
// photo window { w, h, origin: [E, N] of the top-left pixel corner, gsdM, rgb, mask } whose mask is lib/occlusion.mjs
// `any` (leaned roofs, crowns, cast shadows).
//   1. Divider candidates: marking pieces and bright photo components (outside the mask) whose oriented box has an
//      aspect >= 8 (the stalls.mjs rule).
//   2. Main direction theta: 2-degree histogram of the candidates' long axes. Centres are projected on the axis a
//      perpendicular to theta.
//   3. Pitch p: the circular resultant of the projected centres, searched 2.0-6.5 m at 0.05 m; phase = circular mean.
//   4. Back line: Huber fit of the candidates' back ends (the end nearer the back hint, a building or kerb); depth =
//      median end-to-end length.
//   5. Count: divider positions every p over the candidates' span; each position's paint support is measured on
//      pixels outside the mask. Two or more visible positions in a row with no paint end a row; masked positions never
//      do. A row needs two supported dividers, so the old ">= 3 detected dividers" rule is gone.
//   6. A blue piece over a row marks the nearest stall accessible: 3.3 m wide when the blue is >= 3.0 m, else 2.5 m plus
//      a 1.2 m aisle. A lot with no row gets no stall, accessible or otherwise.
//   7. photoSupport = median support of the visible positions. A lot with no supported row is T4, estimated.
//
//   bun scripts/campus-model/fit/parkingRows.mjs [--lot LOT_E3_S] [--out <proposals.json>] [--chips <png>]
import { orientedBox } from "../lib/markingFit.mjs";

const ASPECT = 8;
const BIN_DEG = 2;
const PITCH_RANGE = [2.0, 6.5];
const PITCH_STEP = 0.05;
const GENERAL_PITCH = 2.5;
const SUPPORTED = 0.3;
const VISIBLE_FRACTION = 0.5;
const CONTRAST = 35;
const HUBER_K = 0.3;
const ACCESSIBLE_WIDE_M = 3.0;
const MAX_DEPTH_M = 7.0;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const median = (v) => {
  if (!v.length) return null;
  const s = [...v].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (v, d = 3) => Number(v.toFixed(d));
const toRad = (deg) => (deg * Math.PI) / 180;

// Pieces { id, kind, ring } -> thin divider candidates { id, centre, long, short, halfLong, halfShort, widthM, ring }.
export function dividerCandidates(pieces) {
  const out = [];
  for (const piece of pieces) {
    if (piece.kind && piece.kind !== "parking_line") continue;
    const box = orientedBox(piece.ring);
    if (box.halfLong < ASPECT * box.halfShort) continue;
    out.push({ ...box, id: piece.id, ring: piece.ring, widthM: 2 * box.halfShort, lengthM: 2 * box.halfLong });
  }
  return out;
}

const axisAngle = (v) => ((((Math.atan2(v[1], v[0]) * 180) / Math.PI) % 180) + 180) % 180;

// Long-axis angle (degrees from +E, [0, 180)) of the busiest 2-degree bin, refined by the doubled-angle mean of its
// members and both neighbours.
export function dominantAngleDeg(candidates) {
  const bins = new Map();
  for (const c of candidates) {
    const b = Math.floor(axisAngle(c.long) / BIN_DEG);
    bins.set(b, (bins.get(b) ?? 0) + c.lengthM);
  }
  const n = 180 / BIN_DEG;
  let best = null;
  for (const [b] of bins) {
    const w = (bins.get(b) ?? 0) + 0.5 * ((bins.get((b + 1) % n) ?? 0) + (bins.get((b + n - 1) % n) ?? 0));
    if (!best || w > best.w) best = { b, w };
  }
  const centre = (best.b + 0.5) * BIN_DEG;
  let sx = 0;
  let sy = 0;
  for (const c of candidates) {
    const a = axisAngle(c.long);
    const d = ((a - centre + 270) % 180) - 90;
    if (Math.abs(d) > 1.5 * BIN_DEG) continue;
    sx += c.lengthM * Math.cos(toRad(2 * a));
    sy += c.lengthM * Math.sin(toRad(2 * a));
  }
  return ((((Math.atan2(sy, sx) * 180) / Math.PI / 2) % 180) + 180) % 180;
}

// 1-D divider positions -> { pitchM, phaseM, resultant }. Ties (within 0.02) go to the pitch nearest the statute
// general bay, so two dividers 5 m apart read as two 2.5 m bays.
export function estimatePitch(xs) {
  let best = null;
  for (let p = PITCH_RANGE[0]; p <= PITCH_RANGE[1] + 1e-9; p += PITCH_STEP) {
    let c = 0;
    let s = 0;
    for (const x of xs) {
      c += Math.cos((2 * Math.PI * x) / p);
      s += Math.sin((2 * Math.PI * x) / p);
    }
    const r = Math.hypot(c, s) / xs.length;
    const better = !best || r > best.resultant + 0.02 || (r > best.resultant - 0.02 && Math.abs(p - GENERAL_PITCH) < Math.abs(best.pitchM - GENERAL_PITCH));
    if (better) best = { pitchM: p, resultant: r, phase: Math.atan2(s, c) };
  }
  // refine: least-squares pitch through the integer indices of the coarse fit
  const p0 = best.pitchM;
  const ph0 = ((best.phase / (2 * Math.PI)) * p0);
  const ks = xs.map((x) => Math.round((x - ph0) / p0));
  const kMean = ks.reduce((a, b) => a + b, 0) / ks.length;
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  let num = 0;
  let den = 0;
  ks.forEach((k, i) => {
    num += (k - kMean) * (xs[i] - xMean);
    den += (k - kMean) ** 2;
  });
  const pitchM = den > 0 ? num / den : p0;
  const phaseM = xMean - pitchM * kMean;
  return { pitchM: round(pitchM, 3), phaseM, resultant: round(best.resultant, 3) };
}

function huber(values) {
  let mu = median(values);
  for (let it = 0; it < 20; it += 1) {
    let num = 0;
    let den = 0;
    for (const v of values) {
      const r = v - mu;
      const w = Math.abs(r) <= HUBER_K ? 1 : HUBER_K / Math.abs(r);
      num += w * v;
      den += w;
    }
    const next = num / den;
    if (Math.abs(next - mu) < 1e-6) return next;
    mu = next;
  }
  return mu;
}

function inRing([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const luminance = (rgb, k) => 0.299 * rgb[3 * k] + 0.587 * rgb[3 * k + 1] + 0.114 * rgb[3 * k + 2];

function paintThreshold(win) {
  const lum = [];
  const step = Math.max(1, Math.floor((win.w * win.h) / 40000));
  for (let k = 0; k < win.w * win.h; k += step) if (!win.mask?.[k]) lum.push(luminance(win.rgb, k));
  return lum.length ? median(lum) + CONTRAST : Infinity;
}

const pixelOf = (win, [E, N]) => [Math.floor((E - win.origin[0]) / win.gsdM), Math.floor((win.origin[1] - N) / win.gsdM)];

// Bright, unmasked, connected photo components inside the lot, as pieces (rings of their pixel centres' hull box).
export function photoPieces(win, ring) {
  if (!win?.rgb) return [];
  const thr = paintThreshold(win);
  const seen = new Uint8Array(win.w * win.h);
  const out = [];
  for (let k = 0; k < win.w * win.h; k += 1) {
    if (seen[k] || win.mask?.[k] || luminance(win.rgb, k) < thr) continue;
    const stack = [k];
    seen[k] = 1;
    const pts = [];
    while (stack.length) {
      const q = stack.pop();
      const i = q % win.w;
      const j = (q - i) / win.w;
      pts.push([win.origin[0] + (i + 0.5) * win.gsdM, win.origin[1] - (j + 0.5) * win.gsdM]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= win.w || jj >= win.h) continue;
        const r = jj * win.w + ii;
        if (seen[r] || win.mask?.[r] || luminance(win.rgb, r) < thr) continue;
        seen[r] = 1;
        stack.push(r);
      }
    }
    if (pts.length < 6 || pts.length > 4000) continue;
    const box = orientedBox(pts);
    if (!inRing(box.centre, ring)) continue;
    const h = win.gsdM / 2;
    const L = box.halfLong + h;
    const S = box.halfShort + h;
    const c = box.centre;
    const corner = (sl, ss) => [c[0] + box.long[0] * sl * L + box.short[0] * ss * S, c[1] + box.long[1] * sl * L + box.short[1] * ss * S];
    out.push({ id: `photo@${round(c[0], 2)},${round(c[1], 2)}`, kind: "parking_line", ring: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] });
  }
  return out;
}

// Fallback when the photo's dividers merge into one blob through a painted back or end line: for every divider
// direction (1-degree steps), the bright fraction of the unmasked lot pixels is profiled across it in 0.1 m bins, and
// the direction with the strongest periodic profile (pitch 2.0-6.5 m) wins. Each profile peak on that comb becomes a
// divider piece spanning the 10th-90th percentile of its bright pixels along the direction.
export function profilePieces(win, ring) {
  if (!win?.rgb) return [];
  const thr = paintThreshold(win);
  const pts = [];
  for (let j = 0; j < win.h; j += 1) {
    for (let i = 0; i < win.w; i += 1) {
      const k = j * win.w + i;
      if (win.mask?.[k]) continue;
      const p = [win.origin[0] + (i + 0.5) * win.gsdM, win.origin[1] - (j + 0.5) * win.gsdM];
      if (inRing(p, ring)) pts.push({ p, bright: luminance(win.rgb, k) >= thr });
    }
  }
  if (pts.length < 50) return [];
  const BIN = 0.1;
  const fits = [];
  for (let deg = 0; deg < 180; deg += 1) {
    const n = [Math.cos(toRad(deg)), Math.sin(toRad(deg))];
    const a = [-n[1], n[0]];
    const bins = new Map();
    for (const { p, bright } of pts) {
      const b = Math.floor(dot(p, a) / BIN);
      const e = bins.get(b) ?? [0, 0];
      e[0] += 1;
      e[1] += bright ? 1 : 0;
      bins.set(b, e);
    }
    const prof = [...bins].filter(([, e]) => e[0] >= 3).map(([b, e]) => [(b + 0.5) * BIN, e[1] / e[0]]);
    const mean = prof.reduce((acc, [, f]) => acc + f, 0) / prof.length;
    let best = null;
    for (let pitch = PITCH_RANGE[0]; pitch <= PITCH_RANGE[1] + 1e-9; pitch += PITCH_STEP) {
      let c = 0;
      let sn = 0;
      for (const [x, f] of prof) {
        c += (f - mean) * Math.cos((2 * Math.PI * x) / pitch);
        sn += (f - mean) * Math.sin((2 * Math.PI * x) / pitch);
      }
      const score = Math.hypot(c, sn) / prof.length;
      if (!best || score > best.score) best = { score, pitch, phase: (Math.atan2(sn, c) / (2 * Math.PI)) * pitch };
    }
    fits.push({ ...best, n, a, prof, mean });
  }
  fits.sort((p, q) => q.score - p.score);
  // the strongest direction whose comb gives at least three dividers no longer than a stall (MAX_DEPTH_M)
  for (const { n, a, pitch, phase, prof, mean } of fits) {
    const xs = prof.map(([x]) => x);
    const out = [];
    for (let k = Math.ceil((Math.min(...xs) - phase) / pitch); phase + k * pitch <= Math.max(...xs); k += 1) {
      const x = phase + k * pitch;
      const near = prof.filter(([px]) => Math.abs(px - x) <= 0.15);
      if (!near.length || Math.max(...near.map(([, f]) => f)) < Math.max(0.2, 2 * mean)) continue;
      const ts = pts.filter(({ p, bright }) => bright && Math.abs(dot(p, a) - x) <= 0.15).map(({ p }) => dot(p, n)).sort((u, v) => u - v);
      if (ts.length < 4) continue;
      const t0 = ts[Math.floor(0.1 * (ts.length - 1))];
      const t1 = ts[Math.ceil(0.9 * (ts.length - 1))];
      if (t1 - t0 < 1.5 || t1 - t0 > MAX_DEPTH_M) continue;
      const at = (t, o) => [a[0] * (x + o) + n[0] * t, a[1] * (x + o) + n[1] * t];
      const mid = at((t0 + t1) / 2, 0);
      out.push({ id: `profile@${round(mid[0], 2)},${round(mid[1], 2)}`, kind: "parking_line", ring: [at(t0, -0.06), at(t0, 0.06), at(t1, 0.06), at(t1, -0.06)] });
    }
    if (out.length >= 3) return out;
  }
  return [];
}

// Paint support of one divider segment: { support, visible } over pixels within half a divider of the centre line.
function measure(win, thr, from, dir, lengthM) {
  if (!win?.rgb) return { support: 0, visible: 0 };
  const across = [-dir[1], dir[0]];
  const step = win.gsdM / 2;
  let total = 0;
  let open = 0;
  let paint = 0;
  const seen = new Set();
  for (let s = 0; s <= lengthM; s += step) {
    for (const o of [-0.05, 0, 0.05]) {
      const [i, j] = pixelOf(win, [from[0] + dir[0] * s + across[0] * o, from[1] + dir[1] * s + across[1] * o]);
      if (i < 0 || j < 0 || i >= win.w || j >= win.h) continue;
      const k = j * win.w + i;
      if (seen.has(k)) continue;
      seen.add(k);
      total += 1;
      if (win.mask?.[k]) continue;
      open += 1;
      if (luminance(win.rgb, k) >= thr) paint += 1;
    }
  }
  return { support: open ? paint / open : 0, visible: total ? open / total : 0 };
}

const dedupe = (cands) => {
  const out = [];
  for (const c of cands) if (!out.some((d) => Math.hypot(d.centre[0] - c.centre[0], d.centre[1] - c.centre[1]) < 0.5)) out.push(c);
  return out;
};

// One lot -> { id, parcel, rows, evidence, estimated }. backHint: [E, N] on the back side (a building centre or kerb).
export function proposeLot(lot, { pieces = [], window: win = null, backHint = null } = {}) {
  const inside = (p) => inRing(orientedBox(p.ring).centre, lot.ring);
  const local = pieces.filter(inside);
  let cands = dedupe([...dividerCandidates(local), ...dividerCandidates(photoPieces(win, lot.ring))]);
  if (cands.length < 2) cands = dedupe([...cands, ...dividerCandidates(profilePieces(win, lot.ring))]);
  const blue = local.filter((p) => p.kind === "disabled_parking");
  const none = (why) => ({ id: lot.id, parcel: lot.parcel ?? null, rows: [], evidence: { tier: "T4", refs: [why], photoSupport: null }, estimated: true });
  if (cands.length < 2) return none(`no divider paint outside the occlusion mask (${cands.length} candidate)`);

  const theta = toRad(dominantAngleDeg(cands));
  const n0 = [Math.cos(theta), Math.sin(theta)];
  // row axis, oriented east (north when exactly N-S) so stall indices run in a fixed direction
  const a0 = [-n0[1], n0[0]];
  const a = a0[0] > 1e-9 || (Math.abs(a0[0]) <= 1e-9 && a0[1] > 0) ? a0 : [-a0[0], -a0[1]];
  const aligned = cands.filter((c) => Math.abs(dot(c.long, n0)) >= Math.cos(toRad(1.5 * BIN_DEG)));
  if (aligned.length < 2) return none("fewer than two parallel divider candidates");
  // back side: toward the hint, else toward the lot centroid's far side (the side the ends cluster on)
  const centreT = aligned.reduce((s, c) => s + dot(c.centre, n0), 0) / aligned.length;
  const hintT = backHint ? dot(backHint, n0) : centreT + 1;
  const n = hintT >= centreT ? n0 : [-n0[0], -n0[1]]; // n points from the stalls toward the back line
  const thr = win?.rgb ? paintThreshold(win) : Infinity;

  const xs = aligned.map((c) => dot(c.centre, a));
  const { pitchM, phaseM } = estimatePitch(xs);
  const backT = huber(aligned.map((c) => dot(c.centre, n) + c.halfLong));
  const depthM = round(median(aligned.map((c) => c.lengthM)), 2);
  const widthM = round(Math.max(0.1, median(aligned.map((c) => c.widthM))), 2);
  const kMin = Math.min(...xs.map((x) => Math.round((x - phaseM) / pitchM)));
  const kMax = Math.max(...xs.map((x) => Math.round((x - phaseM) / pitchM)));
  const detected = new Set(xs.map((x) => Math.round((x - phaseM) / pitchM)));

  const at = (k) => {
    const x = phaseM + k * pitchM;
    const back = [a[0] * x + n[0] * backT, a[1] * x + n[1] * backT];
    const m = measure(win, thr, back, [-n[0], -n[1]], depthM);
    const occluded = m.visible < VISIBLE_FRACTION;
    const supported = detected.has(k) || (!occluded && m.support >= SUPPORTED);
    return { k, x, back, support: round(m.support, 3), occluded, supported, detected: detected.has(k) };
  };
  const positions = [];
  for (let k = kMin; k <= kMax; k += 1) positions.push(at(k));
  // extend past the detected span while the back line stays in the lot, until two visible positions show no paint
  for (const dir of [-1, 1]) {
    let misses = 0;
    for (let k = dir < 0 ? kMin - 1 : kMax + 1; misses < 2; k += dir) {
      const p = at(k);
      if (!inRing(p.back, lot.ring)) break;
      misses = !p.supported && !p.occluded ? misses + 1 : 0;
      if (dir < 0) positions.unshift(p);
      else positions.push(p);
    }
  }
  // split into rows at two or more visible unsupported positions in a row
  const segments = [];
  let cur = [];
  let gap = [];
  for (const p of positions) {
    if (p.supported || p.occluded) {
      if (gap.length >= 2 && cur.length) {
        segments.push(cur);
        cur = [];
      } else cur.push(...gap);
      gap = [];
      cur.push(p);
    } else gap.push(p);
  }
  if (cur.length) segments.push(cur);

  const rows = [];
  for (const seg0 of segments) {
    let seg = seg0;
    // drop visible empty ends; masked ends stay members of the row
    while (seg.length && !seg[0].supported && !seg[0].occluded) seg = seg.slice(1);
    while (seg.length && !seg[seg.length - 1].supported && !seg[seg.length - 1].occluded) seg = seg.slice(0, -1);
    if (seg.filter((p) => p.supported).length < 2) continue;
    const id = `${lot.id}/R${rows.length + 1}`;
    const visible = seg.filter((p) => !p.occluded);
    const photoSupport = round(median(visible.map((p) => (p.detected ? Math.max(p.support, 1) : p.support))) ?? 0, 3);
    const first = seg[0].back;
    const last = seg[seg.length - 1].back;
    const axis = [last[0] - first[0], last[1] - first[1]];
    const left = [-axis[1], axis[0]];
    const side = dot([-n[0], -n[1]], left) > 0 ? 1 : -1;
    const stalls = [];
    for (const b of blue) {
      const box = orientedBox(b.ring);
      const t = dot(box.centre, n);
      if (t > backT + 0.5 || t < backT - depthM - 0.5) continue;
      const xb = dot(box.centre, a);
      const index = Math.floor((xb - seg[0].x) / pitchM);
      if (index < 0 || index >= seg.length - 1) continue;
      const along = Math.abs(dot(box.long, a)) > Math.abs(dot(box.short, a)) ? 2 * box.halfLong : 2 * box.halfShort;
      if (stalls.some((s) => s.index === index)) continue;
      stalls.push(along >= ACCESSIBLE_WIDE_M
        ? { index, kind: "accessible", widthM: 3.3, aisle: null, symbol: "wheelchair", from: b.id }
        : { index, kind: "accessible", widthM: 2.5, aisle: { side: "end", widthM: 1.2 }, symbol: "wheelchair", from: b.id });
    }
    stalls.sort((p, q) => p.index - q.index);
    const det = seg.filter((p) => p.detected).length;
    const occ = seg.filter((p) => p.occluded).length;
    const tier = photoSupport >= 0.5 ? "T1" : "T2";
    rows.push({
      id,
      backLine: { abs: [first.map((v) => round(v, 3)), last.map((v) => round(v, 3))] },
      side,
      pitchM: round(pitchM, 3),
      depthM,
      startOffsetM: 0,
      count: seg.length,
      divider: { style: "single", widthM, colour: "white" },
      endCaps: false,
      stalls: stalls.map(({ from, ...s }) => s),
      wheelStops: null,
      entryFrom: "aisle",
      evidence: {
        tier,
        refs: [
          `photo dividers ${det}/${seg.length} detected, ${occ} under the occlusion mask, theta ${round(dominantAngleDeg(cands), 1)} deg`,
          ...stalls.map((s) => `blue ${s.from} -> stall ${s.index}`),
        ],
        photoSupport,
      },
      estimated: tier !== "T1",
      divisions: seg.map((p, i) => ({ index: i, support: p.support, occluded: p.occluded, detected: p.detected })),
    });
  }
  if (!rows.length) return none("no row with two supported dividers");
  return { id: lot.id, parcel: lot.parcel ?? null, rows, evidence: { tier: rows.every((r) => r.evidence.tier === "T1") ? "T1" : "T2", refs: [`${rows.length} rows proposed`], photoSupport: median(rows.map((r) => r.evidence.photoSupport)) }, estimated: rows.some((r) => r.estimated) };
}

// ---------------------------------------------------------------- CLI
// Lots the estimator knows by name: a ring in EPSG:5186 and the back hint (the wall the stall heads face).
export const LOTS = Object.freeze({
  // the stalls along the south-east face of E3 (site-detail SD-E3-W1, VR scene_e3 r) and the row south of them
  // band from 1.5 m behind to 7 m in front of the SD-E3-W1 line, from 16 m before its start (where trace MX01676 begins) to 4 m past its end; the E3 roof stays outside
  LOT_E3_S: { ring: [[243684.58, 263765.89], [243717.04, 263788.98], [243721.97, 263782.06], [243689.51, 263758.96]], backHint: [243693.61, 263783.37] },
});

async function cli(args) {
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const { readFileSync, writeFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { wgs84ToTm } = await import("../../../src/geo/epsg5186.mjs");
  const { openSheet, sheetWindowForTm } = await import("../lib/ngiiSheet.mjs");
  const { occlusionMask } = await import("../lib/occlusion.mjs");
  const { encodePng } = await import("../lib/png.mjs");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const data = path.join(here, "..", "data");
  const ids = (opt("--lot", Object.keys(LOTS).join(","))).split(",");
  const out = opt("--out", path.join(data, "ground", "parking.proposals.json"));
  const chips = opt("--chips", null);

  const read = (f) => JSON.parse(readFileSync(path.join(data, f), "utf8"));
  const features = [...read("photo/markings.geojson").features, ...read("photo/markings-extra.geojson").features]
    .filter((f) => ["parking_line", "disabled_parking"].includes(f.properties.kind) && f.geometry.type === "Polygon");
  const pieces = features.map((f) => ({ id: f.properties.id, kind: f.properties.kind, ring: f.geometry.coordinates[0].map(([lon, lat]) => wgs84ToTm(lon, lat)) }));
  const forms = read("building-forms.json");
  const leans = new Map(read("photo/building-lean.json").buildings.map((b) => [b.id, b.lean]));
  const buildings = forms.buildings.flatMap((b) => b.masses.map((m) => ({
    rings: [m.outer, ...(m.holes ?? [])].map((r) => r.map(([lon, lat]) => wgs84ToTm(lon, lat))),
    heightM: m.topMetres, lean: leans.get(b.key) ?? b.leanPrior,
  })));
  const trees = read("trees.json").trees.map(([east, north, crownDiameterM, heightM]) => ({ east, north, crownDiameterM, heightM }));

  const sheet = openSheet();
  const lots = [];
  const tiles = [];
  for (const id of ids) {
    const def = LOTS[id];
    if (!def) throw new Error(`unknown lot ${id} (known: ${Object.keys(LOTS).join(", ")})`);
    const xs = def.ring.map((p) => p[0]);
    const ys = def.ring.map((p) => p[1]);
    const E0 = Math.min(...xs) - 4;
    const N0 = Math.max(...ys) + 4;
    const wM = Math.max(...xs) + 4 - E0;
    const hM = N0 - (Math.min(...ys) - 4);
    const raw = sheetWindowForTm(sheet, E0, N0, wM, hM);
    const gsdM = Math.abs(sheet.tfw.a);
    const origin = [sheet.tfw.c - gsdM / 2 + raw.col0 * gsdM, sheet.tfw.f + gsdM / 2 - raw.row0 * gsdM];
    const geom = { w: raw.w, h: raw.h, origin, gsdM };
    const near = (b) => b.rings[0].some(([E, N]) => E > E0 - 60 && E < E0 + wM + 60 && N < N0 + 60 && N > N0 - hM - 60);
    const { any } = occlusionMask(geom, { buildings: buildings.filter(near), trees: trees.filter((t) => t.east > E0 - 20 && t.east < E0 + wM + 20 && t.north < N0 + 20 && t.north > N0 - hM - 20) });
    const win = { ...geom, rgb: raw.rgb, mask: any };
    const lot = proposeLot({ id, parcel: null, ring: def.ring }, { pieces, window: win, backHint: def.backHint });
    lots.push(lot);
    tiles.push({ win, lot, ring: def.ring });
    console.log(`LOT ${id}: ${lot.rows.length} rows ${lot.rows.map((r) => `${r.id} count ${r.count} pitch ${r.pitchM} support ${r.evidence.photoSupport} occluded ${r.divisions.filter((d) => d.occluded).length}`).join("; ")} tier ${lot.evidence.tier}`);
  }
  sheet.close();
  writeFileSync(out, `${JSON.stringify({ generated: "fit/parkingRows.mjs", note: "proposals: copy reviewed rows into parking.json by hand", lots }, null, 1)}\n`);
  console.log(`PROPOSALS ${out}`);
  if (chips) {
    const scale = 4;
    const sheets = tiles.map(({ win, lot, ring }) => chipImage(win, lot, ring, scale));
    const W = Math.max(...sheets.map((s) => s.w));
    const H = sheets.reduce((s, t) => s + t.h, 0);
    const rgb = new Uint8Array(W * H * 3);
    let y0 = 0;
    for (const s of sheets) {
      for (let y = 0; y < s.h; y += 1) rgb.set(s.rgb.subarray(y * s.w * 3, (y + 1) * s.w * 3), ((y0 + y) * W) * 3);
      y0 += s.h;
    }
    await Bun.write(chips, encodePng(W, H, 3, rgb));
    console.log(`CHIPS ${chips}`);
  }
}

// Photo (masked pixels tinted red) with the lot ring (yellow), proposed back line (cyan), dividers (green, magenta when
// under the mask) and accessible stalls (blue).
function chipImage(win, lot, ring, scale) {
  const w = win.w * scale;
  const h = win.h * scale;
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const k = Math.floor(y / scale) * win.w + Math.floor(x / scale);
      const o = (y * w + x) * 3;
      rgb[o] = win.mask[k] ? Math.min(255, win.rgb[3 * k] * 0.6 + 100) : win.rgb[3 * k];
      rgb[o + 1] = win.mask[k] ? win.rgb[3 * k + 1] * 0.6 : win.rgb[3 * k + 1];
      rgb[o + 2] = win.mask[k] ? win.rgb[3 * k + 2] * 0.6 : win.rgb[3 * k + 2];
    }
  }
  const px = ([E, N]) => [((E - win.origin[0]) / win.gsdM) * scale, ((win.origin[1] - N) / win.gsdM) * scale];
  const line = (p, q, c) => {
    const [ax, ay] = px(p);
    const [bx, by] = px(q);
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= steps; s += 1) {
      const x = Math.round(ax + ((bx - ax) * s) / steps);
      const y = Math.round(ay + ((by - ay) * s) / steps);
      if (x >= 0 && y >= 0 && x < w && y < h) rgb.set(c, (y * w + x) * 3);
    }
  };
  ring.forEach((p, i) => line(p, ring[(i + 1) % ring.length], [255, 225, 40]));
  for (const row of lot.rows) {
    const [b0, b1] = row.backLine.abs;
    line(b0, b1, [40, 230, 255]);
    const u = [(b1[0] - b0[0]) / Math.hypot(b1[0] - b0[0], b1[1] - b0[1]), (b1[1] - b0[1]) / Math.hypot(b1[0] - b0[0], b1[1] - b0[1])];
    const nrm = row.side > 0 ? [-u[1], u[0]] : [u[1], -u[0]];
    row.divisions.forEach((d, i) => {
      const p = [b0[0] + u[0] * i * row.pitchM, b0[1] + u[1] * i * row.pitchM];
      line(p, [p[0] + nrm[0] * row.depthM, p[1] + nrm[1] * row.depthM], d.occluded ? [255, 60, 255] : [60, 255, 60]);
    });
    for (const s of row.stalls) {
      const p = [b0[0] + u[0] * (s.index + 0.5) * row.pitchM, b0[1] + u[1] * (s.index + 0.5) * row.pitchM];
      line(p, [p[0] + nrm[0] * row.depthM, p[1] + nrm[1] * row.depthM], [40, 90, 255]);
    }
  }
  return { w, h, rgb };
}

if (import.meta.main) await cli(process.argv.slice(2));

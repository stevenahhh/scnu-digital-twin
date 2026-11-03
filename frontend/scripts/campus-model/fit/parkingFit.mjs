#!/usr/bin/env bun
// Parking row measurer (plan campus-ground-truth-redesign todo 14): reads raw NGII pixels along a row's own axis, so a curator's
// record in data/ground/parking-curation.json can be measured and checked again. It writes nothing; a person decides what goes in
// the file. The rule behind walkRow: a car, a crown or shade is not the end of a row. A row runs on while paint resumes at its pitch;
// the places in between are recorded as read by nobody, and only paint that never resumes ends it.
//
//   bun scripts/campus-model/fit/parkingFit.mjs --ends [--parking <file>]      how far the photo's paint runs past both ends of every row
//   bun scripts/campus-model/fit/parkingFit.mjs --rails [--parking <file>]     drawn end lines against the rail the photo shows
//   bun scripts/campus-model/fit/parkingFit.mjs --measure E,N E,N side depth    line peaks and rails along a rough axis
//
// A raster is { w, h, origin: [E, N] of the top-left corner, gsdM, rgb }; a frame is stages/parking.mjs rowFrame's { a, d, at(s, t) }.
const median = (list) => { const s = list.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const round = (v, k = 2) => Math.round(v * 10 ** k) / 10 ** k;

export function rgbAt(win, [E, N]) {
  const x = (E - win.origin[0]) / win.gsdM - 0.5;
  const y = (win.origin[1] - N) / win.gsdM - 0.5;
  const [i, j] = [Math.floor(x), Math.floor(y)];
  if (i < 0 || j < 0 || i + 1 >= win.w || j + 1 >= win.h) return null;
  const [fx, fy, k] = [x - i, y - j, j * win.w + i];
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) out[c] = (win.rgb[3 * k + c] * (1 - fx) + win.rgb[3 * (k + 1) + c] * fx) * (1 - fy) + (win.rgb[3 * (k + win.w) + c] * (1 - fx) + win.rgb[3 * (k + win.w + 1) + c] * fx) * fy;
  return out;
}
export const lumAt = (win, P) => { const c = rgbAt(win, P); return c ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] : null; };

// Peaks of a profile [{ x, v }]: centre at half height, prominence over the lower side within reach, width at half height.
export function peaks(prof, minProm, reachM = 0.8) {
  if (prof.length < 3) return [];
  const step = prof[1].x - prof[0].x;
  const reach = Math.round(reachM / step);
  const out = [];
  for (let i = 1; i + 1 < prof.length; i += 1) {
    const { v } = prof[i];
    if (!(v >= prof[i - 1].v && v > prof[i + 1].v)) continue;
    const prom = v - Math.max(Math.min(...prof.slice(Math.max(0, i - reach), i).map((p) => p.v)), Math.min(...prof.slice(i + 1, i + 1 + reach).map((p) => p.v)));
    if (prom < minProm) continue;
    const half = v - prom / 2;
    let [a, b] = [i, i];
    while (a > 0 && prof[a - 1].v >= half) a -= 1;
    while (b + 1 < prof.length && prof[b + 1].v >= half) b += 1;
    out.push({ x: round((prof[a].x + prof[b].x) / 2), prom: round(prom, 1), w: round(prof[b].x - prof[a].x) });
  }
  return out;
}
const across = (win, f, s0, s1, lo, hi) => { const out = []; for (let t = lo; t <= hi + 1e-9; t += 0.05) { const vs = []; for (let s = s0; s <= s1 + 1e-9; s += 0.15) vs.push(lumAt(win, f.at(s, t))); const m = median(vs); if (m !== null) out.push({ x: round(t, 3), v: m }); } return out; };
export const along = (win, f, t0, t1, lo, hi) => { const out = []; for (let s = lo; s <= hi + 1e-9; s += 0.05) { const vs = []; for (let t = t0; t <= t1 + 1e-9; t += 0.15) vs.push(lumAt(win, f.at(s, t))); const m = median(vs); if (m !== null) out.push({ x: round(s, 3), v: m }); } return out; };

// A painted line at place s: a thin ridge brighter than the ground on BOTH sides, over most of the depth. A car's flank is a step.
export function ridgeAt(win, f, s, t0, t1, { reach = 0.4, side = 0.55 } = {}) {
  const ts = [];
  for (let t = t0; t <= t1 + 1e-9; t += 0.2) ts.push(t);
  const level = (o) => median(ts.map((t) => lumAt(win, f.at(s + o, t))));
  let best = { contrast: -Infinity, o: 0 };
  for (let o = -reach; o <= reach + 1e-9; o += 0.05) {
    const [v, l, r] = [level(o), level(o - side), level(o + side)];
    if (v !== null && l !== null && r !== null && v - Math.max(l, r) > best.contrast) best = { contrast: v - Math.max(l, r), o };
  }
  if (!Number.isFinite(best.contrast)) return { contrast: null, o: 0, cover: 0, rel: null };
  const base = Math.max(level(best.o - side) ?? 0, level(best.o + side) ?? 0);
  let on = 0;
  for (const t of ts) {
    const v = Math.max(...[-0.05, 0, 0.05].map((d) => lumAt(win, f.at(s + best.o + d, t)) ?? -1));
    const [l, r] = [lumAt(win, f.at(s + best.o - side, t)), lumAt(win, f.at(s + best.o + side, t))];
    if (l !== null && r !== null && v - Math.max(l, r) >= Math.max(3, Math.min(6, 0.1 * base))) on += 1; // shade lowers every contrast
  }
  return { contrast: round(best.contrast, 1), o: round(best.o), cover: round(on / ts.length), rel: base ? round(best.contrast / base, 3) : null };
}
export const isLine = (r) => r.contrast !== null && r.cover >= 0.5 && (r.contrast >= 6 || (r.contrast >= 3 && r.rel >= 0.1));

// The rail nearest T over a span of the row: its offset from T and its prominence, or null.
export function railAt(win, f, s0, s1, T, { reach = 0.8, minProm = 4 } = {}) {
  const [lo, hi] = [Math.min(s0, s1) + 0.3, Math.max(s0, s1) - 0.3];
  if (hi - lo < 0.4) return null;
  const [p] = peaks(across(win, f, lo, hi, T - reach - 0.4, T + reach + 0.4), minProm, 0.5).filter((x) => Math.abs(x.x - T) <= reach && x.w <= 0.9).sort((x, y) => Math.abs(x.x - T) - Math.abs(y.x - T));
  return p ? { off: round(p.x - T), prom: p.prom } : null;
}

// One pitch at a time from a known line. A line or both rails over the stall is paint. Anything else is unknown (a car, a crown,
// shade): it stays pending and joins the row only if paint resumes within maxUnknown pitches. stop(P) -> reason ends the walk at a
// place the row may not enter (another row, the model extent). A row with rails is bounded by them: where both stop, a line alone
// does not carry it, because a truck's flank reads as a line (E243647/R1 crossed one and merged two rows).
export function walkRow(win, f, { from, dir, pitch, depth, stop = () => null, maxUnknown = 2, maxSteps = 40 }) {
  const trim = Math.min(0.5, depth * 0.15);
  const added = [];
  let pending = [];
  let at = from;
  const railOver = (s0, s1) => Boolean(railAt(win, f, s0, s1, 0, { reach: 0.4, minProm: 8 }) || railAt(win, f, s0, s1, depth, { reach: 0.4, minProm: 8 }));
  const railed = railOver(from - dir * pitch, from);
  for (let k = 0; k < maxSteps; k += 1) {
    const guess = at + dir * pitch;
    const reason = stop(f.at(guess, depth / 2));
    if (reason) return { added, stop: reason };
    const line = ridgeAt(win, f, guess, trim, depth - trim);
    if (isLine(line) && (!railed || railOver(at, guess))) {
      added.push(...pending, { s: round(guess + line.o), read: "line", contrast: line.contrast, cover: line.cover });
      pending = [];
      at = guess + line.o;
      continue;
    }
    const rails = railAt(win, f, at, guess, 0, { reach: 0.4, minProm: 8 }) && railAt(win, f, at, guess, depth, { reach: 0.4, minProm: 8 });
    if (rails) {
      added.push(...pending, { s: round(guess), read: "rails" });
      pending = [];
      at = guess;
      continue;
    }
    pending.push({ s: round(guess), read: "unknown" });
    at = guess;
    if (pending.length > maxUnknown) return { added, stop: `no paint for ${pending.length} pitches` };
  }
  return { added, stop: `no paint after ${maxSteps} steps` };
}

// Places along a row -> its pitch, count and exception stalls (exceptions only, as parking.json keeps them).
export function placesToRow(places, { drift = 0.12 } = {}) {
  const gaps = places.slice(1).map((v, i) => v - places[i]);
  const pitchM = round(median(gaps), 4);
  const stalls = [];
  let drawn = places[0];
  gaps.forEach((g, i) => {
    if (Math.abs(drawn + pitchM - places[i + 1]) > drift) { stalls.push({ index: i, kind: "general", widthM: round(places[i + 1] - drawn, 3) }); drawn = places[i + 1]; } else drawn += pitchM;
  });
  return { pitchM, count: places.length, stalls };
}

// ---------------------------------------------------------------- blue paint
export const isBlue = ([r, g, b]) => b - r >= 28 && b >= 1.6 * r && b >= g + 8;
// The tightest box around points: sweep the angle, keep the smallest area.
export function oriented(points) {
  let best = null;
  for (let deg = 0; deg < 90; deg += 1) {
    const th = (deg * Math.PI) / 180;
    const [u, v] = [[Math.cos(th), Math.sin(th)], [-Math.sin(th), Math.cos(th)]];
    const us = points.map((p) => p[0] * u[0] + p[1] * u[1]);
    const vs = points.map((p) => p[0] * v[0] + p[1] * v[1]);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) best = { area, u, v, u0, u1, v0, v1 };
  }
  const [lu, lv] = [best.u1 - best.u0, best.v1 - best.v0];
  const centre = [((best.u0 + best.u1) / 2) * best.u[0] + ((best.v0 + best.v1) / 2) * best.v[0], ((best.u0 + best.u1) / 2) * best.u[1] + ((best.v0 + best.v1) / 2) * best.v[1]];
  return { centre, long: Math.max(lu, lv), short: Math.min(lu, lv), longDir: lu >= lv ? best.u : best.v, shortDir: lu >= lv ? best.v : best.u };
}
// The blue patch at P (nearest blue pixel within reachM, grown over gaps of two pixels so that a symbol does not split it).
export function blueBlob(win, P, { reachM = 2, maxM2 = 60, gapPx = 2, minDiff = null, erodePx = 0 } = {}) {
  const { w, h, gsdM, origin, rgb } = win;
  // minDiff: blue over red for a sunlit bay, where a hatch or the shade beside it would join a looser test
  const raw = (k) => (minDiff === null ? isBlue([rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]]) : rgb[3 * k + 2] - rgb[3 * k] >= minDiff);
  // erodePx: a pixel counts only with all its neighbours, so the thin blue stripes of a hatch do not join two bays
  const blue = (k) => { if (!erodePx) return raw(k); const [x, y] = [k % w, Math.floor(k / w)]; for (let dy = -erodePx; dy <= erodePx; dy += 1) for (let dx = -erodePx; dx <= erodePx; dx += 1) { const n = (y + dy) * w + x + dx; if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h || !raw(n)) return false; } return true; };
  const [ci, cj] = [Math.floor((P[0] - origin[0]) / gsdM), Math.floor((origin[1] - P[1]) / gsdM)];
  const reach = Math.round(reachM / gsdM);
  let seed = -1;
  let bestD = Infinity;
  for (let j = Math.max(0, cj - reach); j <= Math.min(h - 1, cj + reach); j += 1) for (let i = Math.max(0, ci - reach); i <= Math.min(w - 1, ci + reach); i += 1) { const k = j * w + i; const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bestD && blue(k)) { bestD = d; seed = k; } }
  if (seed < 0) return null;
  const seen = new Set([seed]);
  const stack = [seed];
  const pts = [];
  while (stack.length) {
    const q = stack.pop();
    const [x, y] = [q % w, Math.floor(q / w)];
    pts.push([origin[0] + (x + 0.5) * gsdM, origin[1] - (y + 0.5) * gsdM]);
    if (pts.length * gsdM * gsdM > maxM2) break;
    for (let dy = -gapPx; dy <= gapPx; dy += 1) for (let dx = -gapPx; dx <= gapPx; dx += 1) { const [nx, ny] = [x + dx, y + dy]; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const n = ny * w + nx; if (!seen.has(n) && blue(n)) { seen.add(n); stack.push(n); } }
  }
  if (pts.length < 8) return null;
  const box = oriented(pts);
  const grow = 2 * erodePx * gsdM;
  return { area: round(pts.length * gsdM * gsdM, 1), points: pts, ...box, long: box.long + grow, short: box.short + grow };
}

// A ladder from a rough axis along its back rail: the direction its lines run (the sharpest profile over a sweep), their places, and
// the rails. side and frame as in stages/parking.mjs: t runs from the back rail towards the aisle.
const frameFor = (p, q, side, bearingDeg) => {
  const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const a = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
  const th = bearingDeg === undefined ? null : (bearingDeg * Math.PI) / 180;
  const d = th === null ? [-a[1] * side, a[0] * side] : [Math.sin(th), Math.cos(th)];
  return { a, d, length, at: (s, t) => [p[0] + a[0] * s + d[0] * t, p[1] + a[1] * s + d[1] * t] };
};
export const bearingOf = ([E, N]) => (((Math.atan2(E, N) * 180) / Math.PI) + 360) % 360;
export function measureLadder(win, { p, q, side, depth, pitch = 2.6, bearingDeg, sweep = 40, reach = 1.5, minProm = 6, lo = -reach, hi = null }) {
  const base = frameFor(p, q, side, bearingDeg);
  const trim = Math.min(0.5, depth * 0.15);
  let bestDeg = bearingDeg ?? bearingOf(base.d);
  if (bearingDeg === undefined) {
    let best = -1;
    const start = bearingOf(base.d);
    for (let deg = -sweep; deg <= sweep; deg += 1) {
      const prof = along(win, frameFor(p, q, side, start + deg), trim, depth - trim, -0.5, base.length + 0.5);
      let score = 0;
      for (let i = 6; i + 6 < prof.length; i += 1) score += Math.max(0, prof[i].v - (prof[i - 6].v + prof[i + 6].v) / 2) ** 2;
      score *= 1 - Math.abs(deg) * 0.004;
      if (score > best) { best = score; bestDeg = start + deg; }
    }
  }
  const f = frameFor(p, q, side, bestDeg);
  const end = hi ?? base.length + reach;
  const lines = peaks(along(win, f, trim, depth - trim, lo, end), minProm).filter((x) => x.w <= 0.8).filter((x) => isLine(ridgeAt(win, f, x.x, trim, depth - trim, { reach: 0.1 })));
  const kept = [];
  for (const x of [...lines].sort((m, n) => n.prom - m.prom)) if (!kept.some((k) => Math.abs(k.x - x.x) < 1.7)) kept.push(x);
  kept.sort((m, n) => m.x - n.x);
  const places = [];
  kept.forEach((x, i) => {
    if (i) { const gap = x.x - kept[i - 1].x; const n = Math.round(gap / pitch); if (n >= 2 && Math.abs(gap / n - pitch) <= 0.45) for (let m = 1; m < n; m += 1) places.push({ s: round(kept[i - 1].x + (gap * m) / n), read: "unknown" }); }
    places.push({ s: x.x, read: "line" });
  });
  const rail = (T) => { const spans = places.slice(1).map((v, i) => railAt(win, f, places[i].s, v.s, T, { reach: 1, minProm: 5 })); const off = median(spans.map((r) => r?.off ?? null)); return { off, share: spans.length ? spans.filter(Boolean).length / spans.length : 0 }; };
  const [b, ft] = [rail(0), rail(depth)];
  return { bearingDeg: round(bestDeg, 2), frame: f, places, tBack: round(b.off ?? 0), tFront: round(depth + (ft.off ?? 0)), back: b.share >= 0.5, front: ft.share >= 0.5 };
}

// A bay read from its blue: blob, plus the white hatch beside it if a side has one. The box is the blue plus its border; the depth is
// the long way of the whole bay. aisleDir points from the blue to the hatch.
const BORDER_M = 0.12;
export function measureBay(win, P, opts = {}) {
  const blob = blueBlob(win, P, opts);
  if (!blob) return null;
  const { centre, long, short, longDir, shortDir } = blob;
  const ring = [];
  for (let th = 0; th < 6.28; th += 0.2) ring.push(lumAt(win, [centre[0] + Math.cos(th) * (long / 2 + 3), centre[1] + Math.sin(th) * (long / 2 + 3)]));
  const ground = median(ring) ?? 0;
  const hatchWidth = (dir, half, span, spanDir) => {
    let width = 0;
    // stripes: along the band the brightness keeps changing; plain concrete or asphalt, bright or dark, does not
    for (let o = 0.25; o <= 2.2; o += 0.25) {
      const vs = [];
      for (let u = -span / 2 + 0.2; u <= span / 2 - 0.2; u += 0.25) vs.push(lumAt(win, [centre[0] + dir[0] * (half + o) + spanDir[0] * u, centre[1] + dir[1] * (half + o) + spanDir[1] * u]));
      const known = vs.filter((v) => v !== null);
      if (known.length < 4) break;
      const change = known.slice(1).reduce((n, v, i) => n + Math.abs(v - known[i]), 0) / (known.length - 1);
      if (change < Math.max(9, 0.09 * ground)) break;
      width = o;
    }
    return width >= 0.6 ? round(width + 0.12) : 0;
  };
  const neg = (v) => [-v[0], -v[1]];
  const sides = [[shortDir, short / 2, long, longDir], [neg(shortDir), short / 2, long, longDir], [longDir, long / 2, short, shortDir], [neg(longDir), long / 2, short, shortDir]].map(([dir, half, span, spanDir]) => ({ dir, width: hatchWidth(dir, half, span, spanDir) }));
  const best = [...sides].sort((m, n) => n.width - m.width)[0];
  const aisle = best.width > 0 ? best : null;
  const across = aisle && Math.abs(aisle.dir[0] * shortDir[0] + aisle.dir[1] * shortDir[1]) > 0.7;
  const [widthM, depthM] = [short + 2 * BORDER_M + (aisle && across ? aisle.width : 0), long + 2 * BORDER_M + (aisle && !across ? aisle.width : 0)];
  const shift = aisle ? aisle.width / 2 : 0;
  const c = aisle ? [centre[0] + aisle.dir[0] * shift, centre[1] + aisle.dir[1] * shift] : centre;
  return { centre: c.map((v) => round(v, 3)), widthM: round(widthM), depthM: round(depthM), widthDir: shortDir, depthDir: longDir, aisleWidthM: aisle?.width ?? 0, aisleDir: aisle?.dir ?? null, blueM: [round(short), round(long)], area: blob.area };
}

// A rough box { c, th (radians of its w axis from east), w, d } moved onto the paint by coordinate descent on IoU, within reach.
export function fitBox(on, box, { gsdM = 0.25, reachM = 0.7, reachDeg = 10 } = {}) {
  const iou = (b) => {
    const r = Math.hypot(b.w, b.d) / 2 + 1;
    const u = [Math.cos(b.th), Math.sin(b.th)];
    let [both, union] = [0, 0];
    for (let x = b.c[0] - r; x <= b.c[0] + r; x += gsdM) for (let y = b.c[1] - r; y <= b.c[1] + r; y += gsdM) {
      const [dx, dy] = [x - b.c[0], y - b.c[1]];
      const inside = Math.abs(dx * u[0] + dy * u[1]) <= b.w / 2 && Math.abs(-dx * u[1] + dy * u[0]) <= b.d / 2;
      const paint = on([x, y]);
      if (inside && paint) both += 1;
      if (inside || paint) union += 1;
    }
    return union ? both / union : 0;
  };
  const start = { ...box, c: [...box.c] };
  let best = { ...start, iou: iou(start) };
  const bound = (b) => Math.hypot(b.c[0] - start.c[0], b.c[1] - start.c[1]) <= reachM && Math.abs(b.th - start.th) <= (reachDeg * Math.PI) / 180 && Math.abs(b.w - start.w) <= reachM && Math.abs(b.d - start.d) <= reachM;
  for (const [step, turn] of [[0.2, 0.05], [0.1, 0.025], [0.05, 0.012]]) {
    for (let moved = true, n = 0; moved && n < 30; n += 1) {
      moved = false;
      for (const change of [{ x: step }, { x: -step }, { y: step }, { y: -step }, { th: turn }, { th: -turn }, { w: step }, { w: -step }, { d: step }, { d: -step }]) {
        const next = { c: [best.c[0] + (change.x ?? 0), best.c[1] + (change.y ?? 0)], th: best.th + (change.th ?? 0), w: best.w + (change.w ?? 0), d: best.d + (change.d ?? 0) };
        if (!bound(next)) continue;
        const score = iou(next);
        if (score > best.iou + 1e-6) { best = { ...next, iou: score }; moved = true; }
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- CLI
async function cli(args) {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { rowFrame, rowLayout } = await import("../stages/parking.mjs");
  const { tmToScene } = await import("../../../src/geo/epsg5186.mjs");
  const { inMarkingExtent } = await import("../stages/markings.mjs");
  const { openSheet, sheetWindowForTm } = await import("../lib/ngiiSheet.mjs");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const doc = JSON.parse(readFileSync(opt("--parking", path.join(here, "..", "data", "ground", "parking.json")), "utf8"));
  const sheet = openSheet();
  const [E0, N1, wM, hM] = [243416, 264101.25, 877, 712.5];
  const raw = sheetWindowForTm(sheet, E0, N1, wM, hM);
  const gsdM = Math.abs(sheet.tfw.a);
  const win = { w: raw.w, h: raw.h, gsdM, rgb: raw.rgb, origin: [sheet.tfw.c - gsdM / 2 + raw.col0 * gsdM, sheet.tfw.f + gsdM / 2 - raw.row0 * gsdM] };
  sheet.close();
  if (args.includes("--measure")) {
    const i = args.indexOf("--measure");
    const [p, q] = [args[i + 1], args[i + 2]].map((v) => v.split(",").map(Number));
    const [side, depth] = [Number(args[i + 3]), Number(args[i + 4])];
    const f = rowFrame({ backLine: { abs: [p, q] }, side, dividerBearingDeg: opt("--bearing") ? Number(opt("--bearing")) : undefined }, null);
    console.log(`lines ${peaks(along(win, f, depth * 0.15, depth * 0.85, -4, f.length + 4), 5).map((x) => `${x.x}(${x.prom})`).join(" ")}`);
    console.log(`rails ${peaks(across(win, f, 0, f.length, -2, depth + 2), 4).map((x) => `${x.x}(${x.prom})`).join(" ")}`);
    return;
  }
  const rows = doc.lots.flatMap((lot) => lot.rows).map((row) => { const f = rowFrame(row, null); const { dividers, cells } = rowLayout(row, f.length); return { row, f, dividers, cells, a: dividers[0].s, b: dividers.at(-1).s }; });
  if (args.includes("--ends")) {
    const inRow = (x, P) => { const v = [P[0] - x.f.at(0, 0)[0], P[1] - x.f.at(0, 0)[1]]; const det = x.f.a[0] * x.f.d[1] - x.f.a[1] * x.f.d[0]; const s = (v[0] * x.f.d[1] - v[1] * x.f.d[0]) / det; const t = (x.f.a[0] * v[1] - x.f.a[1] * v[0]) / det; return s >= x.a - 0.15 && s <= x.b + 0.15 && t >= -0.1 && t <= x.row.depthM + 0.1; };
    for (const x of rows) {
      const general = x.cells.filter((c) => !c.stall || c.stall.kind === "general").map((c) => c.s1 - c.s0);
      const pitch = median(general) ?? x.row.pitchM;
      if (!(pitch >= 2 && pitch <= 4) || x.row.depthM < 3) continue;
      const stop = (P) => { if (!inMarkingExtent(tmToScene(P[0], P[1]))) return "model extent"; const other = rows.find((y) => y !== x && inRow(y, P)); return other ? `row ${other.row.id}` : null; };
      for (const [name, dir, from] of [["start", -1, x.a], ["end", 1, x.b]]) {
        const { added, stop: why } = walkRow(win, x.f, { from, dir, pitch, depth: x.row.depthM, stop });
        if (added.length) console.log(`${x.row.id} ${name} +${added.length} [${why}] ${added.map((p) => `${p.s}${p.read === "line" ? "" : `(${p.read})`}`).join(" ")}`);
      }
    }
  }
  if (args.includes("--rails")) {
    for (const x of rows) {
      const read = (T) => median(x.cells.filter((c) => c.s1 - c.s0 >= 1.2).map((c) => railAt(win, x.f, c.s0, c.s1, T)?.off ?? null));
      const [back, front] = [read(0), read(x.row.depthM)];
      if ((x.row.paintBack && Math.abs(back ?? 0) >= 0.3) || (x.row.paintFront && Math.abs(front ?? 0) >= 0.3)) console.log(`${x.row.id} back ${back} front ${front}`);
    }
  }
}
if (import.meta.main) await cli(process.argv.slice(2));

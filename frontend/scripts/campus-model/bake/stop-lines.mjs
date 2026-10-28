#!/usr/bin/env bun
// Stop lines joined to lane lines (the "Γ" corners at junction mouths) read on the NGII 2025 orthophoto.
//
// data/photo/stop-lines-review.json lists, by eye, a point on each such corner the traces miss (each with its junction
// and reason). Around each point the white paint (qa/photoPaint.mjs) of the blob nearest the point gives the two line
// directions (the sharpest local maxima of the projection histograms, at least 60 deg apart); along each direction the
// strongest paint line, its extent (2nd-98th percentile of the paint within 0.3 m of it) and its photo width. The wider
// stroke is the stop line (정지선 530, drawn on its standard width), the narrower the lane line it meets (차선, solid).
// Output: data/photo/stop-lines.json (WGS84), drawn by stages/markingsRegular.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geoToModel, modelToGeo, SCENE_UNITS_PER_METRE as U } from "../lib/frame.mjs";
import { paintIn } from "../../qa/photoPaint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data", "photo");
const review = JSON.parse(readFileSync(path.join(DATA, "stop-lines-review.json"), "utf8")).corners;
const toM = ([lon, lat]) => geoToModel(lon, lat).map((v) => v / U);
const toGeo = ([x, z]) => modelToGeo(x * U, z * U).map((v) => +v.toFixed(8));

const out = [];
for (const c of review) {
  const q = toM(c.near);
  const { blobs } = paintIn([q[0] - 5, q[1] - 5, q[0] + 5, q[1] + 5]);
  const near = blobs.filter((b) => b.colour === "white" && b.type !== "car")
    .map((b) => ({ b, d: Math.min(...b.pts.map((p) => Math.hypot(p[0] - q[0], p[1] - q[1]))) }))
    .filter((x) => x.d <= 1.5).sort((a, b) => b.b.pts.length - a.b.pts.length);
  if (!near.length) { console.log(`${c.id}: no white paint within 1.5 m`); continue; }
  const px = near[0].b.pts;
  const sharp = (deg) => {
    const a = (deg * Math.PI) / 180, n = [-Math.sin(a), Math.cos(a)];
    const h = new Map();
    for (const p of px) { const k = Math.round((p[0] * n[0] + p[1] * n[1]) / 0.1); h.set(k, (h.get(k) ?? 0) + 1); }
    let s = 0;
    for (const v of h.values()) s += v * v;
    return s;
  };
  const all = Array.from({ length: 180 }, (_, d) => ({ d, s: sharp(d) }));
  const peaks = all.filter((x) => [1, 2, 3, 4].every((k) => x.s >= all[(x.d + k) % 180].s && x.s >= all[(x.d - k + 180) % 180].s)).sort((a, b) => b.s - a.s);
  const first = peaks[0];
  const second = peaks.find((x) => Math.min(Math.abs(x.d - first.d), 180 - Math.abs(x.d - first.d)) >= 60);
  const lines = [];
  for (const pk of [first, second].filter(Boolean)) {
    const a = (pk.d * Math.PI) / 180, d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
    const h = new Map();
    for (const p of px) { const k = Math.round((p[0] * n[0] + p[1] * n[1]) / 0.05); h.set(k, (h.get(k) ?? 0) + 1); }
    let best = null;
    for (const k of h.keys()) { const v = (h.get(k - 1) ?? 0) + h.get(k) + (h.get(k + 1) ?? 0); if (!best || v > best.v) best = { k, v }; }
    const off = best.k * 0.05;
    const on = px.filter((p) => Math.abs(p[0] * n[0] + p[1] * n[1] - off) <= 0.3);
    if (on.length < 6) continue;
    const s = on.map((p) => p[0] * d[0] + p[1] * d[1]).sort((x, y) => x - y);
    const s0 = s[Math.floor(s.length * 0.02)], s1 = s[Math.floor(s.length * 0.98)];
    if (s1 - s0 < 1) continue;
    const t = on.map((p) => p[0] * n[0] + p[1] * n[1] - off);
    const width = 2 * Math.sqrt(t.reduce((acc, v) => acc + v * v, 0) / t.length) * Math.sqrt(3) + 0.25 / Math.sqrt(3);
    const P = (sv) => [d[0] * sv + n[0] * off, d[1] * sv + n[1] * off];
    lines.push({ a: P(s0), b: P(s1), width, length: s1 - s0 });
  }
  if (!lines.length) { console.log(`${c.id}: no straight stroke read`); continue; }
  lines.sort((x, y) => y.width - x.width);
  lines.forEach((l, i) => {
    const kind = i === 0 && lines.length > 1 ? "stop_line" : "lane_line_solid";
    out.push({ id: `${c.id}-${kind === "stop_line" ? "S" : "L"}`, kind, a: toGeo(l.a), b: toGeo(l.b), photoWidthM: +l.width.toFixed(2), lengthM: +l.length.toFixed(2), junction: c.junction, evidence: `NGII 34702020 white paint at ${c.id} (by-eye corner)` });
  });
  console.log(`${c.id} (${c.junction}): ${lines.map((l, i) => `${i === 0 && lines.length > 1 ? "stop" : "lane"} ${l.length.toFixed(1)} m, photo width ${l.width.toFixed(2)} m`).join("; ")}`);
}
writeFileSync(path.join(DATA, "stop-lines.json"), `${JSON.stringify({ source: "NGII 2025 orthophoto 34702020 (bake/stop-lines.mjs)", lines: out }, null, 1)}\n`);
console.log(`${out.length} lines -> data/photo/stop-lines.json`);

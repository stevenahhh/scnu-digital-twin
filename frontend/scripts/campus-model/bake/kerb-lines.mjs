#!/usr/bin/env bun
// Yellow kerb lines (정차·주차금지 kerb paint, the curved runs road-lines.mjs cannot link) read on the NGII 2025 orthophoto
// along the surveyed sidewalk outlines (A003): every outline is walked at STEP_M, and a sample counts as painted when
// yellow paint (qa/photoPaint.mjs) lies within HIT_M of a point 0.1-0.7 m off the outline (either side, walked apart). Runs of painted samples at least RUN_MIN_M long that bend (turning over BEND_DEG in total:
// the straight runs are road-lines.mjs's) and keep CLEAR_M from its yellow lines are written, simplified within 0.1 m,
// to data/photo/kerb-lines.json (WGS84) and drawn on the no_parking_line template by stages/markingsRegular.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geoToModel, modelToGeo, EXTENT, SCENE_UNITS_PER_METRE as U } from "../lib/frame.mjs";
import { readA003 } from "../lib/a003.mjs";
import { paintIn } from "../../qa/photoPaint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data", "photo");
const STEP_M = 0.5, OFFSET_M = 0.3, HIT_M = 0.25, RUN_MIN_M = 4, BEND_DEG = 20, CLEAR_M = 0.8;
const toM = ([lon, lat]) => geoToModel(lon, lat).map((v) => v / U);
const toGeo = ([x, z]) => modelToGeo(x * U, z * U).map((v) => +v.toFixed(8));
const roadYellow = JSON.parse(readFileSync(path.join(DATA, "road-lines.json"), "utf8")).lines.filter((l) => l.colour === "yellow").map((l) => l.points.map(toM));
const segDist = (q, a, b) => { const ab = [b[0] - a[0], b[1] - a[1]]; const l2 = ab[0] ** 2 + ab[1] ** 2 || 1e-9; const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / l2)); return Math.hypot(q[0] - a[0] - t * ab[0], q[1] - a[1] - t * ab[1]); };
const nearRoadYellow = (q) => roadYellow.some((pl) => pl.some((p, i) => i > 0 && segDist(q, pl[i - 1], p) <= CLEAR_M));
const simplify = (pts, tol) => {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts.at(-1)];
  let k = -1, m = 0;
  for (let i = 1; i < pts.length - 1; i += 1) { const d = segDist(pts[i], a, b); if (d > m) { m = d; k = i; } }
  return m > tol ? [...simplify(pts.slice(0, k + 1), tol).slice(0, -1), ...simplify(pts.slice(k), tol)] : [a, b];
};
const ext = [EXTENT.minX / U, EXTENT.minZ / U, EXTENT.maxX / U, EXTENT.maxZ / U];

const out = [];
for (const f of readA003().features) {
  for (const line of f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates) {
    const pts = line.map(toM);
    if (pts.every(([x, z]) => x < ext[0] || x > ext[2] || z < ext[1] || z > ext[3])) continue;
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const { blobs } = paintIn([Math.min(...xs) - 2, Math.min(...zs) - 2, Math.max(...xs) + 2, Math.max(...zs) + 2]);
    const yellow = blobs.filter((b) => b.colour === "yellow").flatMap((b) => b.pts);
    if (!yellow.length) continue;
    const grid = new Map();
    for (const q of yellow) { const k = `${Math.floor(q[0])},${Math.floor(q[1])}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(q); }
    const hit = (q) => { for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) for (const p of grid.get(`${Math.floor(q[0]) + i},${Math.floor(q[1]) + j}`) ?? []) if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= HIT_M) return true; return false; };
    // dense samples with their outward normals, both sides
    const samples = [];
    for (let i = 1; i < pts.length; i += 1) {
      const [a, b] = [pts[i - 1], pts[i]];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]];
      for (let s = 0; s < L; s += STEP_M) samples.push({ p: [a[0] + d[0] * s, a[1] + d[1] * s], n });
    }
    for (const side of [1, -1]) {
      let run = [];
      const flush = () => {
        if (run.length * STEP_M >= RUN_MIN_M) {
          let turn = 0;
          for (let i = 2; i < run.length; i += 1) { const u = [run[i - 1][0] - run[i - 2][0], run[i - 1][1] - run[i - 2][1]], v = [run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]]; turn += Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1])); }
          if ((turn * 180) / Math.PI >= BEND_DEG) out.push(simplify(run, 0.1));
        }
        run = [];
      };
      for (const s of samples) {
        // the paint may sit on the kerb face or a little out: the first painted offset from 0.1 to 0.7 m
        let q = null;
        for (let o = 0.1; o <= 0.7 + 1e-9 && !q; o += 0.15) { const c = [s.p[0] + s.n[0] * o * side, s.p[1] + s.n[1] * o * side]; if (hit(c)) q = c; }
        if (q && !nearRoadYellow(q)) run.push(q); else flush();
      }
      flush();
    }
  }
}
writeFileSync(path.join(DATA, "kerb-lines.json"), `${JSON.stringify({ source: "NGII 2025 orthophoto 34702020 along the A003 sidewalk outlines (bake/kerb-lines.mjs)", lines: out.map((pl, i) => ({ id: `KL${String(i + 1).padStart(4, "0")}`, points: pl.map(toGeo), lengthM: +pl.reduce((s, p, j) => (j ? s + Math.hypot(p[0] - pl[j - 1][0], p[1] - pl[j - 1][1]) : 0), 0).toFixed(1) })) }, null, 1)}\n`);
console.log(`${out.length} curved yellow kerb lines -> data/photo/kerb-lines.json`);

#!/usr/bin/env bun
// Campus-wide road-marking audit of a built campus GLB (public/campus-v2.glb by default).
//
// Enumerates every marking triangle in the model (the Road_Markings node and the Road_Marking primitives of the context
// ground) and fails on:
//   template   a marking with no standard template or no placement evidence (lib/markingStandards.mjs)
//   dimension  a drawn width, bar, dash, gap, stall or glyph box more than TOL_M (2 cm) off its template
//   straight   a straight run whose edge deviates more than TOL_M from its fitted line (arcs: from their circle)
//   overlap    two marking polygons covering the same ground (zebra vs hatch, duplicate stalls, doubled paint), sampled
//              on a SAMPLE_M (2 cm) lattice; a white symbol lifted over its own blue bay square is the one exception
//   stall-lot  a stall outside its lot polygon or off the lot surface (Ground_Lot), i.e. on a road lane or on grass
//   spacing    a stall row whose divider spacing is uneven by more than SPACING_M (5 cm)
//   count      a lot whose modelled stall count differs from the stall count read on the photo
//               (data/photo/parking-lots.json, photoStalls)
//   coverage   a centre or edge line the photo shows along a road (data/photo/road-lines.json, read on the NGII sheet
//              by bake/road-lines.mjs) without a model line of its colour along it: less than COVER_SOLID of a solid
//              photo line within COVER_M of a drawn line (junction mouths and crossings cut a solid line), or, for a
//              dashed one, less than COVER_DASHED of it within COVER_M of the line through a drawn dash parallel to it
//              within DASH_REACH_M (the gaps of a dashed line are part of the line); crossings excluded
//
// A GLB built with stages/markingsStandard.mjs carries one record per marking instance in the Road_Markings node extras
// (`markingInstances`) and the instance index in every vertex's v texture coordinate, so the audit checks each
// instance against its template. A GLB without those records (any build before it) is audited from its geometry alone:
// every connected paint component is an instance without a template, thin parallel white strokes 3.5-6.5 m long side by
// side are read as stall dividers, and the geometric checks run on those.
//
//   bun scripts/qa/markings-audit.mjs [--glb public/campus-v2.glb] [--lots <parking-lots.json>] [--road-lines <road-lines.json>]
//       [--json <out>] [--max 15]
import path from "node:path";
import { paintIn, paintIndex } from "./photoPaint.mjs";
import { simulationToTm, tmToScene } from "../../src/geo/epsg5186.mjs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { TEMPLATES, crosswalkLength } from "../campus-model/lib/markingStandards.mjs";
import { SCENE_UNITS_PER_METRE, geoToModel } from "../campus-model/lib/frame.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "../..");
export const TOL_M = 0.02;
export const SPACING_M = 0.05;
export const SAMPLE_M = 0.02;
export const COVER_M = 0.35;
export const COVER_SOLID = 0.7;
export const COVER_DASHED = 0.7;
export const DASH_REACH_M = 5.5;
// junction paint (photoPaint.mjs): the island, hatch, chevron, triangle, arrow, text and bar paint (area blobs) the
// orthophoto shows within JUNCTION_PAD_M of a junction's nodes; the model's paint of the same colour must cover
// JUNCTION_SHARE of it (within PAINT_REACH_M), else the junction fails. Lots: the thin white strokes (stall dividers)
// inside a lot (its ring and LOT_PAD_M around it) must be covered by drawn stall lines over LOT_SHARE.
export const PAINT_REACH_M = 0.35;
export const JUNCTION_PAD_M = 20;
export const JUNCTION_SHARE = 0.6;
export const JUNCTION_MIN_M2 = 4;
export const LOT_PAD_M = 4;
export const LOT_SHARE = 0.6;
export const LOT_MIN_M2 = 1;
const U = SCENE_UNITS_PER_METRE;
// palette order of stages/markings.mjs (PALETTE_COLOURS): u = (i + 0.5) / 5
const PALETTE = ["white", "yellow", "blue", "green", "light_blue"];

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

// ---------------------------------------------------------------- geometry helpers (metres, plan x/z)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = norm(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a) => [-a[1], a[0]];
const triArea = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;

export function pointInRing([x, z], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Principal axis of a point set: centre, unit direction, extents along and across.
export function principal(points) {
  const c = points.reduce((a, p) => [a[0] + p[0] / points.length, a[1] + p[1] / points.length], [0, 0]);
  let sxx = 0, sxz = 0, szz = 0;
  for (const p of points) {
    const d = sub(p, c);
    sxx += d[0] * d[0]; sxz += d[0] * d[1]; szz += d[1] * d[1];
  }
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const dir = [Math.cos(angle), Math.sin(angle)];
  const n = perp(dir);
  const s = points.map((p) => dot(sub(p, c), dir));
  const t = points.map((p) => dot(sub(p, c), n));
  return { c, dir, n, s0: Math.min(...s), s1: Math.max(...s), t0: Math.min(...t), t1: Math.max(...t) };
}

// ---------------------------------------------------------------- GLB reading
export async function readMarkings(file) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(file);
  const tris = []; // { a, b, c (metres), colour, inst, y (lift, scene) }
  let records = null;
  let capacity = 1;
  let lotRecords = null;
  const lotTris = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const xf = (x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    const isMarkingNode = node.getName() === "Road_Markings";
    if (isMarkingNode) {
      records = node.getExtras()?.markingInstances ?? null;
      capacity = node.getExtras()?.markingInstanceCapacity ?? 1;
      lotRecords = node.getExtras()?.parkingLots ?? null;
    }
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial()?.getName();
      const isLot = node.getName() === "Ground_Lot";
      if (material !== "Road_Marking" && !isLot) continue;
      const pos = prim.getAttribute("POSITION");
      const uv = prim.getAttribute("TEXCOORD_0");
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const P = [], T = [];
      for (let k = 0; k < count; k += 1) {
        const i = idx ? idx.getScalar(k) : k;
        const [x, y, z] = xf(...pos.getElement(i, []));
        P.push([x / U, z / U, y]);
        T.push(uv ? uv.getElement(i, []) : [0, 0]);
      }
      for (let k = 0; k + 2 < count; k += 3) {
        const [a, b, c] = [P[k], P[k + 1], P[k + 2]];
        if (isLot) {
          lotTris.push([a, b, c].map((p) => [p[0], p[1]]));
          continue;
        }
        const u = T[k][0];
        const colour = PALETTE[Math.min(PALETTE.length - 1, Math.max(0, Math.floor(u * PALETTE.length)))];
        const inst = Math.floor(T[k][1] * capacity);
        tris.push({ p: [a, b, c].map((q) => [q[0], q[1]]), y: (a[2] + b[2] + c[2]) / 3, colour, inst, context: !isMarkingNode });
      }
    }
  }
  // the instance index is only meaningful when the GLB carries the records
  if (!records) for (const t of tris) t.inst = -1;
  return { tris, records, lotRecords, lotTris };
}

// ---------------------------------------------------------------- components (welded at 1 mm, per colour)
function components(tris) {
  const parent = tris.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const owner = new Map();
  tris.forEach((t, i) => {
    for (const p of t.p) {
      const key = `${t.colour}|${t.inst}|${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
      if (owner.has(key)) parent[root(i)] = root(owner.get(key));
      else owner.set(key, i);
    }
  });
  const groups = new Map();
  tris.forEach((t, i) => {
    const r = root(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  });
  return [...groups.values()];
}

// ---------------------------------------------------------------- overlap on a SAMPLE_M lattice
function overlaps(tris, keyOf, allowed) {
  const cells = new Map();
  const hits = new Map();
  tris.forEach((t, ti) => {
    const [a, b, c] = t.p;
    const area = triArea(a, b, c);
    if (Math.abs(area) < 1e-8) return;
    const xs = [a[0], b[0], c[0]], zs = [a[1], b[1], c[1]];
    const i0 = Math.ceil(Math.min(...xs) / SAMPLE_M), i1 = Math.floor(Math.max(...xs) / SAMPLE_M);
    const j0 = Math.ceil(Math.min(...zs) / SAMPLE_M), j1 = Math.floor(Math.max(...zs) / SAMPLE_M);
    const sign = Math.sign(area);
    const eps = 1e-6;
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const p = [i * SAMPLE_M, j * SAMPLE_M];
        if (sign * triArea(a, b, p) <= eps || sign * triArea(b, c, p) <= eps || sign * triArea(c, a, p) <= eps) continue;
        const key = i * 1e7 + j;
        const prev = cells.get(key);
        const mine = keyOf(t, ti);
        if (prev === undefined) { cells.set(key, ti); continue; }
        const other = tris[prev];
        if (allowed(other, t)) continue;
        const pair = [keyOf(other, prev), mine].sort().join(" x ");
        const h = hits.get(pair) ?? { pair, cells: 0, at: p, colours: `${other.colour}/${t.colour}` };
        h.cells += 1;
        hits.set(pair, h);
      }
    }
  });
  return [...hits.values()].map((h) => ({ ...h, areaM2: h.cells * SAMPLE_M * SAMPLE_M }));
}

// ---------------------------------------------------------------- lots
async function readLots(file) {
  const data = JSON.parse(await Bun.file(file).text());
  return data.lots.map((lot) => ({ ...lot, ringM: lot.ring.map(([lon, lat]) => geoToModel(lon, lat).map((v) => v / U)) }));
}
function lotIndex(lotTris) {
  const cell = 5;
  const grid = new Map();
  lotTris.forEach((t, i) => {
    const xs = t.map((p) => p[0]), zs = t.map((p) => p[1]);
    for (let x = Math.floor(Math.min(...xs) / cell); x <= Math.floor(Math.max(...xs) / cell); x += 1) {
      for (let z = Math.floor(Math.min(...zs) / cell); z <= Math.floor(Math.max(...zs) / cell); z += 1) {
        const k = `${x},${z}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  });
  const inTri = (p, [a, b, c]) => {
    const s1 = triArea(a, b, p), s2 = triArea(b, c, p), s3 = triArea(c, a, p);
    return (s1 >= -1e-9 && s2 >= -1e-9 && s3 >= -1e-9) || (s1 <= 1e-9 && s2 <= 1e-9 && s3 <= 1e-9);
  };
  return (p) => (grid.get(`${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`) ?? []).some((i) => inTri(p, lotTris[i]));
}

// Point-in-mesh test over a set of triangles (metres), on a 1 m bucket grid.
function coverage(tris) {
  const grid = new Map();
  tris.forEach((t, i) => {
    const xs = t.p.map((q) => q[0]), zs = t.p.map((q) => q[1]);
    for (let x = Math.floor(Math.min(...xs)); x <= Math.floor(Math.max(...xs)); x += 1) for (let z = Math.floor(Math.min(...zs)); z <= Math.floor(Math.max(...zs)); z += 1) {
      const k = `${x},${z}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  });
  return (q) => (grid.get(`${Math.floor(q[0])},${Math.floor(q[1])}`) ?? []).some((i) => {
    const [a, b, c] = tris[i].p;
    const s1 = triArea(a, b, q), s2 = triArea(b, c, q), s3 = triArea(c, a, q);
    return (s1 >= -1e-12 && s2 >= -1e-12 && s3 >= -1e-12) || (s1 <= 1e-12 && s2 <= 1e-12 && s3 <= 1e-12);
  });
}

// ---------------------------------------------------------------- per-template checks
// Lateral profile of a straight stroke: every vertex within w/2 + TOL of the axis, both edges reached within TOL.
function strokeCheck(points, a, b, widthM) {
  const dir = unit(sub(b, a));
  const n = perp(dir);
  const t = points.map((p) => dot(sub(p, a), n));
  const s = points.map((p) => dot(sub(p, a), dir));
  const half = widthM / 2;
  const outside = Math.max(...t.map((v) => Math.abs(v) - half));
  const left = Math.max(...t), right = -Math.min(...t);
  const length = norm(sub(b, a));
  const along = Math.max(-Math.min(...s), Math.max(...s) - length);
  return { deviation: Math.max(outside, half - left, half - right), along };
}
function arcCheck(points, centre, radius, widthM) {
  const r = points.map((p) => norm(sub(p, centre)) - radius);
  const half = widthM / 2;
  return { deviation: Math.max(Math.max(...r.map((v) => Math.abs(v) - half)), half - Math.max(...r), half + Math.min(...r)) };
}

function checkInstance(rec, tris, out, lotOf) {
  const t = TEMPLATES[rec.t];
  const fail = (check, detail) => out.push({ check, id: rec.id, template: rec.t, ...detail });
  if (!t) return fail("template", { detail: `unknown template ${rec.t}` });
  if (!rec.ev || !String(rec.ev).length) fail("template", { detail: "no placement evidence id" });
  if (rec.c !== t.colour && !(t.symbol && rec.c === t.symbol.colour)) fail("dimension", { detail: `colour ${rec.c}, template ${t.colour}` });
  const pts = tris.flatMap((x) => x.p);
  const p = rec.p ?? {};
  const toM = (q) => [q[0] / U, q[1] / U];
  if (t.kind === "line") {
    const width = p.w ?? t.widthM;
    if (Math.abs(width - t.widthM) > 1e-9) fail("dimension", { detail: `line width ${width} m, template ${t.widthM} m` });
    if (p.shape === "polyline") {
      const path = p.path.map(toM);
      const half = t.widthM / 2;
      const dist = (q) => Math.min(...path.slice(1).map((b, i) => {
        const a = path[i], ab = sub(b, a), l2 = dot(ab, ab);
        const s_ = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
        return norm(sub(q, [a[0] + ab[0] * s_, a[1] + ab[1] * s_]));
      }));
      const worst = Math.max(...pts.map(dist));
      if (worst - half > TOL_M) fail("straight", { detail: `edge ${((worst - half) * 100).toFixed(1)} cm off its fitted centreline`, at: path[0] });
      if (Math.abs(p.w - t.widthM) > 1e-9) fail("dimension", { detail: `line width ${p.w} m, template ${t.widthM} m` });
      return;
    }
    if (p.shape === "arc") {
      const r = arcCheck(pts, toM(p.centre), p.r / U, t.widthM);
      if (r.deviation > TOL_M) fail("straight", { detail: `arc edge ${(r.deviation * 100).toFixed(1)} cm off its circle`, at: toM(p.centre) });
    } else {
      const r = strokeCheck(pts, toM(p.a), toM(p.b), t.widthM);
      if (r.deviation > TOL_M) fail("straight", { detail: `edge ${(r.deviation * 100).toFixed(1)} cm off the fitted line (width ${t.widthM} m)`, at: toM(p.a) });
      if (r.along > TOL_M) fail("dimension", { detail: `paint ${(r.along * 100).toFixed(1)} cm beyond its run ends`, at: toM(p.a) });
      if (t.dashM && p.dash) {
        const len = norm(sub(toM(p.b), toM(p.a)));
        if (Math.abs(len - t.dashM) > TOL_M) fail("dimension", { detail: `dash ${len.toFixed(3)} m, template ${t.dashM} m`, at: toM(p.a) });
      }
    }
    return;
  }
  if (t.kind === "crosswalk") {
    const axis = p.axis, walk = perp(axis);
    const c = toM(p.centre);
    const bars = components(tris);
    const fitted = bars.map((bar) => {
      const q = bar.flatMap((x) => x.p);
      const s = q.map((v) => dot(sub(v, c), walk)), a = q.map((v) => dot(sub(v, c), axis));
      return { w: Math.max(...s) - Math.min(...s), mid: (Math.max(...s) + Math.min(...s)) / 2, l: Math.max(...a) - Math.min(...a), am: (Math.max(...a) + Math.min(...a)) / 2 };
    }).sort((x, y) => x.mid - y.mid);
    const length = crosswalkLength(p.length);
    if (Math.abs(p.length - length) > 1e-9) fail("dimension", { detail: `crosswalk length ${p.length} m is not a standard length`, at: c });
    fitted.forEach((b, k) => {
      if (Math.abs(b.w - t.barM) > TOL_M) fail("dimension", { detail: `bar ${k} ${(b.w * 100).toFixed(1)} cm wide, template ${t.barM * 100} cm`, at: c });
      if (Math.abs(b.l - p.length) > TOL_M) fail("dimension", { detail: `bar ${k} ${b.l.toFixed(3)} m long, crossing ${p.length} m`, at: c });
      if (Math.abs(b.am - fitted[0].am) > TOL_M) fail("straight", { detail: `bar ${k} ${(Math.abs(b.am - fitted[0].am) * 100).toFixed(1)} cm out of line`, at: c });
      if (k && Math.abs(b.mid - fitted[k - 1].mid - (t.barM + t.gapM)) > TOL_M) fail("dimension", { detail: `bar ${k} period ${(b.mid - fitted[k - 1].mid).toFixed(3)} m, template ${t.barM + t.gapM} m`, at: c });
    });
    if (fitted.length !== p.bars) fail("dimension", { detail: `${fitted.length} bars drawn, record says ${p.bars}`, at: c });
    return;
  }
  if (t.kind === "stall") {
    const o = toM(p.origin), u = p.u, v = p.v, lw = t.lineM;
    const covered = coverage(tris);
    const total = p.widths.reduce((x, w) => x + w, 0);
    // the dividers where the mesh crosses a line along the row a quarter of the depth in (clear of any bay symbol)
    const runs = [];
    let run = null;
    for (let s_ = -0.5; s_ <= total + 0.5; s_ += 0.005) {
      const q = [o[0] + u[0] * s_ + v[0] * 0.25 * p.depth, o[1] + u[1] * s_ + v[1] * 0.25 * p.depth];
      if (covered(q)) { if (run) run[1] = s_; else run = [s_, s_]; } else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    const centres = runs.map(([x, y]) => (x + y) / 2);
    runs.forEach(([x, y], k) => {
      if (Math.abs(y - x + 0.005 - lw) > TOL_M) fail("dimension", { detail: `divider ${k} ${((y - x + 0.005) * 100).toFixed(1)} cm wide, template ${lw * 100} cm`, at: o });
    });
    if (runs.length !== p.bays + 1) fail("dimension", { detail: `${runs.length} dividers drawn for ${p.bays} bays`, at: o });
    else centres.slice(1).forEach((c, k) => {
      if (Math.abs(c - centres[k] - p.widths[k]) > SPACING_M) fail("spacing", { detail: `bay ${k} ${(c - centres[k]).toFixed(3)} m wide, its template ${p.widths[k]} m`, at: o });
    });
    p.widths.forEach((w, k) => {
      const ok = Math.abs(w - t.widthM) < 1e-9 || (Math.abs(w - TEMPLATES.stall_accessible.widthM) < 1e-9 && (p.accessible ?? []).includes(k));
      if (!ok) fail("dimension", { detail: `bay ${k} width ${w} m is not the ${rec.t} or accessible template width`, at: o });
    });
    // depth: along the first divider, front line to back line (the back line of a row sharing it belongs to the other)
    if (centres.length) {
      let first = null, last = null;
      for (let t_ = -0.5; t_ <= p.depth + 0.5; t_ += 0.005) {
        const q = [o[0] + u[0] * centres[0] + v[0] * t_, o[1] + u[1] * centres[0] + v[1] * t_];
        if (covered(q)) { first ??= t_; last = t_; }
      }
      const want = p.sharedBack ? p.depth : p.depth + lw;
      const got = last - first + 0.005;
      if (Math.abs(p.depth - t.depthM) > 1e-9 || Math.abs(got - want) > TOL_M) fail("dimension", { detail: `stall paint ${got.toFixed(3)} m deep, template ${want.toFixed(3)} m`, at: o });
    }
    const lot = lotOf(rec.p.lot);
    if (!lot) fail("stall-lot", { detail: `lot ${rec.p.lot} not in the lot list`, at: o });
    else {
      const outside = pts.filter((q) => !pointInRing(q, lot.ringM));
      if (outside.length) fail("stall-lot", { detail: `${outside.length} vertices outside lot ${lot.id}`, at: outside[0] });
    }
    return;
  }
  if (t.kind === "glyph" || t.kind === "text") {
    const c = toM(p.centre), f = p.front, r = perp(f);
    const along = pts.map((q) => dot(sub(q, c), f)), across = pts.map((q) => dot(sub(q, c), r));
    const L = Math.max(...along) - Math.min(...along), W = Math.max(...across) - Math.min(...across);
    if (Math.abs(L - p.boxL) > TOL_M || Math.abs(W - p.boxW) > TOL_M) fail("dimension", { detail: `box ${L.toFixed(3)} x ${W.toFixed(3)} m, template box ${p.boxL} x ${p.boxW} m`, at: c });
    if (t.kind === "text" && (p.scale < t.scaleRange[0] || p.scale > t.scaleRange[1])) fail("dimension", { detail: `text scale ${p.scale} outside ${t.scaleRange.join("-")}`, at: c });
    if (t.kind === "glyph" && t.lengthM && !(t.lengthsM ?? [t.lengthM]).some((L) => Math.abs(p.size - L) < 1e-9)) fail("dimension", { detail: `glyph size ${p.size} m, template ${(t.lengthsM ?? [t.lengthM]).join(" or ")} m`, at: c });
    return;
  }
  if (t.kind === "hatch") {
    // the stripes: every component but the border band (the largest) no wider than the template stripe, measured
    // across the stripe direction (the template angle from the region's long axis)
    const a = Math.atan2(p.long[1], p.long[0]) + (t.angleDeg * Math.PI) / 180;
    const nrm = [-Math.sin(a), Math.cos(a)];
    const comps = components(tris).map((cmp) => ({ cmp, area: cmp.reduce((x, tr) => x + Math.abs(triArea(...tr.p)), 0) })).sort((x, y) => y.area - x.area);
    for (const { cmp } of comps.slice(1)) {
      const q = cmp.flatMap((x) => x.p);
      const across = q.map((v) => dot(v, nrm));
      const w = Math.max(...across) - Math.min(...across);
      if (w > t.stripeM + TOL_M) fail("dimension", { detail: `hatch stripe ${(w * 100).toFixed(1)} cm wide, template ${t.stripeM * 100} cm`, at: q[0] });
    }
  }
}

// ---------------------------------------------------------------- geometry-only audit (no instance records)
function legacyAudit(tris, lots, out) {
  const comps = components(tris.filter((t) => !t.context));
  for (const cmp of comps) out.push({ check: "template", id: `component@${principal(cmp.flatMap((x) => x.p)).c.map((v) => v.toFixed(1)).join(",")}`, detail: "paint with no template or evidence record" });
  // thin strokes: straightness and stall dividers
  const strokes = [];
  for (const cmp of comps) {
    const q = cmp.flatMap((x) => x.p);
    const pr = principal(q);
    const len = pr.s1 - pr.s0, wid = pr.t1 - pr.t0;
    if (len < 1 || wid > 0.6 || len < 3 * wid) continue;
    // width: the mean lateral extent at each station; deviation: worst edge offset from the fitted edge
    const half = wid / 2;
    const rows = new Map();
    for (const p of q) {
      const s = Math.round(dot(sub(p, pr.c), pr.dir) / 0.25);
      const t = dot(sub(p, pr.c), pr.n);
      const r = rows.get(s) ?? [Infinity, -Infinity];
      rows.set(s, [Math.min(r[0], t), Math.max(r[1], t)]);
    }
    const mids = [...rows.values()].filter(([a, b]) => b - a > 0.02).map(([a, b]) => (a + b) / 2);
    const dev = mids.length ? Math.max(...mids.map(Math.abs)) : 0;
    if (dev > TOL_M) out.push({ check: "straight", id: `stroke@${pr.c.map((v) => v.toFixed(1)).join(",")}`, detail: `centre wanders ${(dev * 100).toFixed(1)} cm from its fitted line over ${len.toFixed(1)} m`, at: pr.c });
    if (cmp[0].colour === "white" && len >= 3.5 && len <= 6.5 && wid <= 0.3) strokes.push({ c: pr.c, dir: pr.dir, len, half });
  }
  // stall rows: >= 3 parallel dividers side by side
  const parent = strokes.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < strokes.length; i += 1) for (let j = i + 1; j < strokes.length; j += 1) {
    const a = strokes[i], b = strokes[j];
    if (Math.abs(dot(a.dir, b.dir)) < Math.cos((8 * Math.PI) / 180)) continue;
    const d = sub(b.c, a.c);
    if (Math.abs(dot(d, a.dir)) > 1.5 || Math.abs(dot(d, perp(a.dir))) > 3.9) continue;
    parent[root(i)] = root(j);
  }
  const rows = new Map();
  strokes.forEach((s, i) => { const r = root(i); if (!rows.has(r)) rows.set(r, []); rows.get(r).push(s); });
  const stallRows = [...rows.values()].filter((r) => r.length >= 3);
  const perLot = new Map(lots.map((l) => [l.id, 0]));
  for (const row of stallRows) {
    const n = perp(row[0].dir);
    const s = row.map((x) => dot(x.c, n)).sort((a, b) => a - b);
    const gaps = s.slice(1).map((v, i) => v - s[i]);
    const med = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
    const worst = Math.max(...gaps.map((g) => Math.abs(g - med)));
    const at = row[0].c;
    if (worst > SPACING_M) out.push({ check: "spacing", id: `row@${at.map((v) => v.toFixed(1)).join(",")}`, detail: `${row.length} dividers, pitch ${gaps.map((g) => g.toFixed(2)).join("/")} m (uneven by ${(worst * 100).toFixed(0)} cm)`, at });
    for (const d of row) {
      const lot = lots.find((l) => pointInRing(d.c, l.ringM));
      if (!lot) { out.push({ check: "stall-lot", id: `divider@${d.c.map((v) => v.toFixed(1)).join(",")}`, detail: "stall divider outside every lot polygon", at: d.c }); continue; }
    }
    const lot = lots.find((l) => pointInRing(at, l.ringM));
    if (lot) perLot.set(lot.id, perLot.get(lot.id) + row.length - 1);
  }
  // single stall-like strokes not in a row are stray strokes
  for (const r of rows.values()) if (r.length < 3) for (const d of r) out.push({ check: "stall-lot", id: `stray@${d.c.map((v) => v.toFixed(1)).join(",")}`, detail: `stray stall-like stroke (${d.len.toFixed(1)} m) not in a row`, at: d.c });
  return perLot;
}

// ---------------------------------------------------------------- photo-evidence coverage
async function readRoadLines(file) {
  if (!(await Bun.file(file).exists())) return [];
  return JSON.parse(await Bun.file(file).text()).lines.map((l) => ({ ...l, pts: l.points.map(([lon, lat]) => geoToModel(lon, lat).map((v) => v / U)) }));
}
// Model line pieces (metres) of one colour family from the instance records, or, without records, from thin paint
// components of that colour.
function modelLines(records, tris, colour) {
  const segs = [];
  const exclude = [];
  if (records) {
    for (const r of records) {
      const t = TEMPLATES[r.t];
      if (!t) continue;
      if (t.kind === "crosswalk" || r.t === "stop_line") { exclude.push(r.p.centre ? [r.p.centre[0] / U, r.p.centre[1] / U] : [r.p.a[0] / U, r.p.a[1] / U]); continue; }
      if (t.kind !== "line" || t.colour !== colour) continue;
      const p = r.p;
      if (p.shape === "straight") segs.push([[p.a[0] / U, p.a[1] / U], [p.b[0] / U, p.b[1] / U]]);
      else if (p.shape === "polyline") for (let i = 1; i < p.path.length; i += 1) segs.push([[p.path[i - 1][0] / U, p.path[i - 1][1] / U], [p.path[i][0] / U, p.path[i][1] / U]]);
      else if (p.shape === "arc") {
        const c = [p.centre[0] / U, p.centre[1] / U], rr = p.r / U;
        const n = 16;
        for (let k = 0; k < n; k += 1) {
          const a0 = p.a0 + ((p.a1 - p.a0) * k) / n, a1 = p.a0 + ((p.a1 - p.a0) * (k + 1)) / n;
          segs.push([[c[0] + rr * Math.cos(a0), c[1] + rr * Math.sin(a0)], [c[0] + rr * Math.cos(a1), c[1] + rr * Math.sin(a1)]]);
        }
      }
    }
  } else {
    for (const cmp of components(tris.filter((t) => t.colour === colour && !t.context))) {
      const pr = principal(cmp.flatMap((x) => x.p));
      if (pr.t1 - pr.t0 > 0.6) continue;
      segs.push([[pr.c[0] + pr.dir[0] * pr.s0, pr.c[1] + pr.dir[1] * pr.s0], [pr.c[0] + pr.dir[0] * pr.s1, pr.c[1] + pr.dir[1] * pr.s1]]);
    }
  }
  const cell = 4;
  const grid = new Map();
  segs.forEach((sg, i) => {
    const xs = sg.map((q) => q[0]), zs = sg.map((q) => q[1]);
    for (let x = Math.floor(Math.min(...xs) / cell); x <= Math.floor(Math.max(...xs) / cell); x += 1) for (let z = Math.floor(Math.min(...zs) / cell); z <= Math.floor(Math.max(...zs) / cell); z += 1) {
      const k = `${x},${z}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  });
  const dist = (q, [a, b]) => { const ab = sub(b, a), l2 = dot(ab, ab); const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0; return norm(sub(q, [a[0] + ab[0] * t, a[1] + ab[1] * t])); };
  // the infinite line through a drawn piece parallel to `d` (within 5 deg), reaching q within DASH_REACH_M along it
  const lineDist = (q, [a, b]) => { const ab = sub(b, a), l = norm(ab); const u = [ab[0] / l, ab[1] / l]; return Math.abs((q[0] - a[0]) * u[1] - (q[1] - a[1]) * u[0]); };
  const parallel = (sg, d) => { const ab = sub(sg[1], sg[0]); const l = norm(ab); return l > 0.3 && Math.abs(dot(ab, d)) / l >= Math.cos((5 * Math.PI) / 180); };
  return {
    near: (q, r) => (grid.get(`${Math.floor(q[0] / cell)},${Math.floor(q[1] / cell)}`) ?? []).some((i) => dist(q, segs[i]) <= r),
    nearDashed: (q, r, d) => {
      const out = new Set();
      for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) for (const i of grid.get(`${Math.floor(q[0] / cell) + dx},${Math.floor(q[1] / cell) + dz}`) ?? []) out.add(i);
      return [...out].some((i) => dist(q, segs[i]) <= DASH_REACH_M && parallel(segs[i], d) && lineDist(q, segs[i]) <= r);
    },
    excluded: (q) => exclude.some((c) => norm(sub(q, c)) < 6),
  };
}
// junctions: the network's intersection nodes clustered within 35 m (the render windows J01..), numbered south to north
export async function readJunctions(file) {
  const roads = JSON.parse(await Bun.file(file).text());
  const pts = roads.nodes.filter((n) => n.properties.kind === "intersection")
    .map((n) => tmToScene(...simulationToTm({ x: n.geometry.coordinates[0], z: n.geometry.coordinates[1] })))
    .filter(([x, z]) => x >= 5 && x <= 495 && z >= -370 && z <= -4);
  const parent = pts.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < pts.length; i += 1) for (let j = i + 1; j < pts.length; j += 1) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) / U < 35) parent[root(i)] = root(j);
  const groups = new Map();
  pts.forEach((p, i) => { const k = root(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p.map((v) => v / U)); });
  return [...groups.values()].sort((a, b) => a[0][1] * U - b[0][1] * U || a[0][0] - b[0][0]).map((g, k) => ({
    id: `J${String(k + 1).padStart(2, "0")}`,
    box: [Math.min(...g.map((p) => p[0])) - JUNCTION_PAD_M, Math.min(...g.map((p) => p[1])) - JUNCTION_PAD_M, Math.max(...g.map((p) => p[0])) + JUNCTION_PAD_M, Math.max(...g.map((p) => p[1])) + JUNCTION_PAD_M],
  }));
}

// photo paint (area blobs) at each junction covered by model paint of its colour
function junctionPaint(junctions, tris, out) {
  const covers = paintIndex(tris, PAINT_REACH_M);
  return junctions.map((j) => {
    const { blobs } = paintIn(j.box);
    const area = blobs.filter((b) => b.type === "area");
    const pts = area.flatMap((b) => b.pts.map((q) => ({ q, colour: b.colour })));
    const hit = pts.filter((p) => covers(p.q, p.colour));
    const share = pts.length ? hit.length / pts.length : 1;
    const missM2 = (pts.length - hit.length) * 0.0625;
    const byColour = Object.fromEntries(["white", "yellow"].map((c) => { const all = pts.filter((p) => p.colour === c); return [c, all.length ? +(all.filter((p) => covers(p.q, c)).length / all.length).toFixed(2) : null]; }));
    const worst = area.map((b) => ({ b, miss: b.pts.filter((q) => !covers(q, b.colour)).length })).sort((a, b) => b.miss - a.miss)[0];
    if (share < JUNCTION_SHARE && missM2 >= JUNCTION_MIN_M2)
      out.push({ check: "junction-paint", id: j.id, detail: `photo island/hatch/chevron/symbol paint ${(pts.length * 0.0625).toFixed(1)} m2, ${(share * 100).toFixed(0)} % covered by model paint of its colour (white ${byColour.white ?? "-"}, yellow ${byColour.yellow ?? "-"}; need ${JUNCTION_SHARE * 100} %), ${missM2.toFixed(1)} m2 uncovered`, at: worst?.b.centre });
    return { id: j.id, paintM2: +(pts.length * 0.0625).toFixed(1), share: +share.toFixed(3), ...byColour };
  });
}

// photo stall-line paint (thin white strokes) in each lot covered by the model's stall lines
function lotPaint(lots, tris, records, out) {
  const stallTris = tris.filter((t) => t.colour === "white" && (!records || TEMPLATES[records[t.inst]?.t]?.kind === "stall"));
  const covers = paintIndex(stallTris, PAINT_REACH_M);
  return lots.map((lot) => {
    const xs = lot.ringM.map((p) => p[0]), zs = lot.ringM.map((p) => p[1]);
    const box = [Math.min(...xs) - LOT_PAD_M, Math.min(...zs) - LOT_PAD_M, Math.max(...xs) + LOT_PAD_M, Math.max(...zs) + LOT_PAD_M];
    const near = (q) => pointInRing(q, lot.ringM) || lot.ringM.some((a, i) => { const b = lot.ringM[(i + 1) % lot.ringM.length]; const ab = sub(b, a); const s2 = Math.max(0, Math.min(1, dot(sub(q, a), ab) / (dot(ab, ab) || 1))); return norm(sub(q, [a[0] + s2 * ab[0], a[1] + s2 * ab[1]])) <= LOT_PAD_M; });
    const pts = paintIn(box).blobs.filter((b) => b.type === "stroke" && b.colour === "white" && near(b.centre)).flatMap((b) => b.pts);
    const hit = pts.filter((q) => covers(q, "white")).length;
    const share = pts.length ? hit / pts.length : 1;
    if (share < LOT_SHARE && (pts.length - hit) * 0.0625 >= LOT_MIN_M2)
      out.push({ check: "stall-paint", id: lot.id, detail: `photo stall-line paint ${(pts.length * 0.0625).toFixed(1)} m2, ${(share * 100).toFixed(0)} % covered by drawn stall lines (need ${LOT_SHARE * 100} %)`, at: lot.ringM[0] });
    return { id: lot.id, paintM2: +(pts.length * 0.0625).toFixed(1), share: +share.toFixed(3) };
  });
}

function lineCoverage(roadLines, records, tris, out) {
  const fam = { yellow: modelLines(records, tris, "yellow"), white: modelLines(records, tris, "white") };
  const rows = [];
  for (const l of roadLines) {
    const m = fam[l.colour];
    const samples = [];
    for (let i = 1; i < l.pts.length; i += 1) {
      const [a, b] = [l.pts[i - 1], l.pts[i]];
      const len = norm(sub(b, a));
      for (let s_ = 0; s_ < len; s_ += 1) samples.push([a[0] + ((b[0] - a[0]) * s_) / len, a[1] + ((b[1] - a[1]) * s_) / len]);
    }
    const counted = samples.filter((q) => !m.excluded(q));
    if (counted.length < 4) continue;
    const d = (() => { const a = l.pts[0], b = l.pts.at(-1); const v = sub(b, a); const n = norm(v) || 1; return [v[0] / n, v[1] / n]; })();
    const share = counted.filter((q) => (l.pattern === "dashed" ? m.nearDashed(q, COVER_M, d) : m.near(q, COVER_M))).length / counted.length;
    const need = l.pattern === "dashed" ? COVER_DASHED : COVER_SOLID;
    rows.push({ id: l.id, kind: l.kind, share });
    if (share < need) out.push({ check: "coverage", id: l.id, detail: `photo ${l.pattern} ${l.kind} ${l.lengthM} m: ${(share * 100).toFixed(0)} % drawn (need ${need * 100} %)`, at: counted[counted.length >> 1] });
  }
  return rows;
}

// ---------------------------------------------------------------- main
export async function audit({ glb, lotsFile, roadLinesFile }) {
  const { tris, records, lotRecords, lotTris } = await readMarkings(glb);
  const roadLines = await readRoadLines(roadLinesFile);
  const lots = await readLots(lotsFile);
  const out = [];
  let modelled;
  let instances = 0;
  if (!records) {
    modelled = legacyAudit(tris, lots, out);
    const campus = tris.filter((t) => !t.context);
    const compOf = new Map();
    components(campus).forEach((cmp, i) => { for (const t of cmp) compOf.set(t, i); });
    // a white symbol lifted over a blue fill is one painted figure; two pieces of one colour on the same ground are not
    const legacyAllowed = (a, b) => compOf.get(a) === compOf.get(b) || (a.colour !== b.colour && Math.abs(a.y - b.y) > 1e-4 && [a.colour, b.colour].includes("blue"));
    out.push(...overlaps(campus, (t) => `paint${compOf.get(t)}`, legacyAllowed)
      .map((h) => ({ check: "overlap", id: h.pair, detail: `${h.colours} paint overlaps over ${(h.areaM2 * 1e4).toFixed(0)} cm2`, at: h.at })));
  } else {
    instances = records.length;
    const byInst = new Map();
    const stray = [];
    for (const t of tris) {
      if (!(t.inst >= 0 && t.inst < records.length)) { stray.push(t); continue; }
      if (!byInst.has(t.inst)) byInst.set(t.inst, []);
      byInst.get(t.inst).push(t);
    }
    const lotOf = (id) => lots.find((l) => l.id === id);
    records.forEach((rec, i) => {
      const own = byInst.get(i);
      if (!own) { out.push({ check: "template", id: rec.id, detail: "record with no paint" }); return; }
      checkInstance(rec, own, out, lotOf);
    });
    for (const cmp of components(stray)) out.push({ check: "template", id: `unindexed@${principal(cmp.flatMap((x) => x.p)).c.map((v) => v.toFixed(1)).join(",")}`, detail: `${cmp.length} marking triangles without an instance record${cmp[0].context ? " (context ground)" : ""}` });
    // stalls on the lot surface
    const onLot = lotIndex(lotTris);
    records.forEach((rec, i) => {
      if (TEMPLATES[rec.t]?.kind !== "stall") return;
      const pts = (byInst.get(i) ?? []).flatMap((t) => [t.p[0], t.p[1], t.p[2], [(t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3]]);
      const off = pts.filter((q) => !onLot(q));
      if (off.length) out.push({ check: "stall-lot", id: rec.id, detail: `${off.length} stall points off the Ground_Lot surface (road or grass)`, at: off[0] });
    });
    modelled = new Map(lots.map((l) => [l.id, 0]));
    for (const rec of records) if (TEMPLATES[rec.t]?.kind === "stall" && modelled.has(rec.p.lot)) modelled.set(rec.p.lot, modelled.get(rec.p.lot) + rec.p.bays);
    // within one instance pieces may touch or overlap (the parts of one glyph; the white wheelchair lifted over the blue
    // square of its own accessible stall): one marking, not two
    const allowed = (a, b) => a.inst === b.inst;
    out.push(...overlaps(tris.filter((t) => t.inst >= 0 && t.inst < records.length), (t) => records[t.inst]?.id ?? "?", allowed)
      .map((h) => ({ check: "overlap", id: h.pair, detail: `${h.colours} paint overlaps over ${(h.areaM2 * 1e4).toFixed(0)} cm2`, at: h.at })));
    void lotRecords;
  }
  const covered = lineCoverage(roadLines, records, tris, out);
  const junctions = junctionPaint(await readJunctions(path.join(FRONTEND, "scripts", "campus-model", "data", "network", "roads.json")), tris.filter((t) => !t.context), out);
  const lotsPaint = lotPaint(lots, tris.filter((t) => !t.context), records, out);
  const counts = lots.map((l) => ({ lot: l.id, photo: l.photoStalls, modelled: modelled.get(l.id) ?? 0 }));
  for (const c of counts) if (c.photo !== c.modelled) out.push({ check: "count", id: c.lot, detail: `photo ${c.photo} stalls, model ${c.modelled}` });
  return { failures: out, counts, coverage: covered, junctions, lotsPaint, triangles: tris.length, instances, mode: records ? "instances" : "geometry-only" };
}

if (import.meta.main) {
  const glb = path.resolve(option("glb", path.join(FRONTEND, "public", "campus-v2.glb")));
  const lotsFile = path.resolve(option("lots", path.join(FRONTEND, "scripts", "campus-model", "data", "photo", "parking-lots.json")));
  const max = Number(option("max", 15));
  const roadLinesFile = path.resolve(option("road-lines", path.join(FRONTEND, "scripts", "campus-model", "data", "photo", "road-lines.json")));
  const result = await audit({ glb, lotsFile, roadLinesFile });
  const by = new Map();
  for (const f of result.failures) {
    if (!by.has(f.check)) by.set(f.check, []);
    by.get(f.check).push(f);
  }
  console.log(`markings audit: ${glb}`);
  console.log(`  mode ${result.mode}; ${result.triangles} marking triangles; ${result.instances} instance records; lots ${result.counts.length}`);
  for (const check of ["template", "dimension", "straight", "overlap", "stall-lot", "spacing", "count", "coverage", "junction-paint", "stall-paint"]) {
    const list = by.get(check) ?? [];
    console.log(`  ${list.length ? "FAIL" : "PASS"} ${check}: ${list.length}`);
    for (const f of list.slice(0, max)) console.log(`      ${f.id}${f.template ? ` [${f.template}]` : ""}: ${f.detail}${f.at ? ` @ (${(f.at[0] * U).toFixed(1)}, ${(f.at[1] * U).toFixed(1)}) scene` : ""}`);
  }
  console.log(`  photo road lines: ${result.coverage.length} (${result.coverage.filter((c) => c.kind === "centre_line_yellow").length} centre, ${result.coverage.filter((c) => c.kind === "edge_line").length} edge), median drawn share ${((result.coverage.map((c) => c.share).sort((a, b) => a - b)[result.coverage.length >> 1] ?? 0) * 100).toFixed(0)} %`);
  console.log("  junction paint covered:", result.junctions.map((j) => `${j.id} ${(j.share * 100).toFixed(0)}%`).join(", "));
  console.log("  lot stall paint covered:", result.lotsPaint.map((l) => `${l.id} ${(l.share * 100).toFixed(0)}%`).join(", "));
  console.log("  per-lot stalls (photo / model):", result.counts.map((c) => `${c.lot} ${c.photo}/${c.modelled}`).join(", "));
  const json = option("json", null);
  if (json) await Bun.write(json, `${JSON.stringify(result, null, 1)}\n`);
  console.log(result.failures.length ? `AUDIT FAIL (${result.failures.length} failures)` : "AUDIT PASS");
  process.exit(result.failures.length ? 1 : 0);
}

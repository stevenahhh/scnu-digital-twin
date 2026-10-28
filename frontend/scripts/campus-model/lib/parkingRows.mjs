// Stall rows of data/photo/parking-lots.json (bake/parking-rows.mjs, read on the NGII photo) as statute stall templates
// (lib/markingStandards.mjs): each row is one straight run of bays along its photo front line, every bay the template
// width (2.5 m 일반형, 2.6 m 확장형 where the photo pitch is 2.55 m or more, 3.3 m 장애인전용 where the photo shows a blue
// or wide bay), centred on the photo row, with a front line, a back line at the template depth and one divider per bay
// edge, all TEMPLATES lineM wide. Dividers start and end at the inner edges of the two long lines, so no two strokes
// overlap. Used by stages/markingsStandard.mjs (the paint) and network/surfaces.mjs (the Ground_Lot surface under it).
// Coordinates: metres in the scene frame (x east, z south) unless named otherwise.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geoToModel, SCENE_UNITS_PER_METRE as U } from "./frame.mjs";
import { TEMPLATES } from "./markingStandards.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PARKING_LOTS_FILE = path.join(HERE, "..", "data", "photo", "parking-lots.json");
export const EXPANDED_PITCH_M = 2.55;
// the lot surface reaches LOT_SURFACE_MARGIN_M beyond the painted row
export const LOT_SURFACE_MARGIN_M = 0.4;
export const ANGLED_MIN_DEG = 75;

// 경사주차 row: bays of the template width measured square to the dividers (pitch along the front line w / sin a),
// the photo pitch used where wider, dividers at the template angle a to the front line, depth 5.0 m along them; the
// front and back lines run along the row, the dividers stop clear of them (no overlapping strokes)
function angledGeometry(row, start, vPhoto, deg) {
  const t = TEMPLATES[`stall_angled_${deg}`];
  const a = (deg * Math.PI) / 180;
  const ab = (row.aisleBearing * Math.PI) / 180;
  const u = [Math.sin(ab), -Math.cos(ab)];
  const L = (row.photoBays * row.photoPitchM) / Math.sin(a);
  let n = [-u[1], u[0]];
  if (n[0] * vPhoto[0] + n[1] * vPhoto[1] < 0) n = scale(n, -1);
  const along = Math.sign(u[0] * vPhoto[0] + u[1] * vPhoto[1]) || 1;
  const vs = add(scale(u, along * Math.cos(a)), scale(n, Math.sin(a)));
  const w = Math.max(t.widthM, Math.round((row.photoPitchM ?? 0) * 100) / 100); // the photo pitch is square to the dividers
  const step = w / Math.sin(a);
  const bays = row.photoBays;
  const lw = t.lineM;
  const h = t.depthM * Math.sin(a);
  const photoAlong = (row.photoDividers ?? []).map((q) => { const d = sub(toM(q), start); return d[0] * u[0] + d[1] * u[1]; });
  let s0 = (L - bays * step) / 2;
  if (photoAlong.length) {
    const offs = photoAlong.map((p) => { let best = Infinity; for (let k = 0; k <= bays; k += 1) { const d = p - (s0 + k * step); if (Math.abs(d) < Math.abs(best)) best = d; } return best; }).filter((d) => Math.abs(d) <= step / 2).sort((x, y) => x - y);
    if (offs.length) s0 += offs[offs.length >> 1];
  }
  const P = (s, tn) => add(start, add(scale(u, s), scale(n, tn)));
  const edges = Array.from({ length: bays + 1 }, (_, k) => s0 + k * step);
  // the back line runs from the first divider's back end to the last one's
  const back0 = edges[0] + (along * h) / Math.tan(a), backN = edges[bays] + (along * h) / Math.tan(a);
  const band = (s1, s2, tn) => [P(Math.min(s1, s2) - lw / 2, tn - lw / 2), P(Math.max(s1, s2) + lw / 2, tn - lw / 2), P(Math.max(s1, s2) + lw / 2, tn + lw / 2), P(Math.min(s1, s2) - lw / 2, tn + lw / 2)];
  const m = [-vs[1], vs[0]];
  const trim = (lw / 2) * (1 + Math.cos(a)) / Math.sin(a);
  const divider = (s) => { const o = P(s, 0); const p0 = add(o, scale(vs, trim)), p1 = add(o, scale(vs, t.depthM - trim)); return [add(p0, scale(m, lw / 2)), add(p1, scale(m, lw / 2)), add(p1, scale(m, -lw / 2)), add(p0, scale(m, -lw / 2))]; };
  const rects = [
    { part: "front", ring: band(edges[0], edges[bays], 0) },
    { part: "back", ring: band(back0, backN, h), shared: row.backLine === false },
    ...edges.map((s, k) => ({ part: "divider", k, ring: divider(s) })),
  ];
  const mg = LOT_SURFACE_MARGIN_M;
  const surface = [P(Math.min(edges[0], back0) - mg, -mg), P(Math.max(edges[bays], backN) + mg, -mg), P(Math.max(edges[bays], backN) + mg, h + mg), P(Math.min(edges[0], back0) - mg, h + mg)];
  const residual = photoAlong.length ? Math.max(...photoAlong.map((p) => Math.min(...edges.map((s) => Math.abs(p - s))))) : null;
  return { template: `stall_angled_${deg}`, angleDeg: deg, photoAngleDeg: row.photoAngleDeg, pitch: w, u, v: vs, origin: P(edges[0], 0), widths: Array(bays).fill(w), depth: t.depthM, line: lw, rects, symbols: [], surface, photoResidualM: residual };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const norm = (a) => Math.hypot(a[0], a[1]);
const toM = ([lon, lat]) => geoToModel(lon, lat).map((v) => v / U);

export function readParkingLots(file = PARKING_LOTS_FILE) {
  return JSON.parse(readFileSync(file, "utf8")).lots;
}

// One row's geometry: { template, u, v, origin (the outer corner of the first divider at the front line), widths,
// depth, line, rects: [{ part, k?, ring }], symbols: [{ k, centre }], surface (ring), photoResidualM }.
export function rowGeometry(row) {
  const b = (row.depthBearing * Math.PI) / 180;
  const v = [Math.sin(b), -Math.cos(b)];
  // a row back to back with another is moved onto the shared back line (shiftM along its depth direction)
  const shift = scale(v, row.shiftM ?? 0);
  const start = add(toM(row.start), shift);
  const end = add(toM(row.end), shift);
  const u = scale(sub(end, start), 1 / norm(sub(end, start)));
  // the divider direction against the row: square rows within ANGLED_MIN_DEG of 90 deg, else the 경사주차 template
  // of the nearer statute angle (45 or 60 deg), the dividers turned to it on the photo's side
  if (row.photoAngleDeg != null && row.photoAngleDeg < ANGLED_MIN_DEG) return angledGeometry(row, start, v, row.photoAngleDeg < 52.5 ? 45 : 60);
  const expanded = !row.parallel && row.photoPitchM >= EXPANDED_PITCH_M;
  const tpl = row.parallel ? TEMPLATES.stall_parallel : expanded ? TEMPLATES.stall_expanded : TEMPLATES.stall_normal;
  const acc = TEMPLATES.stall_accessible;
  const n = row.photoBays;
  // the bay width is the photo pitch, clamped to the statute minimum of the template (주차장법 시행규칙 제3조: 2.5 m
  // 일반형, 2.6 m 확장형), so the drawn dividers land on the painted ones; accessible bays keep 3.3 m
  const pitch = Math.max(tpl.widthM, Math.round((row.photoPitchM ?? tpl.widthM) * 100) / 100);
  const widths = Array.from({ length: n }, (_, k) => (row.accessible.includes(k) ? acc.widthM : pitch));
  const photoLength = norm(sub(end, start));
  const length = widths.reduce((a, w) => a + w, 0);
  const photoAlong = (row.photoDividers ?? []).map((q) => { const d = sub(add(toM(q), shift), start); return d[0] * u[0] + d[1] * u[1]; });
  // the row's first edge: centred on the photo row, then moved by the median offset of the photo dividers from the
  // drawn edges nearest them (within half a bay), so the grid sits on the painted dividers
  let s0 = (photoLength - length) / 2;
  if (photoAlong.length && !row.registered) {
    const grid = [s0];
    for (const w of widths) grid.push(grid.at(-1) + w);
    const offs = photoAlong.map((p) => grid.reduce((best, g) => (Math.abs(p - g) < Math.abs(best) ? p - g : best), Infinity)).filter((d) => Math.abs(d) <= pitch / 2).sort((a, b) => a - b);
    if (offs.length) s0 += offs[offs.length >> 1];
  }
  const lw = tpl.lineM;
  const depth = tpl.depthM;
  const P = (s, t) => add(start, add(scale(u, s), scale(v, t)));
  const rect = (sA, sB, tA, tB) => [P(sA, tA), P(sB, tA), P(sB, tB), P(sA, tB)];
  const edges = [s0];
  for (const w of widths) edges.push(edges.at(-1) + w);
  // the long lines first (rects[0] front, rects[1] back: the back line is left out where the row shares the other
  // row's, but its rectangle stays as the row's outline for the callers)
  const rects = [
    { part: "front", ring: rect(edges[0] - lw / 2, edges[n] + lw / 2, -lw / 2, lw / 2) },
    { part: "back", ring: rect(edges[0] - lw / 2, edges[n] + lw / 2, depth - lw / 2, depth + lw / 2), shared: row.backLine === false },
    ...edges.map((s, k) => ({ part: "divider", k, ring: rect(s - lw / 2, s + lw / 2, lw / 2, depth - lw / 2) })),
  ];
  const symbols = row.accessible.map((k) => ({ k, centre: P((edges[k] + edges[k + 1]) / 2, depth / 2) }));
  const m = LOT_SURFACE_MARGIN_M;
  // photo residual along the row
  const photo = photoAlong;
  // (each divider read on the photo against the drawn divider nearest it; dividers hidden by cars have no photo partner)
  const residual = photo.length ? Math.max(...photo.map((p) => Math.min(...edges.map((s) => Math.abs(p - s))))) : null;
  return {
    template: row.parallel ? "stall_parallel" : expanded ? "stall_expanded" : "stall_normal", pitch, u, v, origin: P(edges[0], 0), widths, depth, line: lw, rects, symbols,
    surface: rect(edges[0] - lw / 2 - m, edges[n] + lw / 2 + m, -lw / 2 - m, depth + lw / 2 + m), photoResidualM: residual,
  };
}

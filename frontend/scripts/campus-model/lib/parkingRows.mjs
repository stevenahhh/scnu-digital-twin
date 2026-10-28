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
  const expanded = row.photoPitchM >= EXPANDED_PITCH_M;
  const tpl = expanded ? TEMPLATES.stall_expanded : TEMPLATES.stall_normal;
  const acc = TEMPLATES.stall_accessible;
  const n = row.photoBays;
  const widths = Array.from({ length: n }, (_, k) => (row.accessible.includes(k) ? acc.widthM : tpl.widthM));
  const photoLength = norm(sub(end, start));
  const length = widths.reduce((a, w) => a + w, 0);
  const s0 = (photoLength - length) / 2;
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
  const photo = (row.photoDividers ?? []).map((q) => { const d = sub(add(toM(q), shift), start); return d[0] * u[0] + d[1] * u[1]; });
  // (each divider read on the photo against the drawn divider nearest it; dividers hidden by cars have no photo partner)
  const residual = photo.length ? Math.max(...photo.map((p) => Math.min(...edges.map((s) => Math.abs(p - s))))) : null;
  return {
    template: expanded ? "stall_expanded" : "stall_normal", u, v, origin: P(edges[0], 0), widths, depth, line: lw, rects, symbols,
    surface: rect(edges[0] - lw / 2 - m, edges[n] + lw / 2 + m, -lw / 2 - m, depth + lw / 2 + m), photoResidualM: residual,
  };
}

// Parking generator (design §6.3, plan campus-ground-truth-redesign todo 12): data/ground/parking.json -> the stall paint
// (pieces of the Road_Markings mesh) and the wheel stops (Furniture solids). The photo's parking_line and disabled_parking
// detections are no longer drawn; they are evidence for the rows (fit/parkingRows.mjs, fit/parkingSeed.mjs).
//
// A row works in its own coordinates: s along the back line from its start, t from the back line towards the aisle.
//   - Divider i stands at s_i = startOffset + the widths of the stalls before it; a stall is pitchM wide unless the record
//     says otherwise (accessible: 3.3 m, 장애인등편의법 시행규칙 별표 1), so an exception pushes the dividers after it.
//   - Accessible and PM bays are row members: the blue fill (inset 0.1 m), the white border, the symbol and the hatched aisle
//     all come from the stall record, so a bay cannot lie askew or alone. Nothing is drawn that the record does not name.
//   - The symbol's top points to the back (a driver entering from the aisle reads it upright) unless the record has a
//     bearing read on the VR or the photo. Sizes are estimates (추정): access symbol 1.2 m, P up to 2.0 m, scooter up to 1.4 m.
// Every piece carries `record` (the row, stall or line id), which the build reports in markings.report.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { hatchTemplate, parkingPTemplate, scooterTemplate, wheelchairTemplate } from "../lib/markingGlyphs.mjs";
import { validate } from "../lib/schemas.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PARKING_PATH = path.join(HERE, "..", "data", "ground", "parking.json");

const ACCESSIBLE_WIDTH_M = 3.3;
const FILL_INSET_M = 0.1;
const SYMBOL_M = 1.2;
const P_M = 2.0;
const SCOOTER_M = 1.4;
const TAIL_M = 0.6; // U and T divider tails (추정)
const DOUBLE_GAP_M = 0.3;
const FILLED = new Set(["accessible", "pm"]);
export const MIN_STALL_M = 2.0; // 주차장법 시행규칙 제3조: parallel 2.0 m, the narrowest kind
export const MAX_GENERAL_STALL_M = 3.6; // wider than the 3.3 m accessible bay plus a margin: likely a missed divider
export const SYMBOL_GLYPHS = Object.freeze(["wheelchair", "P", "scooter", "aisle"]);

const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const mul = (p, k) => [p[0] * k, p[1] * k];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const bearing = (deg) => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
// the TM plane is right-handed seen from above: the right of (E, N) is (N, -E)
const rightOf = (f) => [f[1], -f[0]];

export function loadParking(file = PARKING_PATH) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// The dividers and stalls of a row along s, whatever its back line says about where it lies.
export function rowLayout(row, lengthM = null) {
  const start = row.startOffsetM ?? 0;
  const length = lengthM ?? (row.backLine.abs ? Math.hypot(row.backLine.abs[1][0] - row.backLine.abs[0][0], row.backLine.abs[1][1] - row.backLine.abs[0][1]) : 0);
  const count = row.count ?? Math.floor((length - start) / row.pitchM) + 1;
  const byIndex = new Map(row.stalls.map((s) => [s.index, s]));
  const dividers = [];
  const cells = [];
  let s = start;
  for (let i = 0; i < count; i += 1) {
    dividers.push({ index: i, s });
    if (i === count - 1) break;
    const stall = byIndex.get(i) ?? null;
    const width = stall?.widthM ?? (stall?.kind === "accessible" ? ACCESSIBLE_WIDTH_M : row.pitchM);
    cells.push({ index: i, s0: s, s1: s + width, stall });
    s += width;
  }
  return { dividers, cells };
}

// The back line's frame: at(s, t) in EPSG:5186, a along the line, d from the back towards the aisle.
export function rowFrame(row, resolveAnchor) {
  let line = row.backLine.abs;
  if (!line) {
    if (!resolveAnchor) throw new Error(`${row.id}: backLine.anchor needs a wall resolver`);
    line = resolveAnchor(row.backLine.anchor, row);
  }
  const [p, q] = line;
  const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const a = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
  const left = [-a[1], a[0]];
  const d = Number.isFinite(row.dividerBearingDeg) ? bearing(row.dividerBearingDeg) : mul(left, row.side);
  return { a, d, length, at: (s, t) => add(p, add(mul(a, s), mul(d, t))) };
}

function placeAt(polys, centre, up) {
  const r = rightOf(up);
  return polys.map((rings) => rings.map((ring) => ring.map(([x, y]) => add(centre, add(mul(r, x), mul(up, y))))));
}
// As placeAt, the template's bounding box centred on `centre`.
function place(polys, centre, up) {
  const all = polys.flatMap((rings) => rings[0]);
  const cx = (Math.min(...all.map((p) => p[0])) + Math.max(...all.map((p) => p[0]))) / 2;
  const cy = (Math.min(...all.map((p) => p[1])) + Math.max(...all.map((p) => p[1]))) / 2;
  return placeAt(polys.map((rings) => rings.map((ring) => ring.map(([x, y]) => [x - cx, y - cy]))), centre, up);
}

// parking.json -> { pieces, wheelStops, rows } with scene coordinates. toScene(E, N) -> [x, z]; resolveAnchor(anchor, row)
// -> the [[E, N], [E, N]] of a wall-anchored back line (design §7). An invalid file throws naming every bad record.
export function parkingPlan(doc, { toScene = tmToScene, resolveAnchor = null } = {}) {
  const { ok, errors } = validate("parking", doc);
  if (!ok) throw new Error(`parking.json is invalid:\n${errors.join("\n")}`);
  const pieces = [];
  const wheelStops = [];
  const rows = [];
  const scene = (ring) => ring.map(([E, N]) => toScene(E, N));
  const push = (rings, colour, kind, record, id, extra = {}) => pieces.push({ id, record, kind, colour, estimated: false, rings: rings.map(scene), ...extra });
  for (const lot of doc.lots) {
    for (const row of lot.rows) {
      const { a, d, length, at } = rowFrame(row, resolveAnchor);
      const { dividers, cells } = rowLayout(row, length);
      const depth = row.depthM;
      const quad = (s0, s1, t0, t1) => [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)];
      const style = row.divider?.style ?? "single";
      const w = row.divider?.widthM ?? 0.1;
      const lineColour = row.divider?.colour === "yellow" ? "yellow" : "white";
      const estimatedSet = new Set(row.estimatedDividers ?? []);
      let drawn = 0;
      for (const { index: i, s } of dividers) {
        if (style === "none" || (row.endCaps === false && (i === 0 || i === dividers.length - 1))) continue;
        drawn += 1;
        const id = `${row.id}/D${i}`;
        const paint = (ring, suffix = "") => push([ring], lineColour, "parking_line", row.id, `${id}${suffix}`, { estimated: row.estimated || estimatedSet.has(i) });
        if (style === "double" || style === "U") {
          paint(quad(s - DOUBLE_GAP_M / 2 - w / 2, s - DOUBLE_GAP_M / 2 + w / 2, 0, depth), "a");
          paint(quad(s + DOUBLE_GAP_M / 2 - w / 2, s + DOUBLE_GAP_M / 2 + w / 2, 0, depth), "b");
          if (style === "U") paint(quad(s - DOUBLE_GAP_M / 2 - w / 2, s + DOUBLE_GAP_M / 2 + w / 2, depth - w, depth), "c");
        } else {
          paint(quad(s - w / 2, s + w / 2, 0, depth));
          if (style === "T") paint(quad(s - TAIL_M / 2, s + TAIL_M / 2, depth - w, depth), "t");
        }
      }
      const [first, last] = [dividers[0].s, dividers.at(-1).s];
      const endLine = (t, name) => push([quad(first, last, t - w / 2, t + w / 2)], lineColour, "parking_line", row.id, `${row.id}/${name}`, { glyph: "end_line", estimated: row.estimated });
      if (row.paintBack) endLine(0, "back");
      if (row.paintFront) endLine(depth, "front");

      for (const { s0, s1, stall } of cells) {
        if (!stall) continue;
        const record = stall.id ?? `${row.id}/S${stall.index}`;
        if (FILLED.has(stall.kind)) {
          const [i0, i1, j0, j1] = [s0 + FILL_INSET_M, s1 - FILL_INSET_M, FILL_INSET_M, depth - FILL_INSET_M];
          push([quad(i0, i1, j0, j1)], "blue", "disabled_parking", record, `${record}/fill`, { estimated: Boolean(row.estimated || stall.estimated) });
          push([quad(s0, s1, 0, depth), quad(i0, i1, j0, j1).reverse()], "white", "disabled_parking", record, `${record}/border`, { glyph: "border", estimated: Boolean(row.estimated || stall.estimated) });
        }
        // the part of the bay the symbol owns, narrowed by a hatched aisle and a second figure
        const own = { s0, s1, t0: 0, t1: depth };
        const centreOf = () => at((own.s0 + own.s1) / 2, (own.t0 + own.t1) / 2);
        const SIDES = {
          start: { n: mul(a, -1), key: "s0", sign: 1, half: () => (own.s1 - own.s0) / 2, across: () => own.t1 - own.t0 },
          end: { n: a, key: "s1", sign: -1, half: () => (own.s1 - own.s0) / 2, across: () => own.t1 - own.t0 },
          back: { n: mul(d, -1), key: "t0", sign: 1, half: () => (own.t1 - own.t0) / 2, across: () => own.s1 - own.s0 },
          front: { n: d, key: "t1", sign: -1, half: () => (own.t1 - own.t0) / 2, across: () => own.s1 - own.s0 },
        };
        const symbolPieces = (polys, glyph) => polys.forEach((rings, k) => push(rings, "white", "disabled_parking", record, `${record}/${glyph}${k}`, { glyph }));
        if (stall.aisle) {
          const side = SIDES[stall.aisle.side];
          const h = side.half();
          const width = stall.aisle.outside ? stall.aisle.widthM : Math.min(stall.aisle.widthM, 0.9 * h);
          symbolPieces(placeAt(hatchTemplate(side.across(), width), add(centreOf(), mul(side.n, stall.aisle.outside ? h + width / 2 : h - width / 2)), side.n), "aisle");
          if (!stall.aisle.outside) own[side.key] += side.sign * width;
        }
        if (stall.figure?.symbol === "scooter") {
          const side = SIDES[stall.figure.side];
          const h = side.half() / 2;
          const up = mul(side.n, -1); // its top towards the bay's own symbol
          const mirror = dot(rightOf(up), bearing(stall.figure.frontBearingDeg ?? 0)) < 0;
          let polys = scooterTemplate(Math.min(SCOOTER_M, 0.8 * side.across(), (1.6 * h) / 0.78));
          if (mirror) polys = polys.map((rs) => rs.map((ring) => ring.map(([x, y]) => [-x, y]).reverse()));
          symbolPieces(place(polys, add(centreOf(), mul(side.n, h)), up), "scooter");
          own[side.key] += side.sign * 2 * h;
        }
        // a P beside the wheelchair (scene_e5 b: the bay along the kerb at E3's south-east corner)
        if (stall.figure?.symbol === "P") {
          const side = SIDES[stall.figure.side];
          const h = side.half() / 2;
          const up = Number.isFinite(stall.figure.upBearingDeg) ? bearing(stall.figure.upBearingDeg) : mul(side.n, -1);
          symbolPieces(place(parkingPTemplate(Math.min(P_M, 0.6 * side.across(), 1.6 * h)), add(centreOf(), mul(side.n, h)), up), "P");
          own[side.key] += side.sign * 2 * h;
        }
        if (stall.symbol === "wheelchair" || stall.symbol === "P") {
          const up = Number.isFinite(stall.upBearingDeg) ? bearing(stall.upBearingDeg) : mul(d, -1);
          const [W, D] = [own.s1 - own.s0, own.t1 - own.t0];
          const polys = stall.symbol === "P" ? parkingPTemplate(Math.min(P_M, 0.6 * D, (0.6 * W) / 0.62)) : wheelchairTemplate(Math.min(SYMBOL_M, 0.55 * W, 0.45 * D));
          symbolPieces(place(polys, centreOf(), up), stall.symbol);
        }
      }

      const before = wheelStops.length;
      if (row.wheelStops) {
        const every = row.wheelStops.every ?? 1;
        const offset = row.wheelStops.offsetFromBackM;
        cells.forEach(({ index, s0, s1 }) => {
          if (index % every) return;
          const p = at((s0 + s1) / 2, offset);
          const centre = toScene(p[0], p[1]);
          const tip = toScene(p[0] + a[0], p[1] + a[1]);
          const norm = Math.hypot(tip[0] - centre[0], tip[1] - centre[1]);
          wheelStops.push({ id: `${row.id}/W${index}`, record: row.id, centre, u: [(tip[0] - centre[0]) / norm, (tip[1] - centre[1]) / norm], lengthM: row.wheelStops.lengthM, colour: row.wheelStops.colour });
        });
      }
      rows.push({
        lot: lot.id, row: row.id, dividers: drawn, estimatedDividers: estimatedSet.size, specialStalls: row.stalls.filter((s) => s.kind !== "general").length,
        wheelStops: wheelStops.length - before, photoSupport: row.evidence.photoSupport ?? null, tier: row.evidence.tier,
      });
    }
    for (const line of lot.lines ?? []) {
      let ring = line.ring;
      if (!ring) {
        const [p, q] = line.abs;
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const n = [(-(q[1] - p[1]) / length) * (line.widthM / 2), ((q[0] - p[0]) / length) * (line.widthM / 2)];
        ring = [add(p, mul(n, -1)), add(q, mul(n, -1)), add(q, n), add(p, n)];
      }
      push([ring], line.colour === "yellow" ? "yellow" : "white", "parking_line", line.id, line.id, { estimated: line.evidence.tier === "T4" });
    }
  }
  return { pieces, wheelStops, rows, lots: doc.lots.length };
}

// Design §6.3: every lot names a parcel of data/ground/parcels.json.
export function assertLotsOnParcels(doc, parcels) {
  const ids = new Set(parcels.map((p) => p.id));
  const bad = doc.lots.filter((lot) => !ids.has(lot.parcel));
  if (bad.length) throw new Error(bad.map((lot) => `${lot.id}: parcel ${lot.parcel} is not in parcels.json`).join("\n"));
}

// Stalls no single stall can be: too narrow, or general and too wide. Named by row in the build log and markings.report.
export function implausibleStalls(doc) {
  const out = [];
  for (const lot of doc.lots) {
    for (const row of lot.rows) {
      for (const { index, s0, s1, stall } of rowLayout(row).cells) {
        const widthM = Number((s1 - s0).toFixed(3));
        const general = !stall || stall.kind === "general";
        if (widthM < MIN_STALL_M || (general && widthM > MAX_GENERAL_STALL_M)) out.push({ row: row.id, index, kind: stall?.kind ?? "general", widthM, estimated: row.estimated, dividers: row.divider?.style !== "none" });
      }
    }
  }
  return out;
}

// markings.report: the symbol pieces by glyph and record. `unrecorded` must be 0: a symbol exists only through its record.
export function symbolPieceReport(pieces) {
  const byGlyph = {};
  const records = new Set();
  let unrecorded = 0;
  for (const piece of pieces) {
    if (!SYMBOL_GLYPHS.includes(piece.glyph)) continue;
    byGlyph[piece.glyph] = (byGlyph[piece.glyph] ?? 0) + 1;
    if (piece.record) records.add(piece.record);
    else unrecorded += 1;
  }
  return { byGlyph, records: [...records].sort(), unrecorded };
}

// The build log, per lot: rows, dividers, estimated dividers, the median photo support.
export function describeParking(plan) {
  const lots = new Map();
  for (const r of plan.rows) {
    if (!lots.has(r.lot)) lots.set(r.lot, []);
    lots.get(r.lot).push(r);
  }
  const sum = (key) => plan.rows.reduce((n, r) => n + r[key], 0);
  const median = (list) => { const s = list.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
  return [
    `parking: ${plan.lots} lots, ${plan.rows.length} rows, ${sum("dividers")} dividers (${sum("estimatedDividers")} 추정), ${sum("specialStalls")} special stalls, ${plan.wheelStops.length} wheel stops`,
    ...[...lots].map(([id, rows]) => `  ${id}: ${rows.length} rows, ${rows.reduce((n, r) => n + r.dividers, 0)} dividers, ${rows.reduce((n, r) => n + r.estimatedDividers, 0)} 추정, photoSupport ${median(rows.map((r) => r.photoSupport))}`),
  ].join("\n");
}

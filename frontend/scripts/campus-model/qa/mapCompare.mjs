// Map-space per-object comparison (design §10.1): how far each drawn object sits from what the NGII orthophoto shows.
//
// Pure scorer: no file is read and no pixel leaves the caller. Inputs are EPSG:5186 metres (east, north).
//   objects: [{ id, kind, colour?, geometry }], geometry one of
//     { type: "line", coords: [[E, N], ...] }      lateral residual against the photo's paint ridge
//     { type: "line", parts: [coords, ...] }       the same over several pieces (dashes), pooled
//     { type: "area", rings: [outer, ...holes] }   IoU against the photo's paint, residual = centroid distance
//     { type: "point", coords: [E, N] }            distance to the nearest reference point of the same kind
//   sheet: { w, h, origin: [E, N] of the top-left pixel corner, gsdM, paint: { white, yellow, blue } (Uint8Array w*h,
//     1 = paint), points?: { [kind]: [[E, N], ...] } }
//   masks: { any?: Uint8Array w*h } occlusion (lib/occlusion.mjs `any`: leaned roofs, crowns, cast shadows)
// Result per object: { id, kind, tier, residual_m, iou, support, occluded, over }. An object whose visible share is
// below MIN_VISIBLE is `occluded: true` and never `over` (the photo cannot judge it). `over` is a warning, not an
// error: the photo can be wrong (§10.1 step 4).
import { rowFrame, rowLayout } from "../stages/parking.mjs";

export const TOLERANCES = Object.freeze({
  parking_divider: Object.freeze({ residualM: 0.3, support: 0.5 }),
  lane: Object.freeze({ residualM: 0.25, support: 0.6 }),
  crossing_bar: Object.freeze({ residualM: 0.2, iou: 0.6 }),
  blue_zone: Object.freeze({ iou: 0.6 }),
  kerb: Object.freeze({ residualM: 0.3 }),
});

export const LINE_STEP_M = 0.25; // sample spacing along a line (one photo pixel)
export const SCAN_STEP_M = 0.05; // perpendicular scan step
export const SCAN_REACH_M = 1.0; // perpendicular scan half length: paint farther than this does not support the line
export const AREA_MARGIN_M = 0.5; // photo paint counted for an area: inside its bbox grown by this much
export const MIN_VISIBLE = 0.2; // below this visible share an object is reported occluded
export const POINT_REACH_M = 5; // a reference point farther than this does not match

const LANE_KINDS = /^(centre_line|lane_line|edge_line|guide_)/;

export function classify(kind, type, colour = null) {
  if (type === "point") return "point";
  if (/^kerb/.test(kind)) return "kerb";
  if (type === "line") {
    if (/^parking_(line|divider)/.test(kind)) return "parking_divider";
    if (LANE_KINDS.test(kind)) return "lane";
    return "other";
  }
  if (kind === "zebra_bar") return "crossing_bar";
  if (colour === "blue" || kind === "bike_lane_blue" || kind === "disabled_parking") return "blue_zone";
  return "other";
}

const round = (v, k = 3) => (v === null ? null : Math.round(v * 10 ** k) / 10 ** k);
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function pixelOf(sheet, E, N) {
  const i = Math.floor((E - sheet.origin[0]) / sheet.gsdM);
  const j = Math.floor((sheet.origin[1] - N) / sheet.gsdM);
  return i < 0 || j < 0 || i >= sheet.w || j >= sheet.h ? -1 : j * sheet.w + i;
}
const at_ = (mask, k) => (mask && k >= 0 ? mask[k] : 0);

function insideRings(rings, E, N) {
  let inside = false;
  for (const ring of rings) {
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a, a += 1) {
      const [xa, ya] = ring[a];
      const [xb, yb] = ring[b];
      if ((ya > N) !== (yb > N) && E < ((xb - xa) * (N - ya)) / (yb - ya) + xa) inside = !inside;
    }
  }
  return inside;
}

function over(tier, { residual, iou, support }) {
  const tol = TOLERANCES[tier];
  if (!tol) return false;
  if (tol.residualM !== undefined && (residual === null || residual > tol.residualM)) return true;
  if (tol.support !== undefined && support < tol.support) return true;
  if (tol.iou !== undefined && (iou === null || iou < tol.iou)) return true;
  return false;
}

// Samples every LINE_STEP_M; at each visible sample a perpendicular scan finds the paint run nearest the line and
// takes its centre as the ridge. support = visible samples with a ridge / visible samples; residual = median offset.
function scoreLine(coords, paint, sheet, any) {
  let total = 0;
  let visible = 0;
  const offsets = [];
  const reach = Math.round(SCAN_REACH_M / SCAN_STEP_M);
  for (let s = 1; s < coords.length; s += 1) {
    const [a, b] = [coords[s - 1], coords[s]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n = [-d[1], d[0]];
    const count = Math.max(1, Math.round(len / LINE_STEP_M));
    for (let k = 0; k < count; k += 1) {
      const t = (k + 0.5) * (len / count);
      const p = [a[0] + d[0] * t, a[1] + d[1] * t];
      total += 1;
      if (at_(any, pixelOf(sheet, p[0], p[1]))) continue;
      visible += 1;
      const painted = [];
      for (let q = -reach; q < reach; q += 1) {
        const o = (q + 0.5) * SCAN_STEP_M; // half-step offset: no sample sits on a pixel edge
        painted.push(at_(paint, pixelOf(sheet, p[0] + n[0] * o, p[1] + n[1] * o)) ? 1 : 0);
      }
      // runs of paint along the scan; the one whose nearest sample is closest to the line wins
      let best = null;
      for (let q = 0; q < painted.length; q += 1) {
        if (!painted[q] || (q > 0 && painted[q - 1])) continue;
        let e = q;
        while (e + 1 < painted.length && painted[e + 1]) e += 1;
        const lo = (q - reach + 0.5) * SCAN_STEP_M;
        const hi = (e - reach + 0.5) * SCAN_STEP_M;
        const gap = lo <= 0 && hi >= 0 ? 0 : Math.min(Math.abs(lo), Math.abs(hi));
        // a run cut by the scan end has no reliable centre
        if ((q === 0 || e === painted.length - 1) && gap > 0) continue;
        if (!best || gap < best.gap) best = { gap, centre: (lo + hi) / 2 };
      }
      if (best) offsets.push(Math.abs(best.centre));
    }
  }
  return { total, visible, offsets };
}

function scoreParts(parts, paint, sheet, any) {
  const all = parts.map((coords) => scoreLine(coords, paint, sheet, any));
  const total = all.reduce((n, r) => n + r.total, 0);
  const visible = all.reduce((n, r) => n + r.visible, 0);
  const offsets = all.flatMap((r) => r.offsets);
  return { total, visible, support: visible ? offsets.length / visible : 0, residual: offsets.length ? median(offsets) : null };
}

function scoreArea(rings, paint, sheet, any) {
  const xs = rings[0].map((p) => p[0]);
  const ys = rings[0].map((p) => p[1]);
  const lo = [Math.min(...xs) - AREA_MARGIN_M, Math.min(...ys) - AREA_MARGIN_M];
  const hi = [Math.max(...xs) + AREA_MARGIN_M, Math.max(...ys) + AREA_MARGIN_M];
  const i0 = Math.max(0, Math.floor((lo[0] - sheet.origin[0]) / sheet.gsdM));
  const i1 = Math.min(sheet.w - 1, Math.floor((hi[0] - sheet.origin[0]) / sheet.gsdM));
  const j0 = Math.max(0, Math.floor((sheet.origin[1] - hi[1]) / sheet.gsdM));
  const j1 = Math.min(sheet.h - 1, Math.floor((sheet.origin[1] - lo[1]) / sheet.gsdM));
  let drawn = 0;
  let drawnVisible = 0;
  let both = 0;
  let union = 0;
  const cd = [0, 0];
  const cp = [0, 0];
  let photo = 0;
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const k = j * sheet.w + i;
      const E = sheet.origin[0] + (i + 0.5) * sheet.gsdM;
      const N = sheet.origin[1] - (j + 0.5) * sheet.gsdM;
      const d = insideRings(rings, E, N);
      if (d) drawn += 1;
      if (at_(any, k)) continue;
      const p = Boolean(paint[k]);
      if (d) { drawnVisible += 1; cd[0] += E; cd[1] += N; }
      if (p) { photo += 1; cp[0] += E; cp[1] += N; }
      if (d && p) both += 1;
      if (d || p) union += 1;
    }
  }
  const residual = drawnVisible && photo ? Math.hypot(cd[0] / drawnVisible - cp[0] / photo, cd[1] / drawnVisible - cp[1] / photo) : null;
  return { total: drawn, visible: drawnVisible, iou: union ? both / union : 0, support: drawnVisible ? both / drawnVisible : 0, residual };
}

function scorePoint(obj, sheet, any) {
  const [E, N] = obj.geometry.coords;
  if (at_(any, pixelOf(sheet, E, N))) return { total: 1, visible: 0, support: 0, residual: null };
  const refs = sheet.points?.[obj.kind] ?? [];
  let best = Infinity;
  for (const [x, y] of refs) best = Math.min(best, Math.hypot(x - E, y - N));
  return best <= POINT_REACH_M ? { total: 1, visible: 1, support: 1, residual: best } : { total: 1, visible: 1, support: 0, residual: null };
}

export function scoreObjects(objects, sheet, masks = {}) {
  const any = masks.any ?? null;
  return objects.map((obj) => {
    const { type } = obj.geometry;
    const tier = classify(obj.kind, type, obj.colour ?? null);
    const paint = sheet.paint?.[obj.colour ?? "white"] ?? sheet.paint?.white;
    const r = type === "line" ? scoreParts(obj.geometry.parts ?? [obj.geometry.coords], paint, sheet, any)
      : type === "area" ? scoreArea(obj.geometry.rings, paint, sheet, any)
        : scorePoint(obj, sheet, any);
    const occluded = r.total > 0 && r.visible / r.total < MIN_VISIBLE;
    const iou = type === "area" && !occluded ? r.iou : null;
    const result = {
      id: obj.id,
      kind: obj.kind,
      tier,
      residual_m: occluded ? null : round(r.residual),
      iou: iou === null ? null : round(iou),
      support: occluded ? null : round(r.support),
      occluded,
    };
    result.over = occluded ? false : over(tier, { residual: r.residual, iou, support: r.support });
    return result;
  });
}

// ---------------------------------------------------------------- generated parking rows (plan todo 13)
// The rows of data/ground/parking.json as objects to score. Dividers stop short of the rails: within a scan's reach of a rail
// the rail's paint would read as the divider's. A row's stalls never draw an end line the record does not name.
const DIVIDER_TRIM_M = 0.4;
const trimOf = (row) => Math.min(DIVIDER_TRIM_M, row.depthM * 0.15);
const BLUE_KINDS = new Set(["accessible", "pm"]);
export function parkingObjects(doc, { resolveAnchor = null } = {}) {
  const out = [];
  for (const lot of doc.lots) {
    for (const row of lot.rows) {
      const { at, length } = rowFrame(row, resolveAnchor);
      const { dividers, cells } = rowLayout(row, length);
      const colour = row.divider?.colour === "yellow" ? "yellow" : "white";
      const trim = trimOf(row);
      const estimated = new Set(row.estimatedDividers ?? []);
      const flagged = row.estimatedFields ?? {};
      const line = (id, kind, from, to, extra = {}) => out.push({ id, kind, colour, row: row.id, ...extra, geometry: { type: "line", coords: [from, to] } });
      if (row.divider?.style !== "none") {
        for (const { index, s } of dividers) {
          if (row.endCaps === false && (index === 0 || index === dividers.length - 1)) continue;
          line(`${row.id}/D${index}`, "parking_divider", at(s, trim), at(s, row.depthM - trim), { estimated: row.estimated || estimated.has(index) || Boolean(flagged.depthM) });
        }
      }
      const [first, last] = [dividers[0].s, dividers.at(-1).s];
      if (row.paintBack) line(`${row.id}/back`, "parking_line", at(first, 0), at(last, 0), { estimated: Boolean(row.estimated || flagged.paintBack) });
      if (row.paintFront) line(`${row.id}/front`, "parking_line", at(first, row.depthM), at(last, row.depthM), { estimated: Boolean(row.estimated || flagged.paintFront) });
      for (const { s0, s1, stall } of cells) {
        if (!stall || !BLUE_KINDS.has(stall.kind)) continue;
        const box = { s0: s0 + 0.1, s1: s1 - 0.1, t0: 0.1, t1: row.depthM - 0.1 };
        const aisle = stall.aisle && !stall.aisle.outside ? stall.aisle : null;
        if (aisle?.side === "start") box.s0 = s0 + aisle.widthM;
        if (aisle?.side === "end") box.s1 = s1 - aisle.widthM;
        if (aisle?.side === "back") box.t0 = aisle.widthM;
        if (aisle?.side === "front") box.t1 = row.depthM - aisle.widthM;
        out.push({ id: `${stall.id ?? `${row.id}/S${stall.index}`}/fill`, kind: "disabled_parking", colour: "blue", row: row.id, estimated: Boolean(row.estimated || flagged.depthM || stall.estimated || stall.estimatedFields?.widthM), geometry: { type: "area", rings: [[at(box.s0, box.t0), at(box.s1, box.t0), at(box.s1, box.t1), at(box.s0, box.t1)]] } });
      }
    }
    for (const line of lot.lines ?? []) {
      const colour = line.colour === "yellow" ? "yellow" : "white";
      if (line.abs) out.push({ id: line.id, kind: "parking_line", colour, estimated: Boolean(line.estimated), geometry: { type: "line", coords: line.abs } });
      else out.push({ id: line.id, kind: "parking_line", colour, estimated: Boolean(line.estimated), geometry: { type: "area", rings: [line.ring] } });
    }
  }
  return out;
}

// scoreObjects only sees what is drawn, so a line the record lost passes unnoticed. This walks along each row, one stall past
// both ends, and looks for paint running the depth of the row at a place no drawn line explains. Masked places are no evidence.
const WIDEST_STALL_M = 3.6; // an accessible bay (stages/parking.mjs MAX_GENERAL_STALL_M)
const RIDGE_SHARE = 0.6; // of a row's depth painted, to be a line at this place
const RIDGE_MAX_WIDTH_M = 0.8; // wider paint is a band or a fill
const DRAWN_COS = Math.cos((15 * Math.PI) / 180);
function drawnNear(objects, from, to, tolerance) {
  const u = [to[0] - from[0], to[1] - from[1]];
  const length = Math.hypot(u[0], u[1]);
  const dir = [u[0] / length, u[1] / length];
  const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  return objects.some((o) => {
    if (o.geometry.type !== "line") return false;
    const [a, b] = o.geometry.coords;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) return false;
    const e = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    if (Math.abs(dir[0] * e[0] + dir[1] * e[1]) < DRAWN_COS) return false;
    const v = [mid[0] - a[0], mid[1] - a[1]];
    const along = v[0] * e[0] + v[1] * e[1];
    return along >= -1 && along <= len + 1 && Math.abs(v[0] * e[1] - v[1] * e[0]) <= tolerance;
  });
}
export function missingDividers(doc, objects, sheet, masks = {}, { resolveAnchor = null } = {}) {
  const any = masks.any ?? null;
  const tolerance = TOLERANCES.parking_divider.residualM;
  const out = [];
  for (const lot of doc.lots) {
    for (const row of lot.rows) {
      if (row.divider?.style === "none") continue;
      const { at, length } = rowFrame(row, resolveAnchor);
      const { dividers } = rowLayout(row, length);
      const paint = sheet.paint?.[row.divider?.colour === "yellow" ? "yellow" : "white"] ?? sheet.paint?.white;
      const trim = trimOf(row);
      const samples = [];
      for (let t = trim; t <= row.depthM - trim + 1e-9; t += LINE_STEP_M) samples.push(t);
      const reach = Math.max(row.pitchM, WIDEST_STALL_M) + 0.5;
      const [s0, s1] = [dividers[0].s - reach, dividers.at(-1).s + reach];
      let run = null;
      const close = (end) => {
        if (run && end - run <= RIDGE_MAX_WIDTH_M) {
          const s = (run + end) / 2;
          const [from, to] = [at(s, trim), at(s, row.depthM - trim)];
          if (!drawnNear(objects, from, to, tolerance)) {
            out.push({ id: `${row.id}/missing@${s.toFixed(1)}`, kind: "parking_divider", tier: "parking_divider", row: row.id, residual_m: null, iou: null, support: 0, occluded: false, over: true, missing: true, centreTm: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2].map((v) => round(v, 2)) });
          }
        }
        run = null;
      };
      for (let s = s0; s <= s1 + 1e-9; s += SCAN_STEP_M) {
        let visible = 0;
        let painted = 0;
        for (const t of samples) {
          const [E, N] = at(s, t);
          const k = pixelOf(sheet, E, N);
          if (k < 0 || at_(any, k)) continue;
          visible += 1;
          if (paint[k]) painted += 1;
        }
        const line = visible >= samples.length / 2 && painted / visible >= RIDGE_SHARE;
        if (line && run === null) run = s;
        if (!line && run !== null) close(s);
      }
      if (run !== null) close(s1);
    }
  }
  return out;
}

// One line per lot, for todo 14's acceptance: a reviewed lot holds support >= LOT_SUPPORT over what the photo can judge, or is
// marked estimated with a reason; a lot nobody reviewed never passes.
export const LOT_SUPPORT = 0.7;
export function lotSummary(doc, results) {
  return doc.lots.map((lot) => {
    const own = results.filter((r) => r.id.startsWith(`${lot.id}/`));
    const judged = own.filter((r) => /\/(D\d+|L\d+)$/.test(r.id) && !r.occluded);
    const support = judged.length ? round(judged.reduce((n, r) => n + r.support, 0) / judged.length) : null;
    const estimated = Boolean(lot.estimated);
    return {
      lot: lot.id, curated: lot.curated ?? null, unreviewed: Boolean(lot.unreviewed), estimated, estimatedReason: lot.estimatedReason ?? null,
      rows: lot.rows.length, lines: (lot.lines ?? []).length, visible: judged.length, support,
      over: own.filter((r) => r.over).map((r) => r.id), missing: own.filter((r) => r.missing).length,
      accepted: !lot.unreviewed && (estimated || (support !== null && support >= LOT_SUPPORT)),
    };
  });
}

// Per row: what the acceptance of a curated lot reads. results: scoreObjects plus missingDividers.
export function rowSummary(doc, results) {
  const out = [];
  for (const lot of doc.lots) {
    for (const row of lot.rows) {
      const own = (test) => results.filter((r) => r.id.startsWith(`${row.id}/`) && test(r));
      const dividers = own((r) => /\/D\d+$/.test(r.id));
      const seen = dividers.filter((r) => !r.occluded);
      const end = (name) => { const [r] = own((x) => x.id === `${row.id}/${name}`); return r ? { support: r.support, residualM: r.residual_m, over: r.over, occluded: r.occluded } : null; };
      const residuals = seen.map((r) => r.residual_m).filter((v) => v !== null);
      out.push({
        lot: lot.id, row: row.id, tier: row.evidence.tier, estimated: row.estimated,
        estimatedDividers: row.estimatedDividers ?? [],
        estimatedValues: [
          ...Object.entries(row.estimatedFields ?? {}).map(([name, flag]) => (flag.seenM ? `${name} seen ${flag.seenM[0]}-${flag.seenM[1]} m` : name)),
          ...row.stalls.flatMap((s) => Object.keys(s.estimatedFields ?? {}).map((name) => `S${s.index} ${name}`)),
        ],
        dividers: dividers.length, stalls: Math.max(0, dividers.length - 1), visibleDividers: seen.length,
        support: seen.length ? round(seen.reduce((n, r) => n + r.support, 0) / seen.length) : null,
        medianResidualM: residuals.length ? round(median(residuals)) : null, maxResidualM: residuals.length ? Math.max(...residuals) : null,
        over: dividers.filter((r) => r.over).map((r) => r.id), missing: own((r) => r.missing).length,
        endLines: { back: end("back"), front: end("front") }, fills: own((r) => /\/fill$/.test(r.id)).map((r) => ({ id: r.id, iou: r.iou, support: r.support, occluded: r.occluded })),
      });
    }
  }
  return out;
}

// Shared validators for the curated campus-model data files. validate(kind, doc) -> { ok, errors[] }; every error
// string starts with the id of the record it is about (a node id, or the kind name for file-level errors), so a
// failing build points straight at the entry to fix. Run as a CLI: `bun lib/schemas.mjs <kind> <file>` exits 1 and
// prints the errors to stderr when the file is invalid.
import { readFileSync } from "node:fs";

import { DESIGN_CLASSES, PAINT_CLASSES } from "./parcels.mjs";

const isPair = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const isText = (value) => typeof value === "string" && value.length > 0;

// data/bld-node-map.json: uni.glb BLD_* node -> GIS 건물통합정보 record (design §3, §11).
function bldNodeMap(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.entries)) return ["bldNodeMap: entries must be an array"];
  const errors = [];
  // inputs: { <repo-relative path>: sha256 hex } of the files the map was matched on (stale-map check).
  // Optional here; stages/buildings.mjs requires it (checkNodeMapInputs).
  if (doc.inputs !== undefined && (!doc.inputs || typeof doc.inputs !== "object" ||
    !Object.values(doc.inputs).every((v) => /^[0-9a-f]{64}$/.test(v)))) errors.push("bldNodeMap: inputs must map each input file to its sha256 hex");
  const nodes = new Map();
  const records = new Map();
  doc.entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      errors.push(`entries[${index}]: entry must be an object`);
      return;
    }
    const id = isText(entry.nodeId) ? entry.nodeId : `entries[${index}]`;
    const fail = (message) => errors.push(`${id}: ${message}`);
    if (!/^BLD_/.test(entry.nodeId ?? "")) fail("nodeId must be a BLD_* node id");
    else if (nodes.has(id)) fail(`nodeId repeats ${nodes.get(id)}`);
    else nodes.set(id, `entries[${index}]`);
    if (entry.gis === null || entry.gis === undefined) {
      // A curated null says on purpose that the node has no GIS record of its own (the reason names why).
      if (entry.curated !== true) fail("gis is null: no GIS footprint with IoU >= 0.5; curate it (gis, curated:true, reason)");
    } else if (typeof entry.gis !== "object" || !isText(entry.gis.footprintSource)) {
      fail("gis.footprintSource must be a non-empty string");
    } else {
      if (!(entry.gis.pnu === null || isText(entry.gis.pnu))) fail("gis.pnu must be a string or null");
      const other = records.get(entry.gis.footprintSource);
      if (other) fail(`GIS record "${entry.gis.footprintSource}" is also mapped to ${other}`);
      else records.set(entry.gis.footprintSource, id);
    }
    if (!isPair(entry.gisCentreTm) && entry.gis) fail("gisCentreTm must be [E, N]");
    if (!isPair(entry.uniCentreScene)) fail("uniCentreScene must be [x, z]");
    if (!(entry.iou === null || (Number.isFinite(entry.iou) && entry.iou >= 0 && entry.iou <= 1))) fail("iou must be a number in [0, 1] or null");
    if (typeof entry.curated !== "boolean") fail("curated must be a boolean");
    else if (entry.curated && !isText(entry.reason)) fail("curated:true needs a one-line reason");
    else if (!entry.curated && entry.gis && !(entry.iou >= 0.5)) fail("uncurated match needs iou >= 0.5");
  });
  return errors;
}

// data/registration.json: per-source transform and residual (design §9), written by fit/registration.mjs.
function registration(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.sources)) return ["registration: sources must be an array"];
  const errors = [];
  if (!isText(doc.frame)) errors.push("registration: frame must name the CRS");
  const seen = new Set();
  doc.sources.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      errors.push(`sources[${index}]: entry must be an object`);
      return;
    }
    const id = isText(entry.source) ? entry.source : `sources[${index}]`;
    const fail = (message) => errors.push(`${id}: ${message}`);
    if (!isText(entry.source)) fail("source must be a non-empty string");
    else if (seen.has(id)) fail("source repeats");
    else seen.add(id);
    if (typeof entry.available !== "boolean") fail("available must be a boolean");
    if (typeof entry.measured !== "boolean") fail("measured must be a boolean");
    if (!(entry.residual_m === null || (Number.isFinite(entry.residual_m) && entry.residual_m >= 0))) fail("residual_m must be a number >= 0 or null");
    if (!(Number.isInteger(entry.n) && entry.n >= 0)) fail("n must be an integer >= 0");
    if (!(entry.transform === null || (entry.transform && typeof entry.transform === "object" && isText(entry.transform.type)))) fail("transform must be null or an object with a type");
    if (entry.available && entry.measured) {
      if (!entry.transform) fail("a measured source needs a transform");
      if (!(entry.n >= 2)) fail("a measured source needs n >= 2");
    }
  });
  return errors;
}

// ---- data/ground/parcels.json (design §5, fit/parcelsSeed.mjs): one record per ground polygon, EPSG:5186 rings.
const PARCEL_CLASSES = new Set(["SPORTS", "PAVING", "ASPHALT", "LOT", "BICYCLE"]);
const TIERS = new Set(["T0", "T1", "T2", "T3", "T4"]);
const EPS = 1e-3; // metres: shared edges and vertices on the other outline are touching, not overlapping
const isRing = (ring) => Array.isArray(ring) && ring.length >= 3 && ring.every(isPair);
const bbox = (ring) => ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
function edgeDistance([px, py], ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}
function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const strictlyInside = (point, ring) => inside(point, ring) && edgeDistance(point, ring) > EPS;
function properCross(a, b, c, d) {
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const e = EPS * EPS;
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}
// A point inside the ring: the middle of the widest span on the horizontal line through the bbox centre.
function interiorPoint(ring) {
  const b = bbox(ring);
  const y = (b[1] + b[3]) / 2;
  const xs = [];
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
  }
  xs.sort((p, q) => p - q);
  let pick = null;
  for (let k = 0; k + 1 < xs.length; k += 2) if (!pick || xs[k + 1] - xs[k] > pick[1] - pick[0]) pick = [xs[k], xs[k + 1]];
  return pick ? [(pick[0] + pick[1]) / 2, y] : ring[0];
}
function ringsOverlap(a, b) {
  for (let i = 0; i < a.length; i += 1) for (let j = 0; j < b.length; j += 1) if (properCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  if (a.some((p) => strictlyInside(p, b)) || b.some((p) => strictlyInside(p, a))) return true;
  return strictlyInside(interiorPoint(a), b) || strictlyInside(interiorPoint(b), a);
}

// Index pairs [i, j] (i < j) of parcels with the same precedence whose outer rings overlap with positive area.
export function overlapPairs(list) {
  const boxes = list.map((p) => (isRing(p?.ring) ? bbox(p.ring) : null));
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (!a || !b || list[i].precedence !== list[j].precedence) continue;
      if (a[2] <= b[0] + EPS || b[2] <= a[0] + EPS || a[3] <= b[1] + EPS || b[3] <= a[1] + EPS) continue;
      if (ringsOverlap(list[i].ring, list[j].ring)) pairs.push([i, j]);
    }
  }
  return pairs;
}

function parcels(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.parcels)) return ["parcels: parcels must be an array"];
  const errors = [];
  const ids = new Map();
  doc.parcels.forEach((parcel, index) => {
    const id = isText(parcel?.id) ? parcel.id : `parcels[${index}]`;
    const fail = (message) => errors.push(`${id}: ${message}`);
    if (!parcel || typeof parcel !== "object") return fail("parcel must be an object");
    if (!/^PARCEL_[A-Z0-9_]+$/.test(parcel.id ?? "")) fail("id must match PARCEL_[A-Z0-9_]+");
    else if (ids.has(id)) fail(`id repeats parcels[${ids.get(id)}]`);
    else ids.set(id, index);
    if (!PARCEL_CLASSES.has(parcel.cls)) fail(`cls must be one of ${[...PARCEL_CLASSES].join(", ")}`);
    if (parcel.class !== undefined && !DESIGN_CLASSES.includes(parcel.class)) fail(`class must be one of ${DESIGN_CLASSES.join(", ")}`);
    if (parcel.class !== undefined && parcel.paintAllowed !== PAINT_CLASSES.has(parcel.class)) fail(`paintAllowed must be ${PAINT_CLASSES.has(parcel.class)} for class ${parcel.class}`);
    if (!isRing(parcel.ring)) fail("ring must be at least 3 [E, N] pairs");
    if (!Array.isArray(parcel.holes) || !parcel.holes.every(isRing)) fail("holes must be an array of rings");
    if (!Number.isFinite(parcel.precedence)) fail("precedence must be a number");
    if (!isText(parcel.source)) fail("source must be a non-empty string");
    if (!isText(parcel.source_ref)) fail("source_ref must be a non-empty string");
    if (!TIERS.has(parcel.evidence?.tier)) fail("evidence.tier must be T0-T4");
    if (!Array.isArray(parcel.evidence?.refs) || !parcel.evidence.refs.every(isText)) fail("evidence.refs must be an array of strings");
    if (typeof parcel.paintAllowed !== "boolean") fail("paintAllowed must be a boolean");
    if (typeof parcel.estimated !== "boolean") fail("estimated must be a boolean");
    else if (parcel.evidence?.tier === "T4" && !parcel.estimated) fail("estimated must be true for a T4 parcel");
  });
  doc.parcels.forEach((parcel, index) => {
    if (parcel?.over === undefined) return;
    if (!Array.isArray(parcel.over) || !parcel.over.every((o) => ids.has(o) && ids.get(o) < index)) errors.push(`${parcel.id}: over must list ids of earlier parcels`);
  });
  const listed = (upper, lower) => Array.isArray(upper.over) && upper.over.includes(lower.id);
  for (const [i, j] of overlapPairs(doc.parcels)) {
    const [a, b] = [doc.parcels[i], doc.parcels[j]];
    if (!listed(b, a)) errors.push(`${a.id}: overlaps ${b.id} at the same precedence ${a.precedence}; list ${a.id} in ${b.id}.over or change a precedence`);
  }
  return errors;
}

// ---- data/ground/parking.json (design §6.1): lot id -> parametric rows; accessible bays are row members.
const STALL_KINDS = new Set(["general", "expanded", "accessible", "parallel", "light", "ev", "pm"]);
const DIVIDER_STYLES = new Set(["single", "double", "U", "T", "none"]); // none: a row of wheel stops whose dividers the photo does not show
const AISLE_SIDES = ["start", "end", "back", "front"];
const positive = (v) => Number.isFinite(v) && v > 0;
const MIN_STALL_M = 2; // the narrowest stall: 주차장법 시행규칙 제3조 parallel 2.0 m
function backLineErrors(line) {
  if (!line || typeof line !== "object") return "backLine must be { abs } or { anchor }";
  if (line.abs !== undefined) return Array.isArray(line.abs) && line.abs.length === 2 && line.abs.every(isPair) ? null : "backLine.abs must be two [E, N] pairs";
  const a = line.anchor;
  if (a && isText(a.building) && isText(a.wall) && [a.s0M, a.s1M, a.tM].every(Number.isFinite)) return null;
  return "backLine.anchor needs building, wall, s0M, s1M, tM";
}
// Stalls of a row; count null fits the back line as stages/parking.mjs rowLayout does.
function baysOf(row) {
  if (Number.isInteger(row.count)) return row.count - 1;
  const [p, q] = row.backLine?.abs ?? [];
  const length = p && q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : (row.backLine?.anchor?.s1M ?? 0) - (row.backLine?.anchor?.s0M ?? 0);
  return Number.isFinite(length) && positive(row.pitchM) ? Math.max(0, Math.floor((length - (row.startOffsetM ?? 0)) / row.pitchM)) : 0;
}
// A value of a row that is an estimate (추정) while the rest of the row is measured. { field: { reason, seenM? } }; seenM is the
// part of an end line seen on the photo, in metres along the row. It reaches parking.json, the GLB extras and the mapCompare table.
const ESTIMATED_FIELDS = new Set(["depthM", "wheelStops", "paintBack", "paintFront"]);
function estimatedFieldErrors(row, fail) {
  const fields = row.estimatedFields;
  if (fields === undefined) return;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return fail("estimatedFields must be an object: { field: { reason } }");
  for (const [name, flag] of Object.entries(fields)) {
    if (!ESTIMATED_FIELDS.has(name)) { fail(`estimatedFields.${name} is not a field that can be flagged (${[...ESTIMATED_FIELDS].join(", ")})`); continue; }
    if (name !== "depthM" && !row[name]) fail(`estimatedFields.${name} flags a value the row does not have`);
    if (!isText(flag?.reason)) fail(`estimatedFields.${name} needs a reason`);
    if (flag?.seenM === undefined) continue;
    if (name !== "paintBack" && name !== "paintFront") fail(`estimatedFields.${name}: seenM is only for an end line`);
    else if (!(isPair(flag.seenM) && flag.seenM[0] < flag.seenM[1])) fail(`estimatedFields.${name}.seenM must be [from, to] in metres along the row`);
  }
}
// The same for a stall: its width and hatch where the paint does not bound them, which way its symbol reads, where a second
// figure stands and which way that reads.
const STALL_ESTIMATED_FIELDS = { widthM: (s) => s.widthM !== undefined, aisleWidthM: (s) => Boolean(s.aisle), symbolUp: (s) => Boolean(s.symbol), figureSide: (s) => Boolean(s.figure), figureUp: (s) => Boolean(s.figure) };
function stallEstimatedErrors(stall, at) {
  const fields = stall.estimatedFields;
  if (fields === undefined) return;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return at("estimatedFields must be an object: { field: { reason } }");
  for (const [name, flag] of Object.entries(fields)) {
    const has = STALL_ESTIMATED_FIELDS[name];
    if (!has) { at(`estimatedFields.${name} is not a field that can be flagged (${Object.keys(STALL_ESTIMATED_FIELDS).join(", ")})`); continue; }
    if (!has(stall)) at(`estimatedFields.${name} flags a value the stall does not have`);
    if (!isText(flag?.reason)) at(`estimatedFields.${name} needs a reason`);
  }
}
function parkingRow(row, lotId, fail) {
  if (!isText(row?.id) || !row.id.startsWith(`${lotId}/`)) fail(`row id must start with ${lotId}/`);
  const lineError = backLineErrors(row?.backLine);
  if (lineError) fail(lineError);
  if (row.side !== 1 && row.side !== -1) fail("side must be +1 or -1");
  if (!positive(row.pitchM)) fail("pitchM must be a number > 0");
  else if (row.estimated === false && row.pitchM < MIN_STALL_M) fail(`pitchM ${row.pitchM} m is under ${MIN_STALL_M} m in a row not marked estimated`);
  if (!positive(row.depthM)) fail("depthM must be a number > 0");
  if (!Number.isFinite(row.startOffsetM ?? 0)) fail("startOffsetM must be a number");
  if (!(row.count === null || (Number.isInteger(row.count) && row.count >= 2))) fail("count must be an integer >= 2 or null");
  if (row.divider !== undefined && (!DIVIDER_STYLES.has(row.divider?.style) || (row.divider.style !== "none" && !positive(row.divider?.widthM)))) fail(`divider needs style (${[...DIVIDER_STYLES].join(", ")}) and widthM > 0`);
  if (row.dividerBearingDeg !== undefined && !Number.isFinite(row.dividerBearingDeg)) fail("dividerBearingDeg must be a number (degrees from north, back towards the aisle)");
  if (row.paintBack !== undefined && typeof row.paintBack !== "boolean") fail("paintBack must be a boolean");
  if (row.paintFront !== undefined && typeof row.paintFront !== "boolean") fail("paintFront must be a boolean");
  if (row.estimatedDividers !== undefined && !(Array.isArray(row.estimatedDividers) && row.estimatedDividers.every((i) => Number.isInteger(i) && i >= 0 && (!Number.isInteger(row.count) || i < row.count)))) fail("estimatedDividers must list divider indices of the row");
  estimatedFieldErrors(row, fail);
  if (!Array.isArray(row.stalls)) fail("stalls must be an array (exception stalls only)");
  else {
    const seen = new Set();
    row.stalls.forEach((s, i) => {
      const at = (m) => fail(`stalls[${i}] ${m}`);
      const bays = baysOf(row);
      if (!(Number.isInteger(s?.index) && s.index >= 0 && s.index < bays)) at(`${s?.kind === "accessible" ? `accessible bay ${s.id ?? "(no id)"} is outside the row: ` : ""}index must be an integer in [0, ${bays})`);
      else if (seen.has(s.index)) at("index repeats");
      else seen.add(s.index);
      if (!STALL_KINDS.has(s?.kind)) at(`kind must be one of ${[...STALL_KINDS].join(", ")}`);
      if (s?.widthM !== undefined && !positive(s.widthM)) at("widthM must be > 0");
      if (s?.aisle && (!AISLE_SIDES.includes(s.aisle.side) || !positive(s.aisle.widthM))) at(`aisle needs side ${AISLE_SIDES.join("|")} and widthM > 0`);
      if (s?.figure && (!["scooter", "P"].includes(s.figure.symbol) || !AISLE_SIDES.includes(s.figure.side))) at(`figure needs symbol scooter or P and side ${AISLE_SIDES.join("|")}`);
      if (s?.figure?.upBearingDeg !== undefined && !Number.isFinite(s.figure.upBearingDeg)) at("figure.upBearingDeg must be a number");
      if (s?.symbol !== undefined && ![null, "wheelchair", "P"].includes(s.symbol)) at("symbol must be wheelchair, P or null");
      if (s?.upBearingDeg !== undefined && !Number.isFinite(s.upBearingDeg)) at("upBearingDeg must be a number");
      if (!(s?.paintSupport === undefined || s.paintSupport === null || (Number.isFinite(s.paintSupport) && s.paintSupport >= 0 && s.paintSupport <= 1))) at("paintSupport must be in [0, 1] or null");
      if (s?.estimated !== undefined && typeof s.estimated !== "boolean") at("estimated must be a boolean");
      if (s) stallEstimatedErrors(s, at);
      if (row.estimated === false && Number.isFinite(s?.widthM) && s.widthM < MIN_STALL_M) at(`width ${s.widthM} m is under ${MIN_STALL_M} m in a row not marked estimated`);
    });
  }
  if (!(row.wheelStops === null || row.wheelStops === undefined || (Number.isFinite(row.wheelStops.offsetFromBackM) && positive(row.wheelStops.lengthM)))) fail("wheelStops needs offsetFromBackM and lengthM > 0");
  if (!TIERS.has(row.evidence?.tier)) fail("evidence.tier must be T0-T4");
  if (!Array.isArray(row.evidence?.refs) || !row.evidence.refs.every(isText)) fail("evidence.refs must be an array of strings");
  const ps = row.evidence?.photoSupport;
  if (!(ps === null || ps === undefined || (Number.isFinite(ps) && ps >= 0 && ps <= 1))) fail("evidence.photoSupport must be in [0, 1] or null");
  if (typeof row.estimated !== "boolean") fail("estimated must be a boolean");
  else if (row.evidence?.tier === "T4" && !row.estimated) fail("estimated must be true for a T4 row");
}
// A recorded line of paint that belongs to no row (an aisle line, a lone divider): two end points or a traced ring.
function parkingLine(line, fail) {
  const straight = Array.isArray(line.abs) && line.abs.length === 2 && line.abs.every(isPair) && positive(line.widthM);
  if (!straight && !isRing(line.ring)) fail("needs abs (two [E, N] pairs) with widthM, or a ring");
  if (!["white", "yellow"].includes(line.colour)) fail("colour must be white or yellow");
  if (!TIERS.has(line.evidence?.tier)) fail("evidence.tier must be T0-T4");
  if (!Array.isArray(line.evidence?.refs) || !line.evidence.refs.every(isText)) fail("evidence.refs must be an array of strings");
}
function parking(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.lots)) return ["parking: lots must be an array"];
  const errors = [];
  const lots = new Set();
  const rows = new Set();
  doc.lots.forEach((lot, index) => {
    const id = isText(lot?.id) ? lot.id : `lots[${index}]`;
    const fail = (message) => errors.push(`${id}: ${message}`);
    if (!/^LOT_[A-Z0-9_]+$/.test(lot?.id ?? "")) fail("id must match LOT_[A-Z0-9_]+");
    else if (lots.has(id)) fail("id repeats");
    else lots.add(id);
    if (!(lot?.parcel === null || lot?.parcel === undefined || /^PARCEL_[A-Z0-9_]+$/.test(lot.parcel))) fail("parcel must be a PARCEL_* id or null");
    if (lot?.curated !== undefined && !isText(lot.curated)) fail("curated must name the todo that reviewed the lot");
    // design §6.1: an accessible bay is a member of a row, so its direction and place come from the row
    for (const [i, bay] of (lot?.bays ?? []).entries()) fail(`accessible bay ${bay?.id ?? `bays[${i}]`} is outside any row: make it a stall of a row`);
    if (lot?.lines !== undefined && !Array.isArray(lot.lines)) fail("lines must be an array");
    for (const [l, line] of (Array.isArray(lot?.lines) ? lot.lines : []).entries()) {
      const lid = isText(line?.id) ? line.id : `${id}/lines[${l}]`;
      const lineFail = (message) => errors.push(`${lid}: ${message}`);
      if (!isText(line?.id) || !line.id.startsWith(`${id}/`)) lineFail(`line id must start with ${id}/`);
      if (rows.has(lid)) lineFail("line id repeats");
      rows.add(lid);
      parkingLine(line ?? {}, lineFail);
    }
    if (!Array.isArray(lot?.rows)) return fail("rows must be an array");
    lot.rows.forEach((row, r) => {
      const rid = isText(row?.id) ? row.id : `${id}/rows[${r}]`;
      const rowFail = (message) => errors.push(`${rid}: ${message}`);
      if (rows.has(rid)) rowFail("row id repeats");
      rows.add(rid);
      parkingRow(row ?? {}, id, rowFail);
    });
  });
  return errors;
}

// ---- data/ground/parking-curation.json (plan todo 13): the lots a person reviewed, as whole records the seed takes in place of
// its own. A lot is found by its anchor, never by the seed's name; its row ids are the file's, and a retired id stays retired.
// A curated T1 row states what it measured: a value read by eye, or not bounded by what the photo shows, carries its own flag,
// so an estimate cannot sit under T1 in free text alone. A row marked estimated says so as a whole.
const CALLED_ESTIMATE = /추정|by eye|\bestimated?\b|seen only|seen from/i;
const FILLED_KINDS = new Set(["accessible", "pm"]);
function curatedReadingErrors(row) {
  if (row?.evidence?.tier !== "T1" || row.estimated !== false) return [];
  const fields = row.estimatedFields && typeof row.estimatedFields === "object" ? row.estimatedFields : {};
  const errors = [];
  const bounded = (row.paintBack && row.paintFront) || (Array.isArray(row.stalls) && row.stalls.some((s) => FILLED_KINDS.has(s?.kind)));
  if (!bounded && !fields.depthM) errors.push(`${row.id}: depthM is not bounded by two painted lines: flag it in estimatedFields`);
  if (row.wheelStops && !fields.wheelStops) errors.push(`${row.id}: wheelStops are read on the VR: flag them in estimatedFields`);
  const stalls = Array.isArray(row.stalls) ? row.stalls : [];
  const flagsOf = (s) => (s?.estimatedFields && typeof s.estimatedFields === "object" ? s.estimatedFields : {});
  for (const s of stalls) {
    const own = flagsOf(s);
    if (s?.symbol && !own.symbolUp) errors.push(`${s.id ?? row.id}: symbol direction is read by eye: flag symbolUp in estimatedFields`);
    if (s?.figure && !(own.figureSide && own.figureUp)) errors.push(`${s.id ?? row.id}: figure is read by eye: flag figureSide and figureUp in estimatedFields`);
  }
  const anyFlag = Object.keys(fields).length || stalls.some((s) => Object.keys(flagsOf(s)).length);
  if (!anyFlag && Array.isArray(row.evidence.refs) && row.evidence.refs.some((ref) => CALLED_ESTIMATE.test(ref))) errors.push(`${row.id}: refs call a value estimated or partly seen: flag it in estimatedFields`);
  return errors;
}
function parkingCuration(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.lots)) return ["parkingCuration: lots must be an array"];
  const errors = [];
  for (const lot of doc.lots) {
    const id = isText(lot?.id) ? lot.id : "lots[?]";
    const fail = (message) => errors.push(`${id}: ${message}`);
    if (!isPair(lot?.anchor)) fail("anchor must be an [E, N] pair");
    if (!isText(lot?.curated)) fail("curated must name the todo that reviewed the lot");
    if (!(Array.isArray(lot?.retired) && lot.retired.every(isText))) fail("retired must be an array of ids");
    if (!Array.isArray(lot?.lines)) fail("lines must be an array");
    const records = [...(Array.isArray(lot?.rows) ? lot.rows : []), ...(Array.isArray(lot?.lines) ? lot.lines : [])];
    for (const record of records) if (Array.isArray(lot?.retired) && lot.retired.includes(record?.id)) errors.push(`${record.id} is retired and cannot be used again`);
    for (const row of Array.isArray(lot?.rows) ? lot.rows : []) errors.push(...curatedReadingErrors(row));
  }
  errors.push(...parking({ lots: doc.lots.map((lot) => ({ id: lot?.id, rows: lot?.rows, lines: Array.isArray(lot?.lines) ? lot.lines : [] })) }));
  return errors;
}

// data/ground/parcel-curation.json: reviewed changes on top of the seeded parcels (fit/parcelsSeed.mjs). Every record says why.
function parcelCuration(doc) {
  if (!doc || typeof doc !== "object") return ["parcelCuration: must be an object"];
  const errors = [];
  for (const key of ["replace", "remove", "add", "notAsphalt", "unreachable"]) if (!Array.isArray(doc[key])) errors.push(`parcelCuration: ${key} must be an array`);
  if (errors.length) return errors;
  const reasoned = (record, id) => { if (!isText(record?.reason)) errors.push(`${id}: reason must be a non-empty string`); };
  const graded = (record, id) => {
    if (!isRing(record?.ring)) errors.push(`${id}: ring must be at least 3 [E, N] pairs`);
    if (!TIERS.has(record?.evidence?.tier) || !Array.isArray(record?.evidence?.refs) || !record.evidence.refs.every(isText)) errors.push(`${id}: evidence must have tier T0-T4 and refs`);
    if (typeof record?.estimated !== "boolean") errors.push(`${id}: estimated must be a boolean`);
    else if (record.evidence?.tier === "T4" && !record.estimated) errors.push(`${id}: estimated must be true for a T4 parcel`);
    reasoned(record, id);
  };
  const named = (record, index, key) => {
    const id = isText(record?.id) ? record.id : `${key}[${index}]`;
    if (!/^PARCEL_[A-Z0-9_]+$/.test(record?.id ?? "")) errors.push(`${id}: id must match PARCEL_[A-Z0-9_]+`);
    return id;
  };
  doc.replace.forEach((r, i) => graded(r, named(r, i, "replace")));
  doc.remove.forEach((r, i) => reasoned(r, named(r, i, "remove")));
  doc.add.forEach((r, i) => {
    const id = named(r, i, "add");
    graded(r, id);
    if (r?.class !== "road" && r?.class !== "lot") errors.push(`${id}: class must be road or lot`);
  });
  doc.notAsphalt.forEach((r, i) => {
    const id = isText(r?.id) ? r.id : `notAsphalt[${i}]`;
    if (!isRing(r?.ring)) errors.push(`${id}: ring must be at least 3 [E, N] pairs`);
    reasoned(r, id);
  });
  doc.unreachable.forEach((r, i) => reasoned(r, isText(r?.row) ? r.row : `unreachable[${i}]`));
  return errors;
}

const KINDS = { bldNodeMap, registration, parcels, parking, parkingCuration, parcelCuration };

export function validate(kind, doc) {
  const check = KINDS[kind];
  const errors = check ? check(doc) : [`${kind}: unknown kind (known: ${Object.keys(KINDS).join(", ")})`];
  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const [kind, file] = process.argv.slice(2);
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`${kind}: cannot read ${file}: ${error.message}`);
    process.exit(1);
  }
  const { ok, errors } = validate(kind, doc);
  for (const error of errors) console.error(error);
  if (!ok) process.exit(1);
  console.log(`${kind}: ok (${file})`);
}

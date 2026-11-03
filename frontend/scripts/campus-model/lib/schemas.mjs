// Shared validators for the curated campus-model data files. validate(kind, doc) -> { ok, errors[] }; every error
// string starts with the id of the record it is about (a node id, or the kind name for file-level errors), so a
// failing build points straight at the entry to fix. Run as a CLI: `bun lib/schemas.mjs <kind> <file>` exits 1 and
// prints the errors to stderr when the file is invalid.
import { readFileSync } from "node:fs";

import { DESIGN_CLASSES, PAINT_CLASSES } from "./parcels.mjs";
import { AnchorError, anchorRecordErrors, checkWallMapping, resolveAnchor } from "./anchors.mjs";

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

// Wall/parcel references can be checked against current TM geometry at the build boundary.
// context.nodeMap is data/bld-node-map.json with each referenced entry's saved `wallsOf()` result in `walls`.
function anchors(doc, context = {}) {
  if (!doc || !Array.isArray(doc.anchors)) return ["anchors: anchors must be an array"];
  const errors = [];
  const ids = new Set();
  doc.anchors.forEach((record, index) => {
    const id = isText(record?.id) ? record.id : `anchors[${index}]`;
    const structural = anchorRecordErrors(record);
    errors.push(...structural.map((e) => isText(record?.id) ? e : e.replace(/^anchor:/, `${id}:`)));
    if (ids.has(id)) errors.push(`${id}: id repeats`);
    ids.add(id);
    if (structural.length || (!context.footprints && !context.parcels)) return;
    try {
      resolveAnchor(record, context.footprints ?? {}, context.parcels ?? {});
      if (context.nodeMap && record.anchor.building) {
        const building = record.anchor.building;
        const entries = context.nodeMap.entries;
        const entry = Array.isArray(entries) ? entries.find((e) => e?.nodeId === building) : null;
        errors.push(...checkWallMapping(building, context.footprints[building], entry?.walls)
          .map((e) => `${id}: ${building}/${record.anchor.wall}: ${e}`));
      }
    } catch (error) {
      if (!(error instanceof AnchorError)) throw error;
      errors.push(error.message);
    }
  });
  return errors;
}

const KINDS = { bldNodeMap, registration, parcels, anchors };

export function validate(kind, doc, context) {
  const check = KINDS[kind];
  const errors = check ? check(doc, context) : [`${kind}: unknown kind (known: ${Object.keys(KINDS).join(", ")})`];
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

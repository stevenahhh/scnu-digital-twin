// Wall-local anchors, design §7.1-7.2. All points and offsets are EPSG:5186 metres, never scene units.
// footprints: { BLD_*: { polygons: [[outer, ...holes], ...], estimated?, walls? } }.
// Convert GIS lon/lat to TM before calling. `walls` is the saved wallsOf() result from the node-map entry;
// resolveAnchor refuses a changed mapping rather than quietly reattaching an object after a refetch.
// Polygon zero uses W00 / H0/W00; additional polygons use P1/W00 / P1/H0/W00.
// parcels: { PARCEL_*: { ring: [[E,N], ...], estimated? } }. u/v start at the oriented box centre;
// u follows its long axis toward positive E (positive N when vertical), v is the left normal.

const pair = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const text = (s) => typeof s === "string" && s.length > 0;
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const bearing = (a) => (Math.atan2(a[0], a[1]) * 180 / Math.PI + 360) % 360;
const wallName = /^(?:P[1-9]\d*\/)?(?:H\d+\/)?W\d{2,}$/;

export class AnchorError extends Error {
  constructor(id, reference, detail) {
    super(`${id}: ${reference}: ${detail}`);
    this.name = "AnchorError";
    this.recordId = id;
    this.reference = reference;
  }
}

// Shared by the schema and the resolver, so malformed direct calls cannot return NaN or select another mode.
export function anchorRecordErrors(record) {
  const id = text(record?.id) ? record.id : "anchor";
  const errors = [];
  const fail = (message) => errors.push(`${id}: ${message}`);
  if (!text(record?.id)) fail("id must be a non-empty string");
  const a = record?.anchor;
  if (!a || typeof a !== "object" || Array.isArray(a)) {
    fail("anchor must be an object");
    return errors;
  }
  if (a.parcel !== undefined) {
    if (!text(a.parcel)) fail("anchor.parcel must be a non-empty string");
    if (a.building !== undefined || a.wall !== undefined || a.sM !== undefined || a.s0M !== undefined ||
      a.s1M !== undefined || a.tM !== undefined) fail("parcel and wall anchors cannot be mixed");
    for (const key of ["uM", "vM"]) if (!Number.isFinite(a[key])) fail(`anchor.${key} must be finite metres`);
  } else {
    if (!/^BLD_.+/.test(a.building ?? "")) fail("anchor.building must be a BLD_* id");
    if (!text(a.wall) || !wallName.test(a.wall)) fail("anchor.wall must be W00, H0/W00 or P1/W00");
    if (a.uM !== undefined || a.vM !== undefined) fail("parcel and wall anchors cannot be mixed");
    if (a.s0M !== undefined || a.s1M !== undefined) {
      if (a.sM !== undefined) fail("use sM or s0M/s1M, not both");
      if (!Number.isFinite(a.s0M) || !Number.isFinite(a.s1M) || !(a.s1M > a.s0M)) fail("anchor.s0M/s1M must be finite increasing metres");
    } else if (!Number.isFinite(a.sM)) fail("anchor.sM must be finite metres");
    if (a.tM !== undefined && !Number.isFinite(a.tM)) fail("anchor.tM must be finite metres");
  }
  for (const key of ["hM", "yawDeg"]) if (a[key] !== undefined && !Number.isFinite(a[key])) fail(`anchor.${key} must be finite`);
  if (record.estimated !== undefined && typeof record.estimated !== "boolean") fail("estimated must be a boolean");
  if (record.evidence?.tier === "T4" && record.estimated !== true) fail("T4 values require estimated:true");
  return errors;
}

// Do not simplify away vertices: the GIS ring's first vertex and every edge are part of the wall-id contract.
function clockwise(ring, id) {
  if (!Array.isArray(ring) || !ring.every(pair)) throw new AnchorError(id, id, "ring must contain finite [E, N] pairs");
  const points = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring.slice();
  if (points.length < 3) throw new AnchorError(id, id, "ring needs at least three vertices");
  const local = points.map((p) => sub(p, points[0]));
  const area2 = local.reduce((sum, p, i) => {
    const q = local[(i + 1) % local.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  if (Math.abs(area2) < 1e-12) throw new AnchorError(id, id, "ring has zero area");
  return area2 < 0 ? points : [points[0], ...points.slice(1).reverse()];
}

export function wallsOf(building, footprint) {
  if (!Array.isArray(footprint?.polygons) || footprint.polygons.length === 0) throw new AnchorError(building, building, "footprint needs TM polygons");
  const walls = [];
  footprint.polygons.forEach((polygon, part) => {
    const prefix = part === 0 ? "" : `P${part}/`;
    if (!Array.isArray(polygon) || polygon.length === 0) throw new AnchorError(building, building, "polygon needs an outer ring");
    polygon.forEach((raw, ringIndex) => {
      const ringPrefix = `${prefix}${ringIndex === 0 ? "" : `H${ringIndex - 1}/`}`;
      const ring = clockwise(raw, `${building}/${ringPrefix}W00`);
      ring.forEach((A, i) => {
        const B = ring[(i + 1) % ring.length];
        const delta = sub(B, A);
        const lengthM = Math.hypot(...delta);
        const wall = `${ringPrefix}W${String(i).padStart(2, "0")}`;
        const id = `${building}/${wall}`;
        if (lengthM < 1e-9) throw new AnchorError(building, id, "zero-length wall");
        const a = delta.map((v) => v / lengthM);
        // Outer clockwise -> left normal faces outdoors. Hole clockwise -> right normal faces the courtyard.
        const sign = ringIndex === 0 ? 1 : -1;
        const n = [-a[1] * sign, a[0] * sign];
        walls.push({ id, wall, A: [...A], B: [...B], a, n, lengthM, bearingDeg: bearing(a) });
      });
    });
  });
  return walls;
}

// Saved node-map wall frames must remain within §7.1's 0.5 m / 2 degree bounds.
// Check A too: length/bearing alone would silently accept a translated or cyclically reordered square.
export function checkWallMapping(building, footprint, expected) {
  const current = wallsOf(building, footprint);
  if (!Array.isArray(expected) || expected.length === 0) return [`${building}: stale wall mapping missing`];
  const errors = [];
  const saved = new Map();
  for (const wall of expected) {
    if (!text(wall?.wall) || !pair(wall.A) || !Number.isFinite(wall.lengthM) || !Number.isFinite(wall.bearingDeg)) {
      errors.push(`${building}/${wall?.wall ?? "?"}: stale wall mapping malformed`);
      continue;
    }
    if (saved.has(wall.wall)) errors.push(`${building}/${wall.wall}: stale wall mapping duplicate`);
    saved.set(wall.wall, wall);
  }
  for (const wall of current) {
    const before = saved.get(wall.wall);
    if (!before) {
      errors.push(`${wall.id}: stale wall missing from saved mapping`);
      continue;
    }
    const angle = Math.abs(((wall.bearingDeg - before.bearingDeg + 540) % 360) - 180);
    if (Math.abs(wall.lengthM - before.lengthM) > 0.5 + 1e-9 || angle > 2 + 1e-9 || Math.hypot(...sub(wall.A, before.A)) > 0.5 + 1e-9) {
      errors.push(`${wall.id}: stale wall length, bearing or start exceeds 0.5 m / 2 deg`);
    }
    saved.delete(wall.wall);
  }
  for (const wall of saved.keys()) errors.push(`${building}/${wall}: stale wall no longer exists`);
  return errors;
}

export function wallCoordinates(point, wall) {
  if (!pair(point)) throw new AnchorError(wall.id, wall.id, "point must be finite [E, N]");
  const d = sub(point, wall.A);
  return { sM: dot(d, wall.a), tM: dot(d, wall.n) };
}

// Existing oriented-box helpers quantise angles (0.25/0.5 degrees). Anchors need an exact frame.
// Test each convex-hull edge; work around a local origin to retain sub-millimetre precision at TM magnitudes.
function parcelFrame(parcel, id) {
  const ring = clockwise(parcel.ring, id);
  const points = ring.map((p) => sub(p, ring[0])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list) => {
    const hull = [];
    for (const p of list) {
      while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  const hull = [...half(points), ...half([...points].reverse())];
  let best = null;
  hull.forEach((p, i) => {
    const d = sub(hull[(i + 1) % hull.length], p);
    const length = Math.hypot(...d);
    const u = d.map((v) => v / length);
    const v = [-u[1], u[0]];
    const ss = points.map((q) => dot(q, u));
    const ts = points.map((q) => dot(q, v));
    const s0 = Math.min(...ss), s1 = Math.max(...ss), t0 = Math.min(...ts), t1 = Math.max(...ts);
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area - 1e-9) best = { area, u, v, s0, s1, t0, t1 };
  });
  const { u, v, s0, s1, t0, t1 } = best;
  const A = ring[0].map((x, i) => x + u[i] * (s0 + s1) / 2 + v[i] * (t0 + t1) / 2);
  let a = s1 - s0 >= t1 - t0 ? u : v;
  if (a[0] < -1e-12 || (Math.abs(a[0]) <= 1e-12 && a[1] < 0)) a = a.map((x) => -x);
  return { A, a, n: [-a[1], a[0]] };
}

export function resolveAnchor(record, footprints, parcels = {}) {
  const errors = anchorRecordErrors(record);
  const anchor = record?.anchor;
  const reference = anchor?.parcel ?? `${anchor?.building}/${anchor?.wall}`;
  if (errors.length) throw new AnchorError(record?.id ?? "anchor", reference, errors.join("; "));
  let frame;
  let source;
  try {
    if (anchor.parcel !== undefined) {
      source = parcels[anchor.parcel];
      if (!source) throw new AnchorError(record.id, reference, "missing parcel");
      frame = parcelFrame(source, reference);
    } else {
      source = footprints[anchor.building];
      if (!source) throw new AnchorError(record.id, reference, "missing building footprint");
      if (source.walls !== undefined) {
        const stale = checkWallMapping(anchor.building, source, source.walls);
        if (stale.length) throw new AnchorError(record.id, reference, stale.join("; "));
      }
      frame = wallsOf(anchor.building, source).find((w) => w.wall === anchor.wall);
      if (!frame) throw new AnchorError(record.id, reference, "missing wall");
      const offsets = anchor.sM === undefined ? [anchor.s0M, anchor.s1M] : [anchor.sM];
      if (offsets.some(s => s < 0 || s > frame.lengthM)) {
        throw new AnchorError(record.id, reference, `offset outside [0, ${frame.lengthM}] wall interval`);
      }
    }
  } catch (error) {
    if (!(error instanceof AnchorError)) throw error;
    throw new AnchorError(record.id, reference, error.message);
  }
  const s = anchor.parcel !== undefined ? anchor.uM : anchor.sM ?? anchor.s0M;
  const t = anchor.parcel !== undefined ? anchor.vM : anchor.tM ?? 0;
  const at = (offset) => frame.A.map((x, i) => x + frame.a[i] * offset + frame.n[i] * t);
  const yawDeg = anchor.yawDeg ?? 0;
  const angle = yawDeg * Math.PI / 180;
  const rotate = ([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
  return {
    origin: at(s), a: rotate(frame.a), n: rotate(frame.n), hM: anchor.hM ?? 0, yawDeg,
    estimated: record.estimated === true || source.estimated === true,
    ...(anchor.s1M === undefined ? {} : { end: at(anchor.s1M), lengthM: anchor.s1M - anchor.s0M }),
  };
}

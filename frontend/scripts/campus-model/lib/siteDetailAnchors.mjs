// Geometry is stored in metres in an anchor frame. Furniture and planter hedges consume the same result.
import { AnchorError, anchorRecordErrors, resolveAnchor, wallsOf, wallCoordinates } from "./anchors.mjs";
import { pointInRing, ringArea } from "./geometry.mjs";

export const SITE_DETAIL_KINDS = new Set(["hedge", "signboard", "planter", "handrail", "led_screen"]);
// The remaining photo_support:none observations explicitly place these against a wall, not free-standing.
const WALL_ADJACENT_IDS = new Set(["SD-E4-K1", "SD-E8-PM1", "SD-C2-B1", "SD-C5-P1", "SD-A9-B2", "SD-A1RG-S5"]);
export const isWallSiteDetail = feature => SITE_DETAIL_KINDS.has(feature.kind) || WALL_ADJACENT_IDS.has(feature.id);

export function mapSiteGeometry(record, transform) {
  const g = record.geometry;
  const bad = () => { throw new AnchorError(record.id, "geometry", "invalid local geometry"); };
  const point = (p) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) return bad();
    return transform(p);
  };
  const line = (points, min) => {
    if (!Array.isArray(points) || points.length < min) return bad();
    return points.map(point);
  };
  switch (g?.type) {
    case "Point": return { type: g.type, coordinates: point(g.coordinates) };
    case "LineString": return { type: g.type, coordinates: line(g.coordinates, 2) };
    case "Polygon": {
      if (!Array.isArray(g.coordinates) || !g.coordinates.length) return bad();
      return { type: g.type, coordinates: g.coordinates.map(ring => {
        const mapped = line(ring, 4);
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return bad();
        return mapped;
      }) };
    }
    default: return bad();
  }
}

function siteFrame(record, context, snapshots) {
  const errors = anchorRecordErrors(record);
  if (errors.length) throw new AnchorError(record.id, "anchor", errors.join("; "));
  const { anchor } = record;
  let footprints = context.footprints;
  if (anchor.building && snapshots !== undefined) {
    if (!snapshots[anchor.building]) throw new AnchorError(record.id, anchor.building, "saved wall mapping required");
    footprints = { ...footprints, [anchor.building]: { ...footprints[anchor.building], walls: snapshots[anchor.building] } };
  }
  const resolved = resolveAnchor(record, footprints, context.parcels);
  const wall = anchor.building
    ? wallsOf(anchor.building, footprints[anchor.building]).find(w => w.wall === anchor.wall) : null;
  if (wall) {
    const offsets = anchor.sM === undefined ? [anchor.s0M, anchor.s1M] : [anchor.sM];
    if (offsets.some(s => s < 0 || s > wall.lengthM)) {
      throw new AnchorError(record.id, wall.id, "s outside wall [0, length]");
    }
  }
  return { ...resolved, wall };
}

export function resolveSiteDetail(record, context, snapshots) {
  const frame = siteFrame(record, context, snapshots);
  return mapSiteGeometry(record, ([u, v]) => {
    const point = frame.origin.map((value, i) => value + frame.a[i] * u + frame.n[i] * v);
    if (frame.wall) {
      const { sM } = wallCoordinates(point, frame.wall);
      if (sM < -1e-8 || sM > frame.wall.lengthM + 1e-8) {
        throw new AnchorError(record.id, frame.wall.id, "geometry outside wall [0, length]");
      }
    }
    return point;
  });
}

export function anchorSiteDetail(feature, anchor, context, snapshots) {
  const record = { id: feature.id, anchor, estimated: true, evidence: { tier: "T4", refs: [feature.id] } };
  const frame = siteFrame(record, context, snapshots);
  const geometry = mapSiteGeometry(feature, point => {
    const delta = point.map((value, i) => value - frame.origin[i]);
    return [delta[0] * frame.a[0] + delta[1] * frame.a[1], delta[0] * frame.n[0] + delta[1] * frame.n[1]];
  });
  return { ...record, geometry };
}

function distanceToRing(point, ring) {
  return Math.min(...ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const d2 = dx * dx + dy * dy;
    const t = d2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / d2)) : 0;
    return Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dy * t);
  }));
}

// A failed reading is evidence, not a reason to abort the remaining survey.
// With no trustworthy finite wall hit, retain the old estimate relative to a containing parcel.
export function seedSiteDetails(features, context, wallRecords = {}, snapshots) {
  const records = [], unresolved = [];
  for (const feature of features) {
    if (!isWallSiteDetail(feature)) continue;
    const points = [];
    mapSiteGeometry(feature, p => { points.push(p); return p; });
    if (feature.geometry.type === "Polygon") points.pop();
    const centreTM = [0, 1].map(axis => points.reduce((sum, p) => sum + p[axis], 0) / points.length);
    const wallRecord = wallRecords[feature.id];
    if (wallRecord) {
      // Explicit curated records must fail loudly if wrong, never silently demote them.
      resolveSiteDetail(wallRecord, context, snapshots);
      records.push(wallRecord);
      continue;
    }
    const candidates = Object.entries(context.parcels).filter(([, p]) =>
      pointInRing(centreTM, p.ring) && !(p.holes ?? []).some(h => pointInRing(centreTM, h)));
    candidates.sort((a, b) => Math.abs(ringArea(a[1].ring)) - Math.abs(ringArea(b[1].ring)) || a[0].localeCompare(b[0]));
    if (!candidates.length) {
      const nearest = Object.entries(context.parcels).map(([id, p]) => ({
        id, distanceM: distanceToRing(centreTM, p.ring),
      })).sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id))[0];
      unresolved.push({ id: feature.id, kind: feature.kind, centreTM,
        nearestParcel: nearest?.id ?? null, nearestParcelDistanceM: nearest?.distanceM ?? null,
        estimated: true, reason: "No containing parcel and no verified finite wall reading; original estimate retained.",
        observation: feature.note ?? "" });
      continue;
    }
    const [parcel] = candidates[0];
    const origin = resolveAnchor({ id: feature.id, anchor: { parcel, uM: 0, vM: 0 } }, {}, context.parcels);
    const delta = centreTM.map((value, i) => value - origin.origin[i]);
    const anchor = { parcel, uM: delta[0] * origin.a[0] + delta[1] * origin.a[1],
      vM: delta[0] * origin.n[0] + delta[1] * origin.n[1] };
    const record = anchorSiteDetail(feature, anchor, context, snapshots);
    record.evidence.refs = [feature.note || feature.id];
    record.reason = feature.reason ?? "No verified wall reading or two-station intersection; prior position retained as a T4 parcel estimate, not a measured wall attachment.";
    record.centreTM = centreTM;
    resolveSiteDetail(record, context, snapshots);
    records.push(record);
  }
  return { records, unresolved };
}

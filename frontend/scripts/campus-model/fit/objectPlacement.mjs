// Free-point evidence precedence, design §17. Every visual pick remains an estimate.
import { resolveAnchor } from "../lib/anchors.mjs";
import { readBearing, triangulate } from "./vrWallHit.mjs";
import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";

export class ObjectPlacementError extends Error {
  constructor(id, detail) {
    super(`${id}: ${detail}`);
    this.name = "ObjectPlacementError";
    this.recordId = id;
  }
}

export function positionObject(seed, parcels) {
  const fail = (detail) => { throw new ObjectPlacementError(seed.id, detail); };
  if (!Array.isArray(seed.point) || seed.point.length !== 2 || !seed.point.every(Number.isFinite)) fail("point must be finite [E,N]");
  let point = seed.point;
  let tier = "T4";
  let reason = "no_verified_ground_base_or_two_station_fix";
  let crossingDeg = null;
  const refs = [`survey seed E=${point[0]} N=${point[1]}; position not independently verified`];
  const photo = seed.photo;
  const observations = seed.observations ?? [];
  if (!Array.isArray(observations) || observations.some(o =>
    !o?.station || typeof o.station.scene !== "string" || !o.reading)) fail("malformed station observation");
  let rays;
  try {
    rays = observations.map(o => readBearing(o.station, o.reading));
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    fail(error.message);
  }
  for (const o of observations) refs.push(`VR ${o.station.scene} ${o.reading.face} col ${o.reading.col}`);
  if (photo && (!Array.isArray(photo.point) || photo.point.length !== 2 || !photo.point.every(Number.isFinite) ||
      typeof photo.ref !== "string" || !photo.ref || !Number.isFinite(photo.residualM) || photo.residualM < 0)) fail("malformed photo base evidence");
  if (photo?.base === true && photo.occluded === false && photo.residualM <= 0.5) {
    point = photo.point;
    tier = "T1";
    reason = "visible_ground_base";
    refs.push(`${photo.ref}; base residual=${photo.residualM} m`);
  } else {
    if (observations.length === 1) reason = "one_station";
    if (observations.length === 2) {
      if (observations[0].station.scene === observations[1].station.scene) {
        reason = "same_station";
      } else if (rays.some(r => r.tier === "T4")) {
        reason = "unrefined_station";
      } else {
        const dot = rays[0].direction[0] * rays[1].direction[0] + rays[0].direction[1] * rays[1].direction[1];
        crossingDeg = Math.acos(Math.min(1, Math.abs(dot))) * 180 / Math.PI;
        const fix = triangulate(observations);
        if (crossingDeg < 20) reason = "crossing_below_20_deg";
        else if (fix.point) {
          point = fix.point;
          tier = "T2";
          reason = "two_station_intersection";
        } else reason = fix.reason;
        refs.push(`two-ray crossing=${crossingDeg} deg; ${reason}`);
      }
    }
    if (observations.length > 2) fail("select exactly two corresponding station observations");
  }
  const zero = { id: seed.id, anchor: { parcel: seed.parcel, uM: 0, vM: 0 } };
  const frame = resolveAnchor(zero, {}, parcels);
  const d = point.map((v, i) => v - frame.origin[i]);
  const bearingChecks = rays.map((ray, i) => {
    const ref = `VR ${observations[i].station.scene} ${observations[i].reading.face} col ${observations[i].reading.col}`;
    if (ray.tier === "T4") return { ref, residualDeg: null, reason: ray.reason, estimated: true };
    const predictedDeg = (Math.atan2(point[0] - ray.origin[0], point[1] - ray.origin[1]) * 180 / Math.PI + 360) % 360;
    const residualDeg = ((predictedDeg - ray.bearingDeg + 540) % 360) - 180;
    return { ref, observedDeg: ray.bearingDeg, predictedDeg, residualDeg,
      toleranceDeg: 1.5, pass: Math.abs(residualDeg) <= 1.5, estimated: true,
      photoResidualM: tier === "T1" ? photo.residualM : null, photoToleranceM: 0.5,
      decision: tier === "T1" ? "retain_photo_base" : reason,
      method: "anchor-centre projection, not rendered ID mask" };
  });
  for (const check of bearingChecks.filter(b => b.pass === false)) {
    refs.push(`bearing conflict (estimated): observed=${check.observedDeg} deg, predicted=${check.predictedDeg} deg, residual=${check.residualDeg} deg > 1.5 deg; photo residual=${check.photoResidualM ?? "unverified"} m, tolerance=0.5 m; ${check.decision}`);
  }
  return {
    id: seed.id,
    anchor: { parcel: seed.parcel, uM: d[0] * frame.a[0] + d[1] * frame.a[1],
      vM: d[0] * frame.n[0] + d[1] * frame.n[1], yawDeg: 0 },
    evidence: { tier, refs }, estimated: true, reason, crossingDeg, bearingChecks,
  };
}

const geometryKeys = ["point", "line", "ring", "footprint", "axis", "photoRing"];
const geometryOf = (object) => Object.fromEntries(geometryKeys.filter(key => object[key]).map(key => [key, object[key]]));

// Called at the build boundary, after checkPoles has finalized the position.
export function finalObjectPlacement(object, parcels) {
  const shape = object.point ? [object.point] : object.footprint ?? object.ring ?? object.line;
  const pointScene = shape.reduce((s, p) => s.map((v, i) => v + p[i] / shape.length), [0, 0]);
  const point = sceneToTm(...pointScene);
  const frame = resolveAnchor({ id: object.id, anchor: { ...object.anchor, uM: 0, vM: 0 } }, {}, parcels);
  const d = point.map((v, i) => v - frame.origin[i]);
  return {
    id: object.id,
    anchor: { ...object.anchor, uM: d[0] * frame.a[0] + d[1] * frame.a[1],
      vM: d[0] * frame.n[0] + d[1] * frame.n[1] },
    pointScene, point, sourceInput: object.sourceInput,
    evidence: object.evidence, estimated: true, parcelRelation: object.parcelRelation,
    bearingChecks: object.bearingChecks, vrObservations: object.vrObservations,
  };
}

// Save shape offsets separately from the anchor, so editing a parcel actually moves its furniture.
export function anchorObject(object, placement, parcels) {
  const sourceGeometry = geometryOf(object);
  const points = object.point ? [object.point] : object.footprint ?? object.ring ?? object.line;
  const centre = points.reduce((sum, p) => sum.map((v, i) => v + p[i] / points.length), [0, 0]);
  const sourceOrigin = sceneToTm(...centre);
  const frame = resolveAnchor(placement, {}, parcels);
  const toLocal = (p) => {
    const tm = sceneToTm(...p);
    const delta = tm.map((v, i) => v - sourceOrigin[i]);
    return [delta[0] * frame.a[0] + delta[1] * frame.a[1], delta[0] * frame.n[0] + delta[1] * frame.n[1]];
  };
  const geometry = Object.fromEntries(Object.entries(sourceGeometry).map(([key, value]) =>
    [key, key === "point" ? toLocal(value) : value.map(toLocal)]));
  return { ...placement, kind: object.kind, sourceInput: object.sourceInput, sourceGeometry, geometry };
}

export function resolveObject(object, record, parcels) {
  // Production records compare exact source inputs + transform code, not runtime-dependent trig bits.
  const stale = object.sourceInput !== undefined || record.sourceInput !== undefined
    ? object.sourceInput !== record.sourceInput
    : JSON.stringify(geometryOf(object)) !== JSON.stringify(record.sourceGeometry);
  if (object.id !== record.id || object.kind !== record.kind || stale) {
    throw new ObjectPlacementError(object.id, "stale source geometry; review and reseed object anchors");
  }
  if (!["T1", "T2", "T4"].includes(record.evidence?.tier) || !Array.isArray(record.evidence?.refs) ||
      record.evidence.refs.length === 0 || record.evidence.refs.some(ref => typeof ref !== "string") || record.estimated !== true) {
    throw new ObjectPlacementError(object.id, "invalid estimated evidence");
  }
  if (!record.geometry || JSON.stringify(Object.keys(record.geometry).sort()) !== JSON.stringify(Object.keys(record.sourceGeometry).sort())) {
    throw new ObjectPlacementError(object.id, "local geometry must cover every source geometry field");
  }
  const frame = resolveAnchor(record, {}, parcels);
  const toScene = (p) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw new ObjectPlacementError(object.id, "non-finite local geometry");
    return tmToScene(...frame.origin.map((v, i) => v + frame.a[i] * p[0] + frame.n[i] * p[1]));
  };
  const geometry = Object.fromEntries(Object.entries(record.geometry).map(([key, value]) => {
    if (!geometryKeys.includes(key)) throw new ObjectPlacementError(object.id, `unknown geometry ${key}`);
    return [key, key === "point" ? toScene(value) : value.map(toScene)];
  }));
  return { ...object, ...geometry, anchor: record.anchor, evidence: record.evidence,
    bearingChecks: record.bearingChecks, vrObservations: record.vrObservations, parcelRelation: record.parcelRelation, estimated: true };
}

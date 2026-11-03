// VR columns measure bearings, not distances (design §7.3). All intersections below are EPSG:5186 metres.
// At a perpendicular wall 20 m away, a 1 degree error moves s by 20*tan(1deg) = 0.349101 m.
import { FRAME_VERSION, sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { columnToAngle, faceYaw } from "../../perf/lib/vrCamera.mjs";
import { anchorRecordErrors } from "../lib/anchors.mjs";

const radians = (deg) => deg * Math.PI / 180;
const cross = ([x, y], [u, v]) => x * v - y * u;
const unrefined = () => ({ tier: "T4", estimated: true, reason: "unrefined_station", residualDeg: null });

export function readBearing(station, reading) {
  if (!["f", "r", "b", "l"].includes(reading.face)) throw new RangeError(`${station.scene}: invalid face ${reading.face}`);
  if (!Number.isFinite(reading.col) || reading.col < 0 || reading.col > 2048) throw new RangeError(`${reading.id ?? station.scene}: col must be in [0,2048]`);
  if (station.frame_version !== FRAME_VERSION) throw new RangeError(`${station.scene}: stale station frame ${station.frame_version}, expected ${FRAME_VERSION}`);
  if (![station.station_refined_x, station.station_refined_z, station.yaw_refined_deg].every(Number.isFinite)) return unrefined();
  const bearingDeg = (faceYaw(station.yaw_refined_deg, reading.face) + columnToAngle(reading.col) + 360) % 360;
  return {
    tier: "T2", estimated: true, bearingDeg,
    origin: sceneToTm(station.station_refined_x, station.station_refined_z),
    direction: [Math.sin(radians(bearingDeg)), Math.cos(radians(bearingDeg))],
  };
}

export function wallHit(station, reading, wall) {
  if (!wall || ![wall.a, wall.b].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
    throw new RangeError(`${wall?.id ?? "wall"}: invalid wall endpoints`);
  }
  const edge = [wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]];
  const length = Math.hypot(...edge);
  if (length < 1e-9) throw new RangeError(`${wall.id}: zero-length wall`);
  const ray = readBearing(station, reading);
  if (ray.tier === "T4") return ray;
  const miss = (reason) => ({ tier: "T2", estimated: true, wall: wall.id, point: null, reason });
  const det = cross(ray.direction, edge);
  if (Math.abs(det) < 1e-10) return miss("parallel");
  const delta = [wall.a[0] - ray.origin[0], wall.a[1] - ray.origin[1]];
  const distanceM = cross(delta, edge) / det;
  const fraction = cross(delta, ray.direction) / det;
  if (distanceM < 0 || fraction < -1e-9 || fraction > 1 + 1e-9) return miss("outside_forward_segment");
  return {
    tier: "T2", estimated: true, wall: wall.id, bearingDeg: ray.bearingDeg,
    sM: Math.max(0, Math.min(1, fraction)) * length, distanceM,
    point: [ray.origin[0] + ray.direction[0] * distanceM, ray.origin[1] + ray.direction[1] * distanceM],
  };
}

export function triangulate(observations) {
  if (!Array.isArray(observations) || observations.length !== 2) throw new RangeError("triangulate needs two station observations");
  const rays = observations.map(o => readBearing(o.station, o.reading));
  if (rays.some(r => r.tier === "T4")) return unrefined();
  const [a, b] = rays;
  const det = cross(a.direction, b.direction);
  if (Math.abs(det) < 1e-10) return { tier: "T4", estimated: true, point: null, reason: "parallel" };
  const delta = [b.origin[0] - a.origin[0], b.origin[1] - a.origin[1]];
  const da = cross(delta, b.direction) / det, db = cross(delta, a.direction) / det;
  if (da < 0 || db < 0) return { tier: "T4", estimated: true, point: null, reason: "behind_station" };
  return { tier: "T2", estimated: true, point: [a.origin[0] + a.direction[0] * da, a.origin[1] + a.direction[1] * da] };
}

// renderCol is read from the object's actual ID-colour render, never from the anchor being checked.
export function bearingResidual(station, reading, renderCol) {
  const observed = readBearing(station, reading);
  if (observed.tier === "T4") return observed;
  if (renderCol === null) return { tier: "T2", estimated: true, residualDeg: null, pass: false, reason: "object_not_visible" };
  const rendered = readBearing(station, { face: reading.face, col: renderCol });
  const residualDeg = ((rendered.bearingDeg - observed.bearingDeg + 540) % 360) - 180;
  return { tier: "T2", estimated: true, observedDeg: observed.bearingDeg, renderedDeg: rendered.bearingDeg, residualDeg, toleranceDeg: 1.5, pass: Math.abs(residualDeg) <= 1.5 };
}

export function bearingObservations(document, stations) {
  if (document?.frameVersion !== FRAME_VERSION || !Array.isArray(document.records)) throw new RangeError("stale or malformed bearing records");
  const byScene = new Map(stations.map(s => [s.scene, s]));
  return document.records.flatMap(record => {
    if (typeof record?.id !== "string" || record.estimated !== true || !Array.isArray(record.evidence?.refs)) {
      throw new RangeError(`${record?.id ?? "bearing"}: id, estimated:true and evidence.refs required`);
    }
    if (record.anchor) {
      const errors = anchorRecordErrors(record);
      if (errors.length) throw new RangeError(errors.join("; "));
    }
    const observations = [];
    for (const ref of record.evidence.refs) {
      if (typeof ref !== "string") throw new RangeError(`${record.id}: evidence ref must be text`);
      if (!ref.startsWith("VR ")) continue;
      const match = /^VR ([a-z][a-z0-9_]*) ([frbl]) col ([0-9]+(?:\.[0-9]+)?)(?: -> .+)?$/.exec(ref);
      if (!match) throw new RangeError(`${record.id}: malformed VR column ref ${ref}`);
      const [, scene, face, column] = match;
      const station = byScene.get(scene);
      if (!station) throw new RangeError(`${record.id}: unknown scene ${scene}`);
      const observation = { id: record.id, scene, face, col: Number(column), estimated: true,
        building: record.anchor?.building, wall: record.anchor?.wall ? `${record.anchor.building}/${record.anchor.wall}` : null, ref };
      readBearing(station, observation);
      observations.push(observation);
    }
    if (!observations.length) throw new RangeError(`${record.id}: no VR column reference`);
    return observations;
  });
}

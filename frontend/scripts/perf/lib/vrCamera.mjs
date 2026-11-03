// Pure camera helpers for compare-vr.mjs (local QA only; nothing here ships).
//
// krpano cube faces of the SCNU 360 VR tour: f looks along the scene yaw, r = yaw + 90, b = yaw + 180,
// l = yaw - 90 (bearings in degrees clockwise from north). Inside a 2048 px face a horizontal angle a
// lands on column 1024 + 1024 tan(a). The scene frame is gen/lib/frame.mjs: +x east, +z south.

import { GROUND_MESH_NAME } from "../../../src/camera/terrainClearance.mjs";

const FACE_OFFSET = { f: 0, r: 90, b: 180, l: -90 };
const clean = (value, digits = 9) => {
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
};

/** Bearing (0-360) a cube face looks along, given the scene yaw. u and d have no bearing. */
export function faceYaw(yawDeg, face) {
  if (!(face in FACE_OFFSET)) throw new Error(`face ${face} has no horizontal bearing (use f, r, b or l)`);
  return clean((((yawDeg + FACE_OFFSET[face]) % 360) + 360) % 360);
}

/** Unit view direction for a compass bearing in the scene frame (+x east, +z south). */
export function bearingToDirection(deg) {
  const radians = (deg * Math.PI) / 180;
  return [clean(Math.sin(radians), 12), 0, clean(-Math.cos(radians), 12)];
}

/** Horizontal angle (degrees, right of the face centre positive) of a column in a 2048 px face. */
export function columnToAngle(col) {
  return clean((Math.atan((col - 1024) / 1024) * 180) / Math.PI);
}

/** Station position in the runtime world frame: scene units plus the runtime recentring offset. */
export function stationWorld(record, offset) {
  return {
    x: (record.station_refined_x ?? record.station_x) + offset.x,
    z: (record.station_refined_z ?? record.station_z) + offset.z,
  };
}

// Partitioning cuts roads and paving out of Topography. Use the runtime's complete ground contract.
export function groundTargets(scene) {
  const targets = [];
  scene.traverse(o => { if (o.isMesh && GROUND_MESH_NAME.test(o.name)) targets.push(o); });
  return targets;
}

export function terrainHeight(state, [x, z]) {
  const Vector3 = state.camera.position.constructor;
  const ray = new state.raycaster.constructor(new Vector3(x, 2000, z), new Vector3(0, -1, 0), 0, 5000);
  // CityModel renders partitioned ground on layer 1, while natural terrain remains on layer 0.
  ray.layers.enableAll();
  state.scene.updateMatrixWorld(true);
  const hits = ray.intersectObjects(groundTargets(state.scene), false);
  return hits.length ? hits[0].point.y : null;
}

export function modelWorldOffset(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 16 ||
      matrix.some((v, i) => !Number.isFinite(v) || (![12, 13, 14].includes(i) && Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-8))) {
    throw new RangeError("VR model transform must be a finite translation");
  }
  return { x: matrix[12], z: matrix[14] };
}

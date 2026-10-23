// Model frame shared by every generated layer.
//
// uni.glb (and the traffic simulation, see src/simulation/utils/campusTrafficCoordinates.mjs) live in
// "scene units": 0.6242 units per metre, +x east, +z south, with BLD_D4's bounding-box centre at
// D4_SCENE. The SketchUp source behind uni.glb is the VWorld cadastral footprint set shifted by a
// constant offset (median over 43 buildings whose areas match within 1 %: 4.40 m east, 0.44 m north),
// so geo data is placed with that same shift to land exactly on the existing model and roads.
export const SCENE_UNITS_PER_METRE = 0.6242171526;
export const D4_ANCHOR = Object.freeze({ longitude: 127.4764043, latitude: 34.9700548 });
export const D4_SCENE = Object.freeze({ x: 46.513, z: -266.574 });
export const SOURCE_MODEL_OFFSET = Object.freeze({ x: 2.744, z: -0.274 });

const LAT0_RAD = (D4_ANCHOR.latitude * Math.PI) / 180;
export const METRES_PER_DEGREE_LAT =
  111132.92 - 559.82 * Math.cos(2 * LAT0_RAD) + 1.175 * Math.cos(4 * LAT0_RAD);
export const METRES_PER_DEGREE_LON =
  111412.84 * Math.cos(LAT0_RAD) - 93.5 * Math.cos(3 * LAT0_RAD);

export function geoToModel(longitude, latitude) {
  const east = (longitude - D4_ANCHOR.longitude) * METRES_PER_DEGREE_LON;
  const north = (latitude - D4_ANCHOR.latitude) * METRES_PER_DEGREE_LAT;
  return [
    D4_SCENE.x + east * SCENE_UNITS_PER_METRE - SOURCE_MODEL_OFFSET.x,
    D4_SCENE.z - north * SCENE_UNITS_PER_METRE - SOURCE_MODEL_OFFSET.z,
  ];
}

export function modelToGeo(x, z) {
  const east = (x + SOURCE_MODEL_OFFSET.x - D4_SCENE.x) / SCENE_UNITS_PER_METRE;
  const north = -(z + SOURCE_MODEL_OFFSET.z - D4_SCENE.z) / SCENE_UNITS_PER_METRE;
  return [
    D4_ANCHOR.longitude + east / METRES_PER_DEGREE_LON,
    D4_ANCHOR.latitude + north / METRES_PER_DEGREE_LAT,
  ];
}

export const metres = (value) => value * SCENE_UNITS_PER_METRE;

// Terrain/landcover extent in scene units (covers uni.glb's Topography).
export const EXTENT = Object.freeze({ minX: -2, maxX: 502, minZ: -376, maxZ: 2 });

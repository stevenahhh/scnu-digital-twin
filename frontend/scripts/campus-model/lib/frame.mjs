// Model frame shared by every generated layer.
//
// uni.glb (and the traffic simulation, see src/simulation/utils/campusTrafficCoordinates.mjs) live in
// "scene units": 0.6242 units per metre, +x east, +z south, with BLD_D4's bounding-box centre at
// D4_SCENE. The SketchUp source behind uni.glb is the VWorld cadastral footprint set shifted by a
// constant offset (median over 43 buildings whose areas match within 1 %: 4.40 m east, 0.44 m north),
// so geo data is placed with that same shift to land exactly on the existing model and roads.
//
// The constants and the projection live in src/geo/epsg5186.mjs (the single reprojection module): geo -> model
// goes WGS84 -> EPSG:5186 -> scene, so every layer shares the frame of the NGII orthophoto sheet.
import {
  D4_ANCHOR,
  D4_SCENE,
  SCENE_UNITS_PER_METRE,
  SOURCE_MODEL_OFFSET,
  sceneToTm,
  tmToScene,
  tmToWgs84,
  wgs84ToTm,
} from "../../../src/geo/epsg5186.mjs";

export { D4_ANCHOR, D4_SCENE, SCENE_UNITS_PER_METRE, SOURCE_MODEL_OFFSET };

// Local metres per degree at the D4 latitude, kept for callers that grid or scale in degrees.
const LAT0_RAD = (D4_ANCHOR.latitude * Math.PI) / 180;
export const METRES_PER_DEGREE_LAT =
  111132.92 - 559.82 * Math.cos(2 * LAT0_RAD) + 1.175 * Math.cos(4 * LAT0_RAD);
export const METRES_PER_DEGREE_LON =
  111412.84 * Math.cos(LAT0_RAD) - 93.5 * Math.cos(3 * LAT0_RAD);

export function geoToModel(longitude, latitude) {
  return tmToScene(...wgs84ToTm(longitude, latitude));
}

export function modelToGeo(x, z) {
  return tmToWgs84(...sceneToTm(x, z));
}

export const metres = (value) => value * SCENE_UNITS_PER_METRE;

// Terrain/landcover extent in scene units (covers uni.glb's Topography).
export const EXTENT = Object.freeze({ minX: -2, maxX: 502, minZ: -376, maxZ: 2 });

import { SCENE_UNITS_PER_METRE } from '../../geo/epsg5186.mjs';

// The simulation network (backend routes.geojson) is in local east/north meters around the D4 coordinate
// 127.4764043, 34.9700548 (D4_ANCHOR), the anchor the VWorld dashboard also uses for its campus model and traffic overlay.
// `origin` is where simulation (0, 0), i.e. D4_ANCHOR, is drawn once CityModel recenters the model.
// backend/simulation/data/coordinate_transform.json and backend/build_mobility_data.py hold copies of it, and
// campusTrafficCoordinates.test.mjs and backend/tests/test_frame_origin_copies.py fail when they drift.
//
// Frame v2 (GLB asset.extras.frameVersion 2): BLD_D4 is the GIS footprint, whose bbox centre lies
// D4_LABEL_OFFSET_V2 scene units from D4_ANCHOR, so the BLD_D4 label lands on D4_LABEL_TARGET (the point the
// camera presets were measured around) and D4_ANCHOR on origin. Frame v1 assets (uni.glb, no frameVersion)
// assumed the BLD_D4 bbox centre was D4_ANCHOR and keep that rule: their BLD_D4 label lands on origin.
export const D4_LABEL_TARGET = Object.freeze({ x: -214.35, z: -93.251 });
// tmToScene(GIS BLD_D4 bbox centre [243507.55, 263879.65]) - tmToScene(D4_ANCHOR_TM), checked by the test.
export const D4_LABEL_OFFSET_V2 = Object.freeze({ x: 0.922, z: -2.011 });

export const CAMPUS_TRAFFIC_COORDINATE_CONFIG = Object.freeze({
  origin: { x: -215.272, y: 24, z: -91.24 },
  scale: SCENE_UNITS_PER_METRE,
  rotation_degrees: 0,
  invert_z: true,
});

// CityModel shifts the model by -center. Deriving center from the BLD_D4 anchor keeps the model on the traffic frame;
// an average of the label anchors moves whenever the label rules change and leaves vehicles off their roads.
// frameVersion comes from the GLB's asset.extras (undefined for v1 assets).
export function campusModelCenter(d4AnchorPosition, { frameVersion, config = CAMPUS_TRAFFIC_COORDINATE_CONFIG } = {}) {
  const shift = frameVersion >= 2 ? D4_LABEL_OFFSET_V2 : { x: 0, z: 0 };
  return {
    x: d4AnchorPosition[0] - shift.x - config.origin.x,
    z: d4AnchorPosition[2] - shift.z - config.origin.z,
  };
}

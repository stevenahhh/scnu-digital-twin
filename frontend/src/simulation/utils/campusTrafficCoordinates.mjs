// The simulation network (backend routes.geojson) is in local east/north meters around the D4 coordinate
// 127.4764043, 34.9700548, the anchor the VWorld dashboard also uses for its campus model and traffic overlay.
// uni.glb carries its export scale (0.6242 scene units per meter), and `origin` is where the BLD_D4 label anchor
// (bounding-box center) sits once CityModel recenters the model. backend/simulation/data/coordinate_transform.json
// and backend/build_mobility_data.py use the same frame.
export const CAMPUS_TRAFFIC_COORDINATE_CONFIG = Object.freeze({
  origin: { x: -214.35, y: 24, z: -93.251 },
  scale: 0.6242171526,
  rotation_degrees: 0,
  invert_z: true,
});

// CityModel shifts uni.glb by -center. Deriving center from the BLD_D4 anchor keeps the model on the traffic frame;
// an average of the label anchors moves whenever the label rules change and leaves vehicles off their roads.
export function campusModelCenter(d4AnchorPosition, config = CAMPUS_TRAFFIC_COORDINATE_CONFIG) {
  return {
    x: d4AnchorPosition[0] - config.origin.x,
    z: d4AnchorPosition[2] - config.origin.z,
  };
}

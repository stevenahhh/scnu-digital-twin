// Network debug layer edge style. Estimated edges (추정: fallback paths, estimated connectors, OSM perimeter roads)
// are amber and dashed whatever their kind; derived edges stay faint as before.
export const ESTIMATED_HEX = "#d97706";
export const SIDEWALK_HEX = "#2563eb";
export const CROSSWALK_HEX = "#f8fafc";
export const ROAD_HEX = "#475569";

const ROAD_KINDS = new Set(["vehicle_lane", "allowed_road", "vehicle_gate", "parking_connection"]);
const KIND_STYLE = {
  sidewalk: [SIDEWALK_HEX, false],
  crosswalk: [CROSSWALK_HEX, false],
  shared_path: ["#9333ea", false],
  pedestrian_gate: ["#16a34a", true],
  parking_walk: ["#16a34a", true],
  building_entrance: ["#22c55e", true],
  scooter_lane: ["#f97316", false],
  bike_lane: ["#f97316", false],
  scooter_parking_connection: ["#f97316", false],
};

export function styleForEdge(props = {}) {
  const opacity = props.derived ? 0.42 : 0.95;
  if (props.estimated) return { color: ESTIMATED_HEX, dashed: true, opacity };
  if (ROAD_KINDS.has(props.kind)) return { color: ROAD_HEX, dashed: false, opacity };
  const [color, dashed] = KIND_STYLE[props.kind] || ["#64748b", true];
  return { color, dashed, opacity };
}

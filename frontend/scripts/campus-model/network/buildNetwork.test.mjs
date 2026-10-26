import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { addAnchor, assembleNetwork, checkCollection, propertyNames } from "./buildNetwork.mjs";
import { NetGraph } from "./graph.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "../../../../backend/simulation/data");
const policy = JSON.parse(readFileSync(path.resolve(HERE, "../../../../backend/simulation/config/mobility_policy.json"), "utf8"));
const quiet = () => {};

test("the generated network keeps every property name and key of the derived-v1 baseline", () => {
  const old = JSON.parse(readFileSync(path.join(DATA, "campus_transport_network.derived-v1.geojson"), "utf8"));
  const now = JSON.parse(readFileSync(path.join(DATA, "campus_transport_network.geojson"), "utf8"));
  assert.deepEqual(checkCollection(now, old, policy), []);
  const before = propertyNames(old);
  const after = propertyNames(now);
  for (const [type, names] of Object.entries(before)) for (const name of names) assert.ok(after[type].has(name), `${type}.${name}`);
  for (const added of ["width_m", "lanes", "kerb_height_m", "estimated", "source_ref", "crosswalk_id", "sidewalk_id", "authoritative", "external_ids", "surface"]) assert.ok(after.edge.has(added), added);
  // every POI id survives
  const ids = (fc) => fc.features.filter((f) => f.properties.feature_type === "poi").map((f) => f.id).sort();
  assert.deepEqual(ids(now), ids(old));
});

// a minimal composition: one road edge, one sidewalk with a gate POI beside it
const fixture = () => {
  const node = (id, p) => ({ type: "Feature", id, geometry: { type: "Point", coordinates: p }, properties: { id, feature_type: "node", kind: "intersection", source: "road-zone-measured", confidence: 0.8, derived: false, authoritative: true, estimated: false } });
  const roads = {
    nodes: [node("ND_001", [0, 0]), node("ND_002", [50, 0])],
    edges: [{ type: "Feature", id: "EDGE_ROAD_0001", geometry: { type: "LineString", coordinates: [[0, 0], [50, 0]] }, properties: { id: "EDGE_ROAD_0001", feature_type: "edge", kind: "allowed_road", legacy_kind: "road", allowed_types: ["car", "scooter"], from_node: "ND_001", to_node: "ND_002", bidirectional: true, speed_limit: 25, road_ids: ["RD_001"], road_id: "RD_001", crosswalk_id: null, source_id: "EDGE_ROAD_0001", source: "road-zone-measured", confidence: 0.8, authoritative: true, derived: false, estimated: false, width_m: 7 } }],
    perimeter: { nodes: [], edges: [] },
  };
  const graph = new NetGraph();
  graph.addNode("SWN_0001", [0, 6], { kind: "sidewalk", sidewalk_id: "SW_001" });
  graph.addNode("SWN_0002", [50, 6], { kind: "sidewalk", sidewalk_id: "SW_001" });
  graph.addNode("POI_GATE_T", [25, 3], { kind: "poi", poi_id: "GATE_T", estimated: true });
  graph.addEdge({ id: "EDGE_SW_0001", from: "SWN_0001", to: "SWN_0002", points: [[0, 6], [50, 6]], kind: "sidewalk", sidewalk_id: "SW_001", width_m: 3, source: "NGII-A003", source_ref: "U1", authoritative: true, derived: false, estimated: false, confidence: 0.8 });
  graph.addEdge({ id: "EDGE_POI_POI_GATE_T", from: "POI_GATE_T", to: "SWN_0001", points: [[25, 3], [0, 6]], kind: "pedestrian_gate", source: "GIS-derived", authoritative: false, derived: false, estimated: false, confidence: 0.5 });
  const pois = [{ type: "Feature", id: "GATE_T", geometry: { type: "Point", coordinates: [25, 2] }, properties: { poi_id: "GATE_T", name: "gate", kind: "gate", node_id: "POI_GATE_T", allowed_types: ["car", "person", "scooter"], external: false, id: "GATE_T", feature_type: "poi", source: "derived", confidence: 0.3, derived: true, authoritative: false } }];
  const old = { type: "FeatureCollection", metadata: { schema_version: 1, coordinate_system: "local meters, x=east, z=north" }, features: [] };
  return { roads, graph, pois, old, kerbPieces: [{ points: [[0, 4.5], [50, 4.5]], height_m: 0.15 }] };
};

test("assembly is deterministic, links the gate to the road and carries the kerb height", () => {
  const a = fixture();
  const b = fixture();
  const one = JSON.stringify(assembleNetwork({ ...a, policy, log: quiet }).collection);
  const two = JSON.stringify(assembleNetwork({ ...b, policy, log: quiet }).collection);
  assert.equal(one, two);
  const fc = JSON.parse(one);
  const gate = fc.features.find((f) => f.properties.kind === "vehicle_gate");
  assert.ok(gate, "vehicle_gate edge");
  assert.deepEqual(gate.properties.allowed_types, ["car", "scooter"]);
  assert.equal(fc.features.find((f) => f.id === "EDGE_SW_0001").properties.kerb_height_m, 0.15);
  assert.deepEqual(checkCollection(fc, a.old, policy), []);
});

test("an edge without from_node is a validation error", () => {
  const a = fixture();
  const fc = assembleNetwork({ ...a, policy, log: quiet }).collection;
  fc.features.push({ type: "Feature", id: "EDGE_BAD", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { id: "EDGE_BAD", feature_type: "edge", kind: "sidewalk", allowed_types: ["person"], to_node: "ND_001", derived: false, estimated: false } });
  assert.ok(checkCollection(fc, a.old, policy).some((e) => e.startsWith("EDGE_BAD: from_node/to_node missing")));
});

test("the anchor is added once to coordinate_transform.json", () => {
  const text = '{\n  "scale": 1,\n  "sumo_origin": {"x": 0.0, "z": 0.0}\n}\n';
  const once = addAnchor(text);
  assert.ok(JSON.parse(once).epsg5186_anchor.E > 200000);
  // the grid matrix carries the meridian convergence (about -0.27 deg here) for the SUMO export
  const [m00, , m10] = JSON.parse(once).epsg5186_local_to_grid;
  assert.ok(Math.abs((Math.atan2(m10, m00) * 180) / Math.PI - 0.273) < 0.01);
  assert.equal(addAnchor(once), once);
});

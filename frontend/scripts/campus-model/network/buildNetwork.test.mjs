import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { addAnchor, assembleNetwork, checkCollection, entrancePois, propertyNames, waterCrossings, waterPolygons } from "./buildNetwork.mjs";
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
  // every POI id survives; a POI added since the baseline is a building POI of a building_entrances.json entrance
  const pois = (fc) => fc.features.filter((f) => f.properties.feature_type === "poi");
  const nowIds = new Set(pois(now).map((f) => f.id));
  for (const f of pois(old)) assert.ok(nowIds.has(f.id), `POI ${f.id} lost`);
  const entrances = JSON.parse(readFileSync(path.join(DATA, "building_entrances.json"), "utf8")).buildings.map((b) => b.building_id);
  const oldIds = new Set(pois(old).map((f) => f.id));
  for (const f of pois(now).filter((x) => !oldIds.has(x.id))) assert.ok(f.properties.kind === "building" && entrances.includes(f.id), `unexpected POI ${f.id}`);
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

test("a building of building_entrances.json without a POI gets a derived building POI on its entrance; known ones are left", () => {
  const old = { features: [{ type: "Feature", id: "BLD_D4", properties: { feature_type: "poi", poi_id: "BLD_D4" } }] };
  const json = { buildings: [
    { building_id: "BLD_D4", building_name: "D4", entrances: [{ entrance_id: "ENT_D4_MAIN", position: [1, 0, 2], node_id: "POI_ENT_D4_MAIN", allowed_types: ["person", "scooter"] }] },
    { building_id: "BLD_E8", building_name: "E8", category: "academic", entrances: [{ entrance_id: "ENT_E8_MAIN", position: [75.8, 0, -165.8], node_id: "POI_ENT_E8_MAIN", allowed_types: ["person"] }] },
  ] };
  const out = entrancePois(json, old);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].id, out[0].properties.kind, out[0].properties.node_id, out[0].properties.derived], ["BLD_E8", "building", "POI_ENT_E8_MAIN", true]);
  assert.deepEqual(out[0].geometry.coordinates, [75.8, -165.8]);
});

test("network:build fails on a person edge across water: the old straight S20 link over the c1 pool is caught", () => {
  // pool oval (simplified) and the PR #101 straight EDGE_PLAZA_PAVEDCOURT_0003_2 (PLAZA_PAVEDCOURT_0003 -> CWN_013_A)
  const pool = { id: "water: c1 pool", rings: [Array.from({ length: 24 }, (_, k) => [345 + 14 * Math.cos((k * Math.PI) / 12), -50 + 6 * Math.sin((k * Math.PI) / 12)])] };
  const edge = (id, coordinates, allowed = ["person"]) => ({ type: "Feature", id, geometry: { type: "LineString", coordinates }, properties: { feature_type: "edge", allowed_types: allowed } });
  const old = edge("EDGE_PLAZA_PAVEDCOURT_0003_2", [[313.609, -45.379], [388.032, -55.037]]);
  const around = edge("EDGE_PLAZA_PAVEDCOURT_0003_2", [[313.609, -45.379], [330, -60], [360, -60], [388.032, -55.037]]);
  const car = edge("EDGE_ROAD", [[300, -50], [400, -50]], ["car"]);
  assert.equal(waterCrossings([old], [pool]).length, 1);
  assert.match(waterCrossings([old], [pool])[0], /crosses water water: c1 pool/);
  assert.deepEqual(waterCrossings([around, car], [pool]), []);
  assert.deepEqual(waterPolygons([{ paint: { kind: "water" }, source_ref: "w", rings: [[[0, 0]]] }, { paint: { kind: "tiles" }, rings: [] }]).map((w) => w.id), ["w"]);
});

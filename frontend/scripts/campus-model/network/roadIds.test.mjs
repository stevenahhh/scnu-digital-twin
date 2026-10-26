import assert from "node:assert/strict";
import test from "node:test";

import { simulationToWgs84 } from "../../../src/geo/epsg5186.mjs";
import { addToElementsFile, buildRoadSegments, crosswalkElements } from "./roadIds.mjs";

// Rectangles in simulation metres -> lon/lat polygons.
const lonLat = (x, z) => simulationToWgs84({ x, z });
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => lonLat(x, z));
const zone = (id, name, ring) => ({ type: "Feature", properties: { FEATURE_ID: id, ZONE_NAME: name }, geometry: { type: "Polygon", coordinates: [ring] } });

const zones = {
  type: "FeatureCollection",
  features: [
    zone("RZ-001", "가람로", rect(0, -3.5, 60, 3.5)), // 60 m long, 7 m wide, along +x
    zone("RZ-002", "새길", rect(100, 0, 105, 40)), // 5 m wide, along +z, no RD_ name
    zone("RZ-003", "가람삼거리", rect(60, -5, 70, 5)), // intersection area, not a road segment
  ],
};
const elements = [
  { element_id: "RD_001", name: "가람로", element_type: "road", zone_id: "zone_A", geometry: null },
  { element_id: "RD_007", name: "숲길", element_type: "road", zone_id: "zone_B", geometry: null },
  { element_id: "ND_001", name: "가람삼거리", element_type: "intersection", zone_id: "zone_A", geometry: null },
];
const osmLines = [
  { id: "way/900", kind: "arterial", tags: { name: "큰길", highway: "primary", lanes: "4" }, line: [lonLat(-50, 50), lonLat(150, 50)] },
  { id: "way/901", kind: "crossing", tags: { highway: "footway" }, line: [lonLat(0, 50), lonLat(0, 60)] },
];

test("ids are stable across two runs and new ids continue above the highest RD_", () => {
  const first = buildRoadSegments({ roadZones: zones, osmLines, elements });
  assert.deepEqual(first.allocated.map((e) => [e.element_id, e.name]), [["RD_008", "새길"], ["RD_009", "큰길"]]);
  const second = buildRoadSegments({ roadZones: zones, osmLines, elements: [...elements, ...first.allocated] });
  assert.equal(second.allocated.length, 0);
  assert.deepEqual(second.features.map((f) => f.properties.id), first.features.map((f) => f.properties.id));
  assert.deepEqual(first.features.map((f) => f.properties.id), ["RD_001", "RD_007", "RD_008", "RD_009"]);
});

test("width of a 7 m rectangle zone measures 7.0 m; a 5 m zone 5.0 m", () => {
  const { features } = buildRoadSegments({ roadZones: zones, osmLines: [], elements });
  const garam = features.find((f) => f.properties.id === "RD_001");
  assert.ok(Math.abs(garam.properties.width_m - 7) <= 0.1, `${garam.properties.width_m}`);
  assert.equal(garam.properties.width_source, "road_zone_measured");
  const sae = features.find((f) => f.properties.name === "새길");
  assert.ok(Math.abs(sae.properties.width_m - 5) <= 0.1, `${sae.properties.width_m}`);
  const forest = features.find((f) => f.properties.id === "RD_007");
  assert.equal(forest.geometry, null);
  assert.equal(forest.properties.width_m, null);
});

test("lanes = 2 when a yellow centre line runs along the centreline, else 1 assumed", () => {
  const yellow = [[[2, 0.4], [58, 0.4]]];
  const withLine = buildRoadSegments({ roadZones: zones, osmLines: [], elements, yellowLines: yellow }).features.find((f) => f.properties.id === "RD_001");
  assert.equal(withLine.properties.lanes, 2);
  assert.equal(withLine.properties.lanes_source, "markings");
  const without = buildRoadSegments({ roadZones: zones, osmLines: [], elements }).features.find((f) => f.properties.id === "RD_001");
  assert.deepEqual([without.properties.lanes, without.properties.lanes_source], [1, "assumed"]);
});

test("OSM ids only on perimeter features; crossings are not road segments", () => {
  const { features } = buildRoadSegments({ roadZones: zones, osmLines, elements });
  for (const f of features) {
    if (f.properties.kind === "interior") assert.equal(f.properties.external_ids.osm_way, null);
    else assert.match(f.properties.external_ids.osm_way, /^way\/\d+$/);
  }
  const perimeter = features.filter((f) => f.properties.kind === "perimeter");
  assert.deepEqual(perimeter.map((f) => [f.properties.external_ids.osm_way, f.properties.lanes]), [["way/900", 4]]);
});

test("two zones sharing one name throw naming both zones", () => {
  const dup = { type: "FeatureCollection", features: [zone("RZ-010", "같은길", rect(0, 0, 10, 4)), zone("RZ-011", "같은길", rect(20, 0, 30, 4))] };
  assert.throws(() => buildRoadSegments({ roadZones: dup, elements }), /duplicate road name 같은길: zones RZ-010 and RZ-011/);
});

test("crosswalk elements take the zone of the nearest named crossing; the elements file edit is add-only", () => {
  const cw = (id, x) => ({ type: "Feature", properties: { id, source: "satellite_image_digitized" }, geometry: { type: "Polygon", coordinates: [rect(x, 0, x + 4, 8)] } });
  const crosswalks = { type: "FeatureCollection", features: [cw("CW_001", 0), cw("CW_002", 200), cw("CW_003", 190)] };
  const known = [
    { element_id: "CW_001", name: "a", element_type: "crosswalk", zone_id: "zone_A" },
    { element_id: "CW_002", name: "b", element_type: "crosswalk", zone_id: "zone_D" },
  ];
  const added = crosswalkElements(crosswalks, known);
  assert.deepEqual(added.map((e) => [e.element_id, e.zone_id]), [["CW_003", "zone_D"]]);
  const text = `{\n  "metadata": {\n    "project": "x"\n  },\n  "zones": [],\n  "elements": [\n    {\n      "element_id": "CW_001"\n    }\n  ]\n}\n`;
  const once = addToElementsFile(text, { newElements: added, idScheme: { RD_: "road" }, placeholders: [{ element_id: "SW_001" }] });
  const parsed = JSON.parse(once.text);
  assert.deepEqual(parsed.elements.map((e) => e.element_id), ["CW_001", "CW_003"]);
  assert.deepEqual(parsed.metadata, { project: "x", id_scheme: { RD_: "road" } });
  assert.equal(parsed.sidewalk_placeholders.length, 1);
  assert.ok(once.text.startsWith(text.slice(0, text.indexOf('\n  },\n  "zones"'))));
  const twice = addToElementsFile(once.text, { newElements: added, idScheme: { RD_: "road" }, placeholders: [{ element_id: "SW_001" }] });
  assert.equal(twice.text, once.text);
  assert.equal(twice.added.length, 0);
});

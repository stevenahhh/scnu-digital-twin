import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { simulationToWgs84 } from "../../../src/geo/epsg5186.mjs";
import { CROSSWALK_BY_ZONE, buildRoads, exitCodeFor, isIntersectionName, perimeterCollection, statsLine } from "./roads.mjs";

// Polygons in simulation metres -> lon/lat zones.
const lonLat = ([x, z]) => simulationToWgs84({ x, z });
const ring = (pts) => [...pts, pts[0]].map(lonLat);
const rect = (x0, z0, x1, z1) => ring([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
const zone = (id, name, ...rings) => ({ type: "Feature", properties: { FEATURE_ID: id, ZONE_NAME: name }, geometry: { type: "Polygon", coordinates: rings } });
const fc = (...features) => ({ type: "FeatureCollection", features });

// T: a 60 x 8 bar along +x (axis z = 4) with a 8 m wide, 40 m long stem going to -z (axis x = 30).
const T = ring([[0, 0], [26, 0], [26, -40], [34, -40], [34, 0], [60, 0], [60, 8], [0, 8]]);
const elements = [
  { element_id: "RD_001", name: "가람로", element_type: "road" },
  { element_id: "RD_002", name: "나래길", element_type: "road" },
];
const segment = (id, line, extra) => ({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { id, kind: "interior", width_m: 8, width_source: "road_zone_measured", lanes: 1, lanes_source: "assumed", ...extra } });
const roadSegments = {
  features: [
    segment("RD_001", [[2, 4], [58, 4]], { lanes: 2, lanes_source: "markings", road_zone: "RZ-001" }),
    segment("RD_002", [[30, -2], [30, -38]], { road_zone: "RZ-002" }),
  ],
};
// the T as two named zones would split it; here it is one zone named after RD_001 and the stem is checked by overlap
const tZones = fc(zone("RZ-001", "가람로", T));

const axisDistance = (p) => Math.min(Math.abs(p[1] - 4), Math.abs(p[0] - 30)); // distance to the nearer medial axis line

test("a T-shaped zone gives 3 edges meeting at one node, on the medial axis", () => {
  const result = buildRoads({ roadZones: tZones, roadSegments, elements });
  assert.equal(result.edges.length, 3);
  const degree = new Map();
  for (const e of result.edges) for (const n of [e.properties.from_node, e.properties.to_node]) degree.set(n, (degree.get(n) ?? 0) + 1);
  assert.equal([...degree.values()].filter((d) => d === 3).length, 1);
  assert.equal(result.nodes.length, 4);
  for (const e of result.edges) {
    const c = e.geometry.coordinates;
    const horizontal = Math.abs(c[0][1] - c.at(-1)[1]) < 1;
    for (let i = 0; i < c.length; i += 1) {
      const off = horizontal ? Math.abs(c[i][1] - 4) : Math.abs(c[i][0] - 30);
      assert.ok(off <= 0.15, `centreline ${off.toFixed(3)} m off the medial axis`);
      assert.ok(axisDistance(c[i]) <= 0.15);
    }
  }
  // every edge carries the measured, non-estimated properties
  for (const e of result.edges) {
    assert.equal(e.properties.source, "road-zone-measured");
    assert.equal(e.properties.source_ref, "가람로");
    assert.equal(e.properties.authoritative, true);
    assert.equal(e.properties.derived, false);
    assert.equal(e.properties.estimated, false);
    assert.deepEqual(e.properties.allowed_types, ["car", "scooter"]);
    assert.equal(e.properties.kind, "allowed_road");
  }
});

test("each edge takes the RD_ segment it overlaps most, with its lanes and width", () => {
  const result = buildRoads({ roadZones: tZones, roadSegments, elements });
  const stem = result.edges.find((e) => Math.abs(e.geometry.coordinates[0][0] - 30) < 0.5 && Math.abs(e.geometry.coordinates.at(-1)[0] - 30) < 0.5);
  const bars = result.edges.filter((e) => e !== stem);
  assert.equal(stem.properties.road_id, "RD_002");
  assert.deepEqual(stem.properties.road_ids, ["RD_002"]);
  assert.equal(stem.properties.lanes, 1);
  for (const bar of bars) {
    assert.equal(bar.properties.road_id, "RD_001");
    assert.equal(bar.properties.lanes, 2);
    assert.equal(bar.properties.lanes_source, "markings");
    assert.equal(bar.properties.width_m, 8);
    assert.equal(bar.properties.width_source, "road_zone_measured");
  }
});

test("an OSM line appears only in the perimeter output, with its way id and the ODbL licence", () => {
  const osmLines = [{ id: "way/900", kind: "arterial", tags: { name: "큰길", highway: "primary", lanes: "4" }, line: [lonLat([-50, 200]), lonLat([150, 200])] }];
  const result = buildRoads({ roadZones: tZones, roadSegments, elements, osmLines });
  assert.ok(result.edges.every((e) => e.properties.source === "road-zone-measured" && !e.properties.external_ids));
  assert.ok(result.edges.every((e) => !JSON.stringify(e).includes("way/900")));
  const out = perimeterCollection(result);
  assert.equal(out.metadata.licence, "ODbL 1.0, (c) OpenStreetMap contributors");
  const edges = out.features.filter((f) => f.properties.feature_type === "edge");
  assert.equal(edges.length, 1);
  assert.equal(edges[0].properties.external_ids.osm_way, "way/900");
  assert.equal(edges[0].properties.source, "OSM-derived");
  assert.equal(edges[0].properties.authoritative, false);
  assert.equal(edges[0].properties.estimated, true);
});

test("OSM geometry inside a road zone is not used", () => {
  const osmLines = [{ id: "way/901", kind: "connector", tags: { highway: "service" }, line: [lonLat([5, 4]), lonLat([55, 4])] }];
  const result = buildRoads({ roadZones: tZones, roadSegments, elements, osmLines });
  assert.equal(result.perimeter.edges.length, 0);
});

test("a zone with a hole gives two one-way edges around it and nothing inside the hole", () => {
  const hole = [[14, 14], [14, 26], [26, 26], [26, 14]];
  const outer = [[0, 0], [40, 0], [40, 40], [0, 40]];
  const zones = fc(zone("RZ-010", "가람로", ring(outer), ring(hole.slice().reverse())));
  const result = buildRoads({ roadZones: zones, roadSegments: { features: [] }, elements });
  const oneway = result.edges.filter((e) => e.properties.oneway);
  assert.equal(oneway.length, 2);
  assert.equal(result.edges.length, 2);
  for (const e of oneway) assert.equal(e.properties.bidirectional, false);
  for (const e of result.edges) {
    const c = e.geometry.coordinates;
    for (let i = 0; i + 1 < c.length; i += 1) {
      const n = Math.max(1, Math.ceil(Math.hypot(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]) / 0.25));
      for (let k = 0; k <= n; k += 1) {
        const x = c[i][0] + ((c[i + 1][0] - c[i][0]) * k) / n;
        const y = c[i][1] + ((c[i + 1][1] - c[i][1]) * k) / n;
        assert.ok(!(x > 14 && x < 26 && y > 14 && y < 26), `edge sample (${x.toFixed(2)}, ${y.toFixed(2)}) inside the hole`);
      }
    }
  }
  // counter-clockwise circulation (right-hand traffic): the two halves together turn +2 pi around the hole centre
  let turn = 0;
  for (const e of oneway) {
    const c = e.geometry.coordinates;
    for (let i = 0; i + 1 < c.length; i += 1) {
      const a = [c[i][0] - 20, c[i][1] - 20];
      const b = [c[i + 1][0] - 20, c[i + 1][1] - 20];
      turn += Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
    }
  }
  assert.ok(Math.abs(turn - 2 * Math.PI) < 0.2, `net turn ${turn}`);
  assert.equal(result.stats.insideRoadPct, 100);
});

test("every interior edge sample (1 m) lies inside the road polygons", () => {
  const result = buildRoads({ roadZones: tZones, roadSegments, elements });
  assert.equal(result.stats.insideRoadPct, 100);
  assert.ok(result.stats.samples > 100);
  assert.equal(result.stats.carComponents, 1);
  assert.equal(exitCodeFor(result.stats), 0);
  assert.match(statsLine(result.stats), /^zones 1, nodes 4 \(matched 0 of 0 ND_\), interior edges 3, perimeter edges 0, inside-road 100\.0 %, car components 1$/);
});

test("two zones that do not touch are reported as two components and fail the check", () => {
  const zones = fc(zone("RZ-001", "가람로", rect(0, 0, 60, 8)), zone("RZ-002", "나래길", rect(200, 0, 260, 8)));
  const result = buildRoads({ roadZones: zones, roadSegments: { features: [] }, elements });
  assert.equal(result.stats.carComponents, 2);
  assert.equal(exitCodeFor(result.stats), 1);
  assert.equal(result.stats.bridges, 0);
});

test("zones whose polygons are a few metres apart are bridged by an estimated edge", () => {
  const zones = fc(zone("RZ-001", "가람로", rect(0, 0, 60, 8)), zone("RZ-002", "나래길", rect(66, 0, 126, 8)));
  const result = buildRoads({ roadZones: zones, roadSegments: { features: [] }, elements });
  assert.equal(result.stats.carComponents, 1);
  const bridge = result.edges.filter((e) => e.properties.gap_reason);
  assert.equal(bridge.length, 1);
  assert.equal(bridge[0].properties.estimated, true);
  assert.equal(bridge[0].properties.authoritative, false);
  assert.equal(bridge[0].properties.confidence, 0.2);
  assert.equal(result.stats.insideRoadPct, 100);
});

test("an intersection zone becomes one ND_ node that the roads running into it join", () => {
  const zones = fc(
    zone("RZ-001", "가람로", rect(0, -4, 60, 4)),
    zone("RZ-002", "가람삼거리", rect(60, -8, 76, 8)),
    zone("RZ-003", "나래길", rect(76, -4, 136, 4)),
  );
  const nd = [{ element_id: "ND_001", name: "가람삼거리", element_type: "intersection" }];
  const network = { features: [{ type: "Feature", geometry: { type: "Point", coordinates: [66, 1] }, properties: { feature_type: "node", source_route_id: "campus_rz-002" } }] };
  const result = buildRoads({ roadZones: zones, roadSegments: { features: [] }, elements: [...elements, ...nd], network });
  assert.equal(result.stats.carComponents, 1);
  assert.equal(result.stats.ndMatched, 1);
  assert.ok(result.nodes.some((n) => n.properties.id === "ND_001" && n.properties.nd_matched));
  assert.equal(result.allocated.length, 0);
});

test("the ported name rules and the zone -> crossing map are intact", () => {
  assert.ok(isIntersectionName("중앙교차로") && isIntersectionName("대학본부사거리") && isIntersectionName("박물관삼거리"));
  assert.ok(!isIntersectionName("정문앞길"));
  assert.equal(Object.keys(CROSSWALK_BY_ZONE).length, 14);
  assert.equal(CROSSWALK_BY_ZONE["정문앞길"], "CW_007");
});

test("--zones with a missing file exits 2 and names the path", { skip: spawnSync("bun", ["--version"]).error ? "bun is not installed" : false }, () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "roads.mjs");
  const run = spawnSync("bun", [script, "--stats", "--zones", "/nonexistent.geojson"], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /\/nonexistent\.geojson/);
});

test("an estimated ASPHALT / LOT layer stays estimated in the road polygons; a measured one does not gain the flag", () => {
  const ring = [[500, 500], [510, 500], [510, 510], [500, 510], [500, 500]];
  const layers = { ASPHALT: [{ id: "paving: red junction (estimate)", rings: [ring], estimated: true }], LOT: [{ id: "lot A", rings: [ring], estimated: false }] };
  const { polygons } = buildRoads({ roadZones: tZones, roadSegments, elements, layers });
  assert.equal(polygons.find((p) => p.id === "paving: red junction (estimate)").estimated, true);
  assert.equal(polygons.find((p) => p.id === "lot A").estimated, undefined);
});

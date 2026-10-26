import assert from "node:assert/strict";
import test from "node:test";

import { buildFallback, gapsCollection } from "./fallback.mjs";
import { NetGraph } from "./graph.mjs";
import { buildSidewalks } from "./sidewalks.mjs";

const closed = (pts) => [...pts, pts[0]];
const rect = (x0, y0, x1, y1) => closed([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const quiet = () => {};
const len = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const road = (id, from, to, coords) => ({ id, geometry: { type: "LineString", coordinates: coords }, properties: { road_id: "RD_001", from_node: from, to_node: to } });
// a 100 m road (6 m wide) along x with a 3 m sidewalk strip along its first 40 m (kerb y = 3, centreline y = 4.5)
const roads = { edges: [road("EDGE_ROAD_0001", "ND_A", "ND_B", [[0, 0], [100, 0]])], polygons: [{ class: "road", rings: [rect(0, -3, 100, 3)] }] };
const sidewalks = (walkways) => buildSidewalks({ walkways, warn: quiet });
const sw40 = () => sidewalks([{ ufid: "S", widt: 3, lines: [rect(0, 3, 40, 6)] }]);

test("a road with a sidewalk along its first 40 m and a POI at its far end keeps one estimated run", () => {
  const s = sw40();
  const graph = NetGraph.fromSidewalks(s);
  const r = buildFallback({ roads, graph, coverage: s.coverage, pois: [{ id: "BLD_X", p: [100, 0] }], warn: quiet });
  const runs = r.edges.filter((e) => e.id.startsWith("EDGE_FB_"));
  assert.equal(runs.length, 1);
  const L = len(runs[0].points);
  assert.ok(L >= 46 - 1e-6 && L <= 60, `run ${L}`);
  for (const e of r.edges) {
    assert.equal(e.estimated, true);
    assert.equal(e.confidence, 0.2);
    assert.equal(e.derived, true);
    assert.equal(e.authoritative, false);
    assert.equal(e.kind, "shared_path");
    assert.equal(e.source, "derived_from_vehicle_network");
  }
  assert.equal(runs[0].gap_reason, "no NGII A003 within 15 m");
  assert.equal(r.stats.personComponents, 1);
});

test("a run no essential node needs is dropped", () => {
  const s = sw40();
  const graph = NetGraph.fromSidewalks(s);
  const r = buildFallback({ roads, graph, coverage: s.coverage, pois: [{ id: "BLD_Y", p: [20, 6] }], warn: quiet });
  assert.equal(r.edges.length, 0);
  assert.equal(r.stats.dropped, 1);
  assert.equal(r.gaps.length, 1);
  assert.equal(r.gaps[0].retained, false);
});

test("a run inside a plaza polygon is labelled surface plaza", () => {
  const s = sw40();
  const graph = NetGraph.fromSidewalks(s);
  const r = buildFallback({ roads, graph, coverage: s.coverage, pois: [{ id: "BLD_X", p: [100, 0] }], plazas: [{ rings: [rect(45, -10, 105, 10)] }], warn: quiet });
  assert.equal(r.edges.find((e) => e.id.startsWith("EDGE_FB_")).surface, "plaza");
});

test("without any A003 every road edge is a candidate and the warning is logged", () => {
  const warnings = [];
  const graph = new NetGraph();
  const r = buildFallback({ roads, graph, pois: [{ id: "A", p: [0, 0] }, { id: "B", p: [100, 0] }], warn: (m) => warnings.push(m) });
  assert.ok(warnings.some((m) => m.startsWith("A003 missing entirely")));
  assert.equal(r.gaps.length, 1);
  assert.ok(len(r.gaps[0].points) > 99);
});

test("the gap collection lists every uncovered run with its lead", () => {
  const s = sw40();
  const r = buildFallback({ roads, graph: NetGraph.fromSidewalks(s), coverage: s.coverage, pois: [], warn: quiet });
  const fc = gapsCollection(r.gaps);
  assert.equal(fc.features.length, 1);
  assert.equal(fc.features[0].properties.lead, "NGII 1:1,000 sheet O6 / field survey");
  assert.equal(fc.features[0].properties.epsg5186.length, fc.features[0].geometry.coordinates.length);
});

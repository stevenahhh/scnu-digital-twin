import assert from "node:assert/strict";
import test from "node:test";

import { buildCrossings, crossingAngle } from "./crossings.mjs";
import { NetGraph } from "./graph.mjs";
import { buildSidewalks } from "./sidewalks.mjs";

const closed = (pts) => [...pts, pts[0]];
const rect = (x0, y0, x1, y1) => closed([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const quiet = () => {};
// a 6 m wide road along x (y -3..3), centreline y = 0
const roads = {
  edges: [{ id: "EDGE_ROAD_0001", geometry: { type: "LineString", coordinates: [[0, 0], [60, 0]] }, properties: { road_id: "RD_001", source_ref: "가람로" } }],
  polygons: [{ id: "RD_001", class: "road", rings: [rect(0, -3, 60, 3)] }],
};
const sidewalkGraph = (south = [-6, -3]) => NetGraph.fromSidewalks(buildSidewalks({
  walkways: [
    { ufid: "N", widt: 3, lines: [rect(0, 3, 60, 6)] },
    { ufid: "S", widt: 3, lines: [rect(0, south[0], 60, south[1])] },
  ],
  warn: quiet,
}));

test("a 4 m crossing polygon gives one edge perpendicular to the road, kerb to kerb, ending on sidewalk nodes", () => {
  const graph = sidewalkGraph();
  const r = buildCrossings({ crosswalks: [{ id: "CW_001", ring: rect(18, -3, 22, 3) }], roads, graph, warn: quiet });
  assert.equal(r.edges.length, 1);
  const e = r.edges[0];
  assert.ok(Math.abs(crossingAngle(e, roads.edges[0].geometry.coordinates) - 90) <= 1);
  assert.ok(Math.abs(e.crossing_length_m - 6.0) <= 0.1, `span ${e.crossing_length_m}`);
  assert.equal(graph.nodes.get(e.from).kind, "sidewalk");
  assert.equal(graph.nodes.get(e.to).kind, "sidewalk");
  assert.equal(e.crosswalk_id, "CW_001");
  assert.equal(e.road_id, "RD_001");
  assert.equal(e.kind, "crosswalk");
  assert.equal(e.source, "ortho-traced");
  assert.equal(e.authoritative, true);
  assert.ok(Math.abs(e.width_m - 4) < 1e-6);
  assert.equal(r.stats.connectors, 0);
});

test("a polygon skewed 30 deg to the road still gives a crossing perpendicular to the road", () => {
  const graph = sidewalkGraph();
  const k = Math.tan(Math.PI / 6) * 3;
  const skew = closed([[18 - k, -3], [22 - k, -3], [22 + k, 3], [18 + k, 3]]);
  const r = buildCrossings({ crosswalks: [{ id: "CW_002", ring: skew }], roads, graph, warn: quiet });
  assert.ok(Math.abs(crossingAngle(r.edges[0], roads.edges[0].geometry.coordinates) - 90) <= 1);
});

test("a side without a sidewalk within 3 m gets one estimated connector", () => {
  const graph = sidewalkGraph([-12, -9]);
  const r = buildCrossings({ crosswalks: [{ id: "CW_003", ring: rect(18, -3, 22, 3) }], roads, graph, warn: quiet });
  assert.equal(r.stats.connectors, 1);
  const c = graph.edges.find((e) => e.id.startsWith("EDGE_CWC_"));
  assert.equal(c.estimated, true);
  assert.equal(c.confidence, 0.2);
  assert.equal(c.kind, "shared_path");
  assert.equal(c.authoritative, false);
});

test("a duplicate CW id throws", () => {
  assert.throws(() => buildCrossings({ crosswalks: [{ id: "CW_004", ring: rect(18, -3, 22, 3) }, { id: "CW_004", ring: rect(30, -3, 34, 3) }], roads, graph: sidewalkGraph(), warn: quiet }), /duplicate CW id/);
});

test("a polygon 20 m from any road is skipped with a warning", () => {
  const warnings = [];
  const r = buildCrossings({ crosswalks: [{ id: "CW_005", ring: rect(18, 23, 22, 29) }], roads, graph: sidewalkGraph(), warn: (m) => warnings.push(m) });
  assert.equal(r.edges.length, 0);
  assert.deepEqual(r.stats.skippedIds, ["CW_005"]);
  assert.ok(warnings.includes("CW_005: no road within 6 m, skipped"));
});

test("the zone map and the dropped-kerb list are cross-checked, never applied", () => {
  const warnings = [];
  const r = buildCrossings({ crosswalks: [{ id: "CW_006", ring: rect(18, -3, 22, 3) }], roads, graph: sidewalkGraph(), kerbTouched: [], crosswalkByZone: { 나래길: "CW_006" }, warn: (m) => warnings.push(m) });
  assert.equal(r.stats.mismatches, 1);
  assert.equal(r.stats.kerbDifferences, 1);
  assert.equal(r.edges.length, 1);
});

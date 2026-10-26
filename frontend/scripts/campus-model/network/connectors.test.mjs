import assert from "node:assert/strict";
import test from "node:test";

import { buildConnectors, walkablePolygons } from "./connectors.mjs";
import { inRings, lineLength, sampleLine } from "./geom.mjs";
import { NetGraph } from "./graph.mjs";
import { buildSidewalks } from "./sidewalks.mjs";

const closed = (pts) => [...pts, pts[0]];
const rect = (x0, y0, x1, y1) => closed([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const quiet = () => {};
// a 10 x 10 m building, a sidewalk strip north of it (17 skeleton cells wide, centreline y = 12.8), a paved forecourt
// between them
const footprint = { id: "BLD_T", rings: [rect(0, 0, 10, 10)] };
const sidewalk = () => buildSidewalks({ walkways: [{ ufid: "S", widt: 2, lines: [rect(-20, 11.7375, 30, 13.8625)] }], warn: quiet });
const setup = () => {
  const sw = sidewalk();
  const graph = NetGraph.fromSidewalks(sw);
  const walkable = [...walkablePolygons({ strips: sw.strips }), { class: "plaza", rings: [rect(-2, 10, 12, 12)] }];
  return { graph, walkable };
};
const entrance = (position, extra = {}) => ({ building_id: "BLD_T", entrance_id: "ENT_T_MAIN", node_id: "POI_ENT_T_MAIN", position, allowed_types: ["person", "scooter"], ...extra });

test("an entrance 2 m from a sidewalk across a forecourt gets one straight connector", () => {
  const { graph, walkable } = setup();
  const r = buildConnectors({ entrances: [entrance([5, 10.8])], graph, walkable, buildings: [footprint], warn: quiet });
  const e = r.edges[0];
  assert.equal(e.route, "straight");
  assert.ok(Math.abs(lineLength(e.points) - 2) <= 0.05, `length ${lineLength(e.points)}`);
  assert.equal(e.kind, "building_entrance");
  assert.equal(e.estimated, false);
  assert.equal(graph.nodes.get(e.to).kind, "sidewalk");
  assert.equal(r.report[0].snapped_node, e.to);
});

test("an entrance behind its building goes round the apron, never through the footprint", () => {
  const { graph, walkable } = setup();
  const r = buildConnectors({ entrances: [entrance([5, -0.8])], graph, walkable, buildings: [footprint], warn: quiet });
  const e = r.edges[0];
  assert.equal(e.route, "apron_ring");
  for (const p of sampleLine(e.points, 0.25)) assert.ok(!inRings(p, footprint.rings), `inside the footprint at ${p}`);
});

test("a POI on top of an existing node gets its own node >= 0.5 m away and a connector", () => {
  const { graph, walkable } = setup();
  const end = [...graph.nodes.values()][0];
  const r = buildConnectors({ pois: [{ poi_id: "GATE_T", kind: "gate", node_id: "POI_GATE_T", allowed_types: ["person"], p: end.p.slice() }], graph, walkable, warn: quiet });
  const poi = graph.nodes.get("POI_GATE_T");
  assert.ok(Math.hypot(poi.p[0] - end.p[0], poi.p[1] - end.p[1]) >= 0.5);
  assert.ok(lineLength(r.edges[0].points) >= 0.5);
  assert.equal(r.stats.coincident, 0);
});

test("an entrance 80 m from any sidewalk gets an estimated connector and the warning", () => {
  const { graph, walkable } = setup();
  const warnings = [];
  const far = { id: "BLD_T", rings: [rect(0, 80, 10, 90)] };
  const r = buildConnectors({ entrances: [entrance([5, 90.8])], graph, walkable, buildings: [far], warn: (m) => warnings.push(m) });
  assert.equal(r.edges[0].estimated, true);
  assert.equal(r.edges[0].confidence, 0.2);
  assert.ok(warnings.includes("BLD_T entrance unreachable within 50 m"));
});

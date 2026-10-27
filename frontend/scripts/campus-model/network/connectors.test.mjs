import assert from "node:assert/strict";
import test from "node:test";

import { buildConnectors, plazaLinks, walkablePolygons } from "./connectors.mjs";
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

test("a paving supplement marked walkable joins the walkable polygons as an estimated plaza; an unmarked one does not", () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const out = walkablePolygons({ layers: [
    { cls: "PAVING", precedence: 5.8, walkablePlaza: true, source_ref: "paving: E8 front courtyard", rings: [ring] },
    { cls: "PAVING", precedence: 5.8, source_ref: "paving: B4 path", rings: [ring] },
  ] });
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].class, out[0].estimated, out[0].id], ["plaza", true, "PAVEDCOURT_0001"]);
});

test("a walkable plaza no person edge crosses gets a plaza node with estimated people-only links to nearest nodes on two sides", () => {
  const g = new NetGraph();
  for (const [id, p] of [["W", [-15, 5]], ["W2", [-15, 40]], ["E", [25, 5]], ["E2", [25, 40]], ["F", [5, -8]], ["F2", [5, -12]]]) g.addNode(id, p, { kind: "sidewalk" });
  g.addNode("POI_W", [-15, 45], { kind: "poi" });
  g.addNode("POI_E", [25, 45], { kind: "poi" });
  g.addEdge({ id: "SW_W", from: "W", to: "W2", kind: "sidewalk", points: [[-15, 5], [-15, 40]] });
  g.addEdge({ id: "SW_E", from: "E", to: "E2", kind: "sidewalk", points: [[25, 5], [25, 40]] });
  g.addEdge({ id: "POI_W_E", from: "W2", to: "POI_W", kind: "building_entrance", points: [[-15, 40], [-15, 45]] });
  g.addEdge({ id: "POI_E_E", from: "E2", to: "POI_E", kind: "building_entrance", points: [[25, 40], [25, 45]] });
  g.addEdge({ id: "W_E", from: "W2", to: "E2", kind: "sidewalk", points: [[-15, 40], [25, 40]] });
  // a closer fragment outside the main component (pruned by buildNetwork), even one with a POI, is never a link target
  g.addNode("POI_F", [5, -14], { kind: "poi" });
  g.addEdge({ id: "FRAG", from: "F", to: "F2", kind: "shared_path", points: [[5, -8], [5, -12]] });
  g.addEdge({ id: "FRAG_P", from: "F2", to: "POI_F", kind: "building_entrance", points: [[5, -12], [5, -14]] });
  const plaza = { class: "plaza", id: "PAVEDCOURT_0001", source_ref: "paving: test", estimated: true, rings: [rect(0, 0, 10, 10)] };
  const crossed = { class: "plaza", id: "PAVEDCOURT_0002", source_ref: "paving: crossed", estimated: true, rings: [rect(-20, 30, -10, 35)] };
  const out = plazaLinks({ graph: g, walkable: [plaza, crossed] });
  assert.deepEqual(out.edges.map((e) => [e.from, e.to, e.kind, e.estimated]), [["PLAZA_PAVEDCOURT_0001", "W", "sidewalk", true], ["PLAZA_PAVEDCOURT_0001", "E", "sidewalk", true]]);
  assert.ok(inRings(g.nodes.get("PLAZA_PAVEDCOURT_0001").p, plaza.rings));
  assert.equal(out.stats.plazas, 1, "a plaza a person edge already crosses is left alone");
  const walled = new NetGraph();
  for (const [id, p] of [["W", [-15, 5]], ["W2", [-15, 40]]]) walled.addNode(id, p, { kind: "sidewalk" });
  walled.addNode("POI_W", [-15, 45], { kind: "poi" });
  walled.addEdge({ id: "SW_W", from: "W", to: "W2", kind: "sidewalk", points: [[-15, 5], [-15, 40]] });
  walled.addEdge({ id: "POI_W_E", from: "W2", to: "POI_W", kind: "building_entrance", points: [[-15, 40], [-15, 45]] });
  assert.equal(plazaLinks({ graph: walled, walkable: [plaza], buildings: [{ rings: [rect(-12, -50, -11, 60)] }] }).edges.length, 0, "no link through a building");
});

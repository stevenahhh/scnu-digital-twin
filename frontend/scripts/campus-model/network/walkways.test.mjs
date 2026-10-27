import assert from "node:assert/strict";
import test from "node:test";

import { NetGraph } from "./graph.mjs";
import { sampleLine } from "./geom.mjs";
import { CLS, buildWalkways, keepSurfacesOf, surfaceClassifier } from "./walkways.mjs";

const closed = (pts) => [...pts, pts[0]];
const rect = (x0, y0, x1, y1) => closed([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const quiet = () => {};
// a 600 m road (8 m wide, longer than the 150 m search window used here) along x, open ground on both sides, a painted crossing at x 28..32
const roadPolygons = [{ class: "road", rings: [rect(-300, -4, 300, 4)] }];
const crossing = { class: "crossing", id: "CW_T", rings: [rect(28, -4, 32, 4)] };

function graphWith(edges, nodes) {
  const g = new NetGraph();
  for (const [id, p, kind] of nodes) g.addNode(id, p, { kind });
  for (const e of edges) g.addEdge(e);
  return g;
}

test("an estimated edge on the road centreline is re-drawn off the carriageway and gets estimated walkway strips", () => {
  const g = graphWith(
    [{ id: "EDGE_FB", from: "A", to: "B", kind: "shared_path", estimated: true, points: [[5, 0], [55, 0]] }],
    [["A", [5, 0], "fallback"], ["B", [55, 0], "fallback"]],
  );
  const out = buildWalkways({ graph: g, walkable: [crossing], roadPolygons, warn: quiet });
  const classify = surfaceClassifier({ walkable: [crossing], roadPolygons });
  const e = g.edges[0];
  assert.equal(out.stats.movedNodes, 2);
  assert.equal(e.placed, "walkway_estimated");
  assert.ok(sampleLine(e.points, 0.2).every((q) => classify(q) !== CLS.VEHICLE), "no sample on the carriageway");
  assert.ok(out.strips.length > 0 && out.strips.every((s) => s.class === "walkway_estimated" && s.estimated));
  assert.equal(out.stats.unresolved.length, 0);
});

test("an estimated join across the road crosses at the crossing polygon", () => {
  const g = graphWith(
    [{ id: "EDGE_J", from: "N", to: "S", kind: "shared_path", estimated: true, points: [[10, 6], [10, -6]] }],
    [["N", [10, 6], "fallback"], ["S", [10, -6], "fallback"]],
  );
  const out = buildWalkways({ graph: g, walkable: [crossing], roadPolygons, warn: quiet });
  const classify = surfaceClassifier({ walkable: [crossing], roadPolygons });
  const onRoad = sampleLine(g.edges[0].points, 0.2).filter((q) => classify(q) === CLS.VEHICLE);
  assert.equal(onRoad.length, 0, "the route detours through the crossing polygon");
  assert.ok(sampleLine(g.edges[0].points, 0.2).some((q) => classify(q) === CLS.CROSSING));
  assert.equal(out.stats.unresolved.length, 0);
});

test("without a crossing polygon a needed join crosses at the shortest span, covered by an estimated crossing", () => {
  const g = graphWith(
    [{ id: "EDGE_J", from: "N", to: "S", kind: "shared_path", estimated: true, points: [[10, 6], [10, -6]] }],
    [["N", [10, 6], "poi"], ["S", [10, -6], "poi"]],
  );
  const out = buildWalkways({ graph: g, walkable: [], roadPolygons, warn: quiet });
  assert.equal(out.stats.unresolved.length, 1);
  assert.ok(g.edges[0].crosses_carriageway_m >= 8 && g.edges[0].crosses_carriageway_m <= 9.5);
  assert.equal(g.edges[0].crossing_estimated, true);
  assert.ok(out.crossings.length >= 1 && out.crossings.every((c) => c.class === "crossing_estimated" && c.estimated && /추정/.test(c.source_ref)));
  // every carriageway sample of the route lies on an estimated crossing; strips and approaches never cover the road
  const covered = surfaceClassifier({ walkable: out.crossings, roadPolygons });
  assert.ok(sampleLine(g.edges[0].points, 0.2).every((q) => covered(q) !== CLS.VEHICLE));
  const notCovered = surfaceClassifier({ walkable: [...out.strips, ...out.approaches], roadPolygons });
  assert.equal(notCovered([10, 0]), CLS.VEHICLE);
  // one straight span across the road, about 3 m wide: 1.4 m to the side of the route is inside, 1.7 m is not
  const onRoad = g.edges[0].points.filter((p) => Math.abs(p[1]) < 4);
  assert.ok(onRoad.length <= 2, `straight span, got ${JSON.stringify(g.edges[0].points)}`);
  const x = sampleLine(g.edges[0].points, 0.2).find((q) => Math.abs(q[1]) < 0.1)[0];
  assert.equal(covered([x + 1.4, 0]), CLS.CROSSING);
  assert.equal(covered([x + 1.7, 0]), CLS.VEHICLE);
});

test("a join that crosses at a crossing polygon gets no estimated crossing", () => {
  const g = graphWith(
    [{ id: "EDGE_J", from: "N", to: "S", kind: "shared_path", estimated: true, points: [[10, 6], [10, -6]] }],
    [["N", [10, 6], "fallback"], ["S", [10, -6], "fallback"]],
  );
  const out = buildWalkways({ graph: g, walkable: [crossing], roadPolygons, warn: quiet });
  assert.equal(out.crossings.length, 0);
});

test("an unneeded carriageway-crossing join is dropped (people cross only at crossings)", () => {
  const g = graphWith(
    [
      { id: "EDGE_W", from: "P", to: "Q", kind: "sidewalk", estimated: false, points: [[2, 6], [2, 20], [18, 20], [18, 6]] },
      { id: "EDGE_J", from: "P", to: "R", kind: "shared_path", estimated: true, points: [[2, 6], [2, -6]] },
      { id: "EDGE_K", from: "Q", to: "R", kind: "shared_path", estimated: true, points: [[18, 6], [18, -6]] },
    ],
    [["P", [2, 6], "poi"], ["Q", [18, 6], "poi"], ["R", [10, -6], "poi"]],
  );
  // both joins cross the road; one of them is enough to keep R connected
  const out = buildWalkways({ graph: g, walkable: [], roadPolygons, warn: quiet });
  assert.equal(out.stats.droppedCrossingEdges.length, 1);
  assert.equal(g.edges.filter((e) => e.kind === "shared_path").length, 1);
});

test("a measured crosswalk whose painted polygon is shorter than the carriageway gets an estimated extension", () => {
  const short = { class: "crossing", id: "CW_S", rings: [rect(28, -4, 32, -1)] };
  const g = graphWith(
    [{ id: "EDGE_CW", from: "A", to: "B", kind: "crosswalk", crosswalk_id: "CW_S", estimated: false, points: [[30, -4.5], [30, 4.5]] }],
    [["A", [30, -4.5], "crossing_end"], ["B", [30, 4.5], "crossing_end"]],
  );
  const out = buildWalkways({ graph: g, walkable: [short], roadPolygons, warn: quiet });
  assert.ok(out.approaches.length > 0);
  assert.ok(out.approaches.every((a) => a.class === "crossing" && a.estimated && /CW_S/.test(a.source_ref)));
  assert.deepEqual(g.edges[0].points, [[30, -4.5], [30, 4.5]], "the measured line is kept");
});

test("a route that may cross the road is never straightened along it", () => {
  // two fallback nodes on the same kerb side 40 m apart with the road between them and no free route around
  // (buildings close both ends): the route crosses where it must, never runs 40 m down the carriageway
  const blocks = [{ rings: [rect(-300, 4, 5, 30)] }, { rings: [rect(45, 4, 300, 30)] }, { rings: [rect(5, 12, 45, 30)] }];
  const g = graphWith(
    [{ id: "EDGE_R", from: "A", to: "B", kind: "shared_path", estimated: true, points: [[8, 6], [42, 6]] }],
    [["A", [8, 6], "poi"], ["B", [42, 6], "poi"]],
  );
  buildWalkways({ graph: g, walkable: [], roadPolygons, buildings: blocks, warn: quiet });
  const classify = surfaceClassifier({ walkable: [], roadPolygons, buildings: blocks });
  const onRoad = sampleLine(g.edges[0].points, 0.2).filter((q) => classify(q) === CLS.VEHICLE).length * 0.2;
  assert.ok(onRoad < 1, `carriageway metres ${onRoad}`);
});

test("an estimated edge with no route at all is replaced by the nearest walkable link from the group it alone connects", () => {
  // a pocket (x -10..10) closed to the north by a long building wall and open to the south; the derived edge P-Q runs
  // through the wall, so no route exists in the search window. The pocket (P, P2) joins the rest at S, south of it.
  const buildings = [{ rings: [rect(-400, 4, 400, 6)] }, { rings: [rect(-12, -50, -10, 4)] }, { rings: [rect(10, -50, 12, 4)] }];
  const g = graphWith(
    [
      { id: "EDGE_X", from: "P", to: "Q", kind: "shared_path", estimated: true, points: [[0, 0], [0, 12]] },
      { id: "EDGE_P", from: "P", to: "P2", kind: "shared_path", estimated: true, points: [[0, 0], [0, -30]] },
      { id: "EDGE_M1", from: "Q", to: "M", kind: "sidewalk", estimated: false, points: [[0, 12], [60, 12]] },
      { id: "EDGE_M2", from: "M", to: "S", kind: "sidewalk", estimated: false, points: [[60, 12], [60, -60], [0, -60]] },
    ],
    [["P", [0, 0], "fallback"], ["P2", [0, -30], "fallback"], ["Q", [0, 12], "fallback"], ["M", [60, 12], "fallback"], ["S", [0, -60], "fallback"]],
  );
  const out = buildWalkways({ graph: g, walkable: [], roadPolygons: [], buildings, warn: quiet });
  const classify = surfaceClassifier({ walkable: [], roadPolygons: [], buildings });
  assert.ok(!g.edges.some((e) => e.id === "EDGE_X"), "the edge through the building is gone");
  const w = g.edges.find((e) => e.id === "EDGE_X_W");
  assert.deepEqual([w.from, w.to], ["P2", "S"]);
  assert.ok(sampleLine(w.points, 0.2).every((q) => classify(q) !== CLS.BUILDING && classify(q) !== CLS.VEHICLE));
  assert.equal(out.stats.unresolved.length, 0);
  assert.deepEqual(out.stats.rejoined.map((r) => r.edge), ["EDGE_X"]);
});

test("an estimated edge with no route at all whose ends stay connected without it is dropped", () => {
  const buildings = [{ rings: [rect(-400, 4, 400, 6)] }];
  const g = graphWith(
    [
      { id: "EDGE_X", from: "P", to: "Q", kind: "shared_path", estimated: true, points: [[0, 0], [0, 12]] },
      { id: "EDGE_A", from: "P", to: "Q", kind: "sidewalk", estimated: false, points: [[0, 0], [150, 0], [150, 12], [0, 12]] },
    ],
    [["P", [0, 0], "fallback"], ["Q", [0, 12], "fallback"]],
  );
  const out = buildWalkways({ graph: g, walkable: [], roadPolygons: [], buildings, warn: quiet });
  assert.deepEqual(g.edges.map((e) => e.id), ["EDGE_A"]);
  assert.deepEqual(out.stats.rejoined, [{ edge: "EDGE_X", dropped: true }]);
});

test("estimated surfaces of an edge the network build pruned are removed; those of kept edges stay", () => {
  const w = {
    strips: [{ id: "WALKWAY_EDGE_A_0", source_ref: "EDGE_A" }, { id: "WALKWAY_EDGE_B_X_0", source_ref: "EDGE_B_X" }],
    approaches: [{ id: "CWAPPROACH_EDGE_A_0_1" }, { id: "CWAPPROACH_EDGE_B_X_2_0" }],
    crossings: [{ id: "CWEST_EDGE_B_X_0_12" }, { id: "CWEST_EDGE_A_1_3" }],
  };
  const removed = keepSurfacesOf(w, new Set(["EDGE_A"]));
  assert.deepEqual(removed, { strips: 1, approaches: 1, crossings: 1 });
  assert.deepEqual([w.strips.map((x) => x.id), w.approaches.map((x) => x.id), w.crossings.map((x) => x.id)], [["WALKWAY_EDGE_A_0"], ["CWAPPROACH_EDGE_A_0_1"], ["CWEST_EDGE_A_1_3"]]);
});

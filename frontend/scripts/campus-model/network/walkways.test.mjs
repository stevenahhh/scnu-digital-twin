import assert from "node:assert/strict";
import test from "node:test";

import { NetGraph } from "./graph.mjs";
import { sampleLine } from "./geom.mjs";
import { CLS, buildWalkways, surfaceClassifier } from "./walkways.mjs";

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

test("without a crossing polygon a needed join keeps a short carriageway stretch and is reported, never covered", () => {
  const g = graphWith(
    [{ id: "EDGE_J", from: "N", to: "S", kind: "shared_path", estimated: true, points: [[10, 6], [10, -6]] }],
    [["N", [10, 6], "poi"], ["S", [10, -6], "poi"]],
  );
  const out = buildWalkways({ graph: g, walkable: [], roadPolygons, warn: quiet });
  assert.equal(out.stats.unresolved.length, 1);
  assert.ok(g.edges[0].crosses_carriageway_m >= 8 && g.edges[0].crosses_carriageway_m <= 9.5);
  const walkable = surfaceClassifier({ walkable: [...out.strips, ...out.approaches], roadPolygons });
  // strips may touch the kerb, but no walkable polygon makes a carriageway point walkable for the oracle
  assert.ok(out.approaches.length === 0);
  assert.equal(walkable([10, 0]), CLS.VEHICLE);
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

import assert from "node:assert/strict";
import test from "node:test";

import { inRings } from "./geom.mjs";
import { photoCrossings, zebraGroups } from "./photoCrossings.mjs";

const closed = (pts) => [...pts, pts[0]];
const rect = (x0, y0, x1, y1) => closed([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
// a road along x (y -4..4); zebra bars 0.4 m wide running along y (the walking direction), every 0.9 m
const bars = (x0, n, half = 3) => Array.from({ length: n }, (_, k) => rect(x0 + k * 0.9, -half, x0 + k * 0.9 + 0.4, half));
const roadPolygons = [{ class: "road", rings: [rect(-100, -4, 100, 4)] }];

test("a painted zebra on the road becomes a measured crossing with estimated kerb approaches", () => {
  const { polygons, stats } = photoCrossings({ groups: new Map([["ZC1", bars(0, 5)]]), roadPolygons });
  assert.equal(stats.crossings, 1);
  const [core, ...approaches] = polygons;
  assert.equal(core.class, "crossing");
  assert.equal(core.estimated, false);
  assert.ok(inRings([2, 0], core.rings) && inRings([0.2, 2.9], core.rings));
  assert.ok(approaches.every((a) => a.estimated && a.class === "crossing"));
  // the approaches carry the walking direction to the kerbs (y = +-4)
  assert.ok(approaches.some((a) => inRings([2, 3.8], a.rings)) && approaches.some((a) => inRings([2, -3.8], a.rings)));
});

test("groups already covered by a CW polygon, off the road or with too few bars are skipped", () => {
  const groups = new Map([["IN_CW", bars(0, 5)], ["OFF", bars(0, 5).map((r) => r.map(([x, y]) => [x, y + 50]))], ["FEW", bars(30, 3)]]);
  const { polygons, stats } = photoCrossings({ groups, crossings: [{ ring: rect(-1, -4, 5, 4) }], roadPolygons });
  assert.equal(polygons.length, 0);
  assert.deepEqual([stats.inCw, stats.offRoad, stats.fewBars], [1, 1, 1]);
});

test("zebraGroups keeps measured zebra bars by crossing_id", () => {
  const f = (id, kind, estimated = false) => ({ properties: { kind, crossing_id: id, estimated }, geometry: { coordinates: [rect(0, 0, 1, 1)] } });
  const groups = zebraGroups({ features: [f("A", "zebra_bar"), f("A", "zebra_bar"), f("B", "stop_line"), f("C", "zebra_bar", true)] }, (p) => p);
  assert.deepEqual([...groups.keys()], ["A"]);
  assert.equal(groups.get("A").length, 2);
});

test("a painted run that stops short of the kerb is extended along its walking direction to the road edge", () => {
  const { polygons } = photoCrossings({ groups: new Map([["ZC2", bars(0, 5, 1)]]), roadPolygons });
  const approaches = polygons.filter((p) => p.estimated);
  assert.ok(approaches.some((a) => inRings([2, 3.9], a.rings)) && approaches.some((a) => inRings([2, -3.9], a.rings)));
  assert.ok(!approaches.some((a) => inRings([2, 6], a.rings)), "never beyond the road edge plus 0.5 m");
});

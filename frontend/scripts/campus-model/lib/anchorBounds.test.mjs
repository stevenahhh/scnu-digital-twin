import assert from "node:assert/strict";
import test from "node:test";
import { resolveAnchor, wallsOf } from "./anchors.mjs";

const fp = { polygons: [[[[0,0],[0,10],[20,10],[20,0]]]] };
const footprints = { BLD_TEST: { ...fp, walls: wallsOf("BLD_TEST", fp) } };
test("wall point and span offsets outside the closed wall interval are rejected", () => {
  for (const offset of [{sM:-0.01},{sM:10.01},{s0M:-0.01,s1M:2},{s0M:2,s1M:10.01}]) {
    assert.throws(() => resolveAnchor({id:"bounds",anchor:{building:"BLD_TEST",wall:"W00",...offset}},footprints), /bounds.*outside.*wall/);
  }
});
test("wall endpoints are included and a changed snapshot is rejected by the resolver", () => {
  for (const sM of [0,10]) assert.deepEqual(resolveAnchor({id:"edge",anchor:{building:"BLD_TEST",wall:"W00",sM}},footprints).origin,[0,sM]);
  const stale = structuredClone(footprints);
  stale.BLD_TEST.walls[0].bearingDeg += 3;
  assert.throws(() => resolveAnchor({id:"stale",anchor:{building:"BLD_TEST",wall:"W00",sM:3}},stale), /stale.*wall/);
});

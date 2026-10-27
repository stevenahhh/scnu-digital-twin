import assert from "node:assert/strict";
import test from "node:test";
import { clipPolygonAhead } from "./clipPolygon.mjs";

test("keeps a polygon fully ahead and drops one fully behind", () => {
  const square = [[0, 0, 1], [1, 0, 1], [1, 0, 2], [0, 0, 2]];
  assert.deepEqual(clipPolygonAhead(square, (p) => p[2]), square);
  assert.deepEqual(clipPolygonAhead(square, (p) => -p[2]), []);
});

test("cuts the part behind the plane and adds the two crossing points", () => {
  const square = [[0, 0, -1], [2, 0, -1], [2, 0, 1], [0, 0, 1]];
  const out = clipPolygonAhead(square, (p) => p[2]);
  assert.deepEqual(out, [[2, 0, 0], [2, 0, 1], [0, 0, 1], [0, 0, 0]]);
});

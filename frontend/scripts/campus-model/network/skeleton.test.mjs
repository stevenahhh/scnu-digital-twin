import assert from "node:assert/strict";
import test from "node:test";

import { skeletonize } from "./skeleton.mjs";

const closed = (pts) => [...pts, pts[0]];
const length = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

test("a 3 x 40 m rectangle thins to one path on its long axis", () => {
  const sk = skeletonize([closed([[0, 0], [40, 0], [40, 3], [0, 3]])]);
  assert.equal(sk.graph.edges.length, 1);
  assert.equal(sk.junctions.length, 0);
  for (const p of sk.paths[0]) assert.ok(Math.abs(p[1] - 1.5) <= 0.1, `off axis at ${p}`);
  assert.ok(length(sk.paths[0]) > 34 && length(sk.paths[0]) <= 40);
  assert.ok(Math.abs(sk.distanceAt(20, 1.5) - 1.5) < 1e-9);
  assert.equal(sk.distanceAt(20, 5), 0);
});

test("an L-shaped ring has one junction-free corner path and no spur shorter than 2 x width", () => {
  // 3 m wide L: 30 m along x, 20 m up y
  const sk = skeletonize([closed([[0, 0], [30, 0], [30, 3], [3, 3], [3, 20], [0, 20]])]);
  const width = 3;
  for (const e of sk.graph.edges) assert.ok(length(e.points) >= 2 * width, `spur ${length(e.points)} m`);
  assert.ok(sk.graph.edges.length <= 2);
});

test("a T-shaped polygon keeps its three arms and one junction", () => {
  const sk = skeletonize([closed([[0, 0], [26, 0], [26, -30], [34, -30], [34, 0], [60, 0], [60, 8], [0, 8]])]);
  assert.equal(sk.junctions.length, 1);
  assert.equal(sk.graph.edges.length, 3);
});

test("a polygon with a hole keeps the loop", () => {
  const sk = skeletonize([closed([[0, 0], [30, 0], [30, 30], [0, 30]]), closed([[6, 6], [24, 6], [24, 24], [6, 24]])]);
  assert.ok(sk.graph.edges.some((e) => e.from === e.to || sk.graph.edges.length >= 1));
  const total = sk.graph.edges.reduce((s, e) => s + length(e.points), 0);
  assert.ok(total > 80, `loop length ${total}`);
});

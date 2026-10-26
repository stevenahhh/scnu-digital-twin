import assert from "node:assert/strict";
import test from "node:test";

import { offsetLine } from "./solids.mjs";

const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;

test("offsetLine offsets a closed ring as a ring: the seam corner is mitred and first and last points coincide", () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const inner = offsetLine(ring, 1); // left of travel = inside for this ring
  assert.equal(inner.length, ring.length);
  assert.ok(near(inner[0], inner.at(-1)), `seam ${inner[0]} vs ${inner.at(-1)}`);
  for (const [p, q] of [[inner[0], [1, 1]], [inner[1], [9, 1]], [inner[2], [9, 9]], [inner[3], [1, 9]]]) assert.ok(near(p, q), `${p} vs ${q}`);
  // the seam may start mid-edge too (a planter ring started on a straight side)
  const mid = offsetLine([[5, 0], [10, 0], [10, 10], [0, 10], [0, 0], [5, 0]], 1);
  assert.ok(near(mid[0], [5, 1]) && near(mid.at(-1), [5, 1]));
});

test("offsetLine keeps open polylines as before: each end takes the normal of its own segment", () => {
  const out = offsetLine([[0, 0], [10, 0], [10, 10]], 1);
  assert.ok(near(out[0], [0, 1]) && near(out[1], [9, 1]) && near(out[2], [9, 10]));
  // an open line that returns near (not onto) its start is not treated as closed
  const open = offsetLine([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0.5]], 1);
  assert.ok(near(open[0], [0, 1]));
});

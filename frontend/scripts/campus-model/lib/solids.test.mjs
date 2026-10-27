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

test("rounded(): a clipped mass stays inside its ring, reaches its top, and every face points out or up", async () => {
  const { Kit } = await import("./solids.mjs");
  const { metres } = await import("./frame.mjs");
  const kit = new Kit();
  const ring = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2) * metres(2), Math.sin((i / 16) * Math.PI * 2) * metres(1.5)]);
  kit.rounded(ring, 0, metres(1.2), 0.9, [255, 255, 255, 255]);
  const { positions, normals, indices } = kit.mesh;
  let top = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    top = Math.max(top, positions[i + 1]);
    assert.ok((positions[i] / metres(2)) ** 2 + (positions[i + 2] / metres(1.5)) ** 2 <= 1 + 1e-6, "inside the ring");
  }
  assert.ok(Math.abs(top - metres(1.2)) < 1e-6, `top ${top}`);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((k) => [positions[3 * k], positions[3 * k + 1], positions[3 * k + 2]]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const centre = [(a[0] + b[0] + c[0]) / 3, 0, (a[2] + b[2] + c[2]) / 3];
    assert.ok(g[0] * centre[0] + g[1] * 1 + g[2] * centre[2] > -1e-9, `face ${t / 3} points in`);
  }
  assert.equal(normals.length, positions.length);
});

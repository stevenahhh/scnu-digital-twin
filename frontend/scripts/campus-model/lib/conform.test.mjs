import assert from "node:assert/strict";
import test from "node:test";

import { topographySurface } from "../stages/ground.mjs";
import { conform } from "./conform.mjs";
import { EXTENT } from "./frame.mjs";
import { ringArea } from "./geometry.mjs";

const area = (tris) => tris.reduce((sum, t) => sum + Math.abs(ringArea(t)), 0);
const flat = topographySurface(() => 10);
// Grid nodes alternate between 10 and 11 units: every terrain triangle is tilted differently.
const bumpy = topographySurface((x, z) => 10 + (Math.round((x - EXTENT.minX) / 2 + (z - EXTENT.minZ) / 2) % 2));

test("a triangle on flat terrain stays one triangle", () => {
  const tri = [[10, -100], [30, -100], [10, -80]];
  assert.deepEqual(conform(tri, flat), [tri]);
});

test("a triangle inside one terrain triangle stays one triangle", () => {
  const tri = [[10.1, -99.9], [10.6, -99.9], [10.1, -99.4]];
  assert.deepEqual(conform(tri, bumpy), [tri]);
});

test("a triangle over tilted terrain is split along the grid with its area kept, each piece inside one grid cell", () => {
  const tri = [[10.3, -100.2], [17.1, -99.7], [11.2, -93.4]];
  const pieces = conform(tri, bumpy);
  assert.ok(pieces.length > 3, `expected a split, got ${pieces.length}`);
  assert.ok(Math.abs(area(pieces) - Math.abs(ringArea(tri))) < 1e-9, "area preserved");
  const { step, x0, z0 } = bumpy.grid;
  for (const piece of pieces) {
    const cx = (piece[0][0] + piece[1][0] + piece[2][0]) / 3;
    const cz = (piece[0][1] + piece[1][1] + piece[2][1]) / 3;
    const i = Math.floor((cx - x0) / step);
    const j = Math.floor((cz - z0) / step);
    for (const [x, z] of piece) {
      assert.ok(x >= x0 + i * step - 1e-9 && x <= x0 + (i + 1) * step + 1e-9, "piece crosses a vertical grid line");
      assert.ok(z >= z0 + j * step - 1e-9 && z <= z0 + (j + 1) * step + 1e-9, "piece crosses a horizontal grid line");
    }
  }
});

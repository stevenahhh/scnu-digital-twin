import assert from "node:assert/strict";
import test from "node:test";
import { crossesPerimeterSeam } from "./lod4Facades.mjs";

test("a 48.6 metre E3 wall inside a 250 metre perimeter is not discarded as a seam", () => {
  assert.equal(crossesPerimeterSeam([120, 168.6, 168.6], 250), false);
});

test("triangles crossing the ring origin are rejected independently of building size", () => {
  assert.equal(crossesPerimeterSeam([248, 1, 2], 250), true);
  assert.equal(crossesPerimeterSeam([28, 1, 2], 30), true);
  assert.equal(crossesPerimeterSeam([8, 18, 18], 30), false);
});

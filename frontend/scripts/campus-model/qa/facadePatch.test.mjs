import assert from "node:assert/strict";
import test from "node:test";
import { connectedTrianglePatch } from "./facadeMesh.mjs";

test("a doorway split by exposure keeps both edge-connected pieces", () => {
  const faces = [
    { keys: ["left-bottom", "split-bottom", "split-top"] },
    { keys: ["left-bottom", "split-top", "left-top"] },
    { keys: ["split-bottom", "right-bottom", "right-top"] },
    { keys: ["split-bottom", "right-top", "split-top"] },
  ];
  assert.deepEqual([...connectedTrianglePatch(faces, [2])].sort(), [0, 1, 2, 3]);
});

test("a gap, a single touching corner, or a different texture seam cannot extend a door patch", () => {
  const faces = [
    { keys: ["a", "b", "c"] },
    { keys: ["c", "d", "e"] },
    { keys: ["a-other-uv", "b-other-uv", "f"] },
    { keys: ["g", "h", "i"] },
  ];
  assert.deepEqual([...connectedTrianglePatch(faces, [0])], [0]);
});

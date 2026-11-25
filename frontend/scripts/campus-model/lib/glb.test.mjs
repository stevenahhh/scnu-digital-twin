import assert from "node:assert/strict";
import test from "node:test";

import { GlbBuilder } from "./glb.mjs";

test("groupRoots uses a node given as collectionNode as that collection, keeping its name and extras", () => {
  const glb = new GlbBuilder();
  const data = glb.addNode({ name: "Furniture", extras: { poles: [] } }, { collectionNode: "Furniture" });
  const bench = glb.addNode({ name: "B1" }, { root: true, collection: "Furniture/bench" });
  const groups = glb.groupRoots([]);
  assert.equal(groups.get("Furniture"), data);
  assert.deepEqual(glb.json.scenes[0].nodes, [data]);
  assert.deepEqual(glb.json.nodes[data].extras, { poles: [], collection: true });
  assert.deepEqual(glb.json.nodes[groups.get("Furniture/bench")].children, [bench]);
});

test("groupRoots refuses a collectionNode that received no children (prune would drop the empty leaf)", () => {
  const glb = new GlbBuilder();
  glb.addNode({ name: "Furniture", extras: { poles: [] } }, { collectionNode: "Furniture" });
  glb.addNode({ name: "Kerbs" }, { root: true });
  assert.throws(() => glb.groupRoots([{ path: "Ground", match: () => true }]), /Furniture received no children/);
});

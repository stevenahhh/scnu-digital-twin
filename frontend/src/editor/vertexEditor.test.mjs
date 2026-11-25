import assert from "node:assert/strict";
import test from "node:test";
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { applyVertexMoves, createVertexState } from "./vertexEditor.mjs";

// two flat quads sharing the edge x = 1, as two meshes of one object (like a fence panel and its post)
function quad(x0, x1) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([x0, 0, 0, x1, 0, 0, x1, 1, 0, x0, 1, 0]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return new Mesh(geometry, new MeshStandardMaterial());
}
function object() {
  const node = new Group();
  const left = quad(0, 1);
  const right = quad(1, 2);
  right.position.set(0, 0, 0);
  node.add(left, right);
  node.position.set(10, 0, 0);
  node.updateMatrixWorld(true);
  return { node, left, right };
}
const at = (mesh, i) => [mesh.geometry.attributes.position.getX(i), mesh.geometry.attributes.position.getY(i), mesh.geometry.attributes.position.getZ(i)];

test("vertices at the same place across the object's meshes form one handle", () => {
  const { node } = object();
  const state = createVertexState(node);
  assert.equal(state.groups.length, 6);
  const shared = state.groups.find((g) => g.position[0] === 1 && g.position[1] === 1);
  assert.equal(shared.members.length, 2);
  assert.deepEqual(state.keyOf(shared), { path: "0", index: 2 });
});

test("moving a handle moves every coincident vertex, and an empty list restores the original shape", () => {
  const { node, left, right } = object();
  const original = left.geometry;
  const state = createVertexState(node);
  assert.equal(applyVertexMoves(state, [{ path: "0", index: 2, offset: [0, 0.5, 0] }]), true);
  assert.deepEqual(at(left, 2), [1, 1.5, 0]);
  assert.deepEqual(at(right, 3), [1, 1.5, 0]);
  assert.deepEqual(at(left, 3), [0, 1, 0]);
  assert.notEqual(left.geometry, original, "a moved mesh gets its own geometry; copies of the object keep theirs");
  assert.deepEqual(original.attributes.position.array.slice(6, 9), new Float32Array([1, 1, 0]));
  assert.deepEqual(state.groups.find((g) => g.members.length === 2 && g.position[1] === 1).current, [1, 1.5, 0]);
  applyVertexMoves(state, []);
  assert.deepEqual(at(left, 2), [1, 1, 0]);
  assert.deepEqual(at(right, 3), [1, 1, 0]);
});

test("moves naming a vertex the object does not have are skipped", () => {
  const { node, left } = object();
  const state = createVertexState(node);
  applyVertexMoves(state, [{ path: "7", index: 0, offset: [1, 1, 1] }, { path: "0", index: 99, offset: [1, 1, 1] }]);
  assert.deepEqual(at(left, 0), [0, 0, 0]);
});

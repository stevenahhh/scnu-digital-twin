import assert from 'node:assert/strict';
import test from 'node:test';

import { MeshData } from './meshData.mjs';

const assertNormal = (mesh, vertex, expected) => {
  const n = mesh.normals.slice(vertex * 3, vertex * 3 + 3);
  assert.ok(n.every((x, i) => Math.abs(x - expected[i]) < 1e-12), `vertex ${vertex}: ${n}`);
};

// A wall stretch whose top meets its base at one end (p3 === p0) is a visible triangle. A zero normal there makes
// the shader's normalize() return NaN, and Bloom's mip chain spreads those pixels into large black blocks.
test('quad with a collapsed p0-p3 edge still gets a unit face normal', () => {
  const mesh = new MeshData();
  mesh.quad([0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 0, 0]);
  for (let v = 0; v < 4; v += 1) assertNormal(mesh, v, [0, 0, 1]);
});

test('quad normal of a regular quad is unchanged', () => {
  const mesh = new MeshData();
  mesh.quad([0, 0, 0], [0, 0, -2], [0, 1, -2], [0, 1, 0]);
  assertNormal(mesh, 0, [1, 0, 0]);
});

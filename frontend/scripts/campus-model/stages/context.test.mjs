// Context masses: use classes, one material, one primitive per tile, no BLD_ ids, walls facing out, flat roof on top.
import assert from "node:assert/strict";
import test from "node:test";

import { metres } from "../lib/frame.mjs";
import { buildContext, useClass } from "./context.mjs";

function fakeGlb() {
  const nodes = [];
  const meshes = [];
  const materials = [];
  return {
    nodes, meshes, materials,
    addTexture: () => 0,
    addMaterial: (m) => materials.push(m) - 1,
    addMesh: (name, primitives) => meshes.push({ name, primitives }) - 1,
    addNode: (n) => nodes.push(n),
  };
}
const square = (x, z, s) => [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];

test("use classes from the GIS usability", () => {
  assert.equal(useClass("단독주택", 1), "residential");
  assert.equal(useClass("공동주택", 15), "residential");
  assert.equal(useClass("제2종근린생활시설", 3), "commercial");
  assert.equal(useClass("창고시설", 1), "other");
  assert.equal(useClass(null, 1), "residential");
});

test("masses merge per tile under one material, extruded to ground + height, never BLD_", () => {
  const glb = fakeGlb();
  const ground = 10;
  const parts = [
    { outer: square(10, -100, 6), holes: [], use: "단독주택", floors: 2, heightMetres: 6, index: 1 },
    { outer: square(30, -100, 8), holes: [], use: "제1종근린생활시설", floors: 3, heightMetres: 10, index: 2 },
    { outer: square(400, -300, 8), holes: [], use: null, floors: null, heightMetres: 3, index: 3 },
  ];
  const stats = buildContext({ glb, parts, groundAt: () => ground });
  assert.equal(glb.materials.length, 1);
  assert.equal(stats.tiles, glb.nodes.length);
  assert.equal(stats.tiles, 2, "two tiles: the first two masses share one");
  for (const n of glb.nodes) {
    assert.match(n.name, /^Context_Buildings_m?\d+_m?\d+$/);
    assert.equal(n.extras.selectable, false);
  }
  for (const { primitives } of glb.meshes) assert.equal(primitives.length, 1);
  const p = glb.meshes[0].primitives[0];
  const ys = [];
  for (let i = 1; i < p.positions.length; i += 3) ys.push(p.positions[i]);
  assert.ok(Math.abs(Math.max(...ys) - (ground + metres(10))) < 1e-4, "roof at ground + the taller height");
  assert.ok(Math.min(...ys) < ground, "base sunk below the ground");
  // every wall normal points away from its footprint's centre
  for (let v = 0; v < p.positions.length / 3; v += 1) {
    const [nx, ny, nz] = [p.normals[v * 3], p.normals[v * 3 + 1], p.normals[v * 3 + 2]];
    if (Math.abs(ny) > 0.5) continue;
    const [x, z] = [p.positions[v * 3], p.positions[v * 3 + 2]];
    const c = x < 25 ? [13, -97] : [34, -96];
    assert.ok(nx * (x - c[0]) + nz * (z - c[1]) > 0, `wall normal at ${x}, ${z} faces out`);
  }
});

test("meshHeightAt interpolates a triangle and is null off the mesh", async () => {
  const { meshHeightAt } = await import("./context.mjs");
  const at = meshHeightAt([0, 0, 0, 10, 10, 0, 0, 20, 10], [0, 1, 2]);
  assert.ok(Math.abs(at(5, 2) - 9) < 1e-9, "plane y = x + 2 z");
  assert.equal(at(50, 50), null);
});

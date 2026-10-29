import assert from "node:assert/strict";
import test from "node:test";

import { ringArea } from "./geometry.mjs";
import { GroundPartition, convexOverlapArea, subtractConvex } from "./partition.mjs";

const area = (polys) => polys.reduce((sum, p) => sum + Math.abs(ringArea(p)), 0);
const square = (x, z, s) => [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];

test("convex difference keeps exactly the uncovered area, whatever the cut's winding", () => {
  const base = square(0, 0, 4);
  for (const cut of [square(1, 1, 2), [...square(1, 1, 2)].reverse()]) {
    const parts = subtractConvex(base, cut);
    assert.ok(Math.abs(area(parts) - 12) < 1e-9);
    for (const part of parts) assert.ok(convexOverlapArea(part, cut) < 1e-9);
  }
  assert.deepEqual(subtractConvex(square(0, 0, 1), square(-1, -1, 3)), []);
  assert.ok(Math.abs(area(subtractConvex(square(0, 0, 1), square(5, 5, 1))) - 1) < 1e-12);
});

test("claims never overlap and together cover each piece's union", () => {
  const partition = new GroundPartition({ step: 8, x0: 0, z0: 0 });
  const claimed = [
    ...partition.claim(square(1, 1, 2)), // top class first
    ...partition.claim(square(0, 0, 3)),
    ...partition.claim([[0, 0], [4, 0], [0, 4]]), // a triangle under both
    ...partition.claim(square(0, 0, 4)), // the natural ground under everything
  ];
  assert.ok(Math.abs(area(claimed) - 16) < 1e-9, `claimed area ${area(claimed)}`);
  for (let i = 0; i < claimed.length; i += 1) {
    for (let j = i + 1; j < claimed.length; j += 1) assert.ok(convexOverlapArea(claimed[i], claimed[j]) < 1e-9, `pieces ${i} and ${j} overlap`);
  }
});

test("a piece spanning several terrain triangles is split along the grid and still never overlaps", () => {
  const partition = new GroundPartition({ step: 2, x0: 0, z0: 0 });
  const road = partition.claim(square(0.5, 0.5, 5));
  assert.ok(Math.abs(area(road) - 25) < 1e-9);
  const ground = [];
  for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) {
    const [x, z, x1, z1] = [i * 2, j * 2, i * 2 + 2, j * 2 + 2];
    ground.push(...partition.claim([[x, z], [x, z1], [x1, z]]), ...partition.claim([[x1, z], [x, z1], [x1, z1]]));
  }
  assert.ok(Math.abs(area(ground) - (64 - 25)) < 1e-9, `natural area ${area(ground)}`);
  for (const g of ground) for (const r of road) assert.ok(convexOverlapArea(g, r) < 1e-9);
});

test("a piece with a repeated vertex is still cut by the claim it overlaps (no false separation)", () => {
  // build 6, cell 56,1,1: the remainder of a terrain triangle came out as a quad with a repeated corner
  const partition = new GroundPartition({ step: 2, x0: -2, z0: -376 });
  const lot = [[112, -373.5670733635091], [111.35021721405028, -373.35021721405025], [112, -374]];
  partition.claim([[112, -373.5670733635091], [111.42814337409519, -373.238736466517], [111.35021721405028, -373.35021721405025]]);
  partition.claim(lot);
  const natural = partition.claim([[112, -374], [110, -372], [112, -372]]);
  for (const piece of natural) assert.ok(convexOverlapArea(piece, lot) < 1e-9, `natural ground overlaps the lot: ${JSON.stringify(piece)}`);
  assert.ok(Math.abs(area(natural) + Math.abs(ringArea(lot)) + 0.0447 - 2) < 1e-3);
});

test("a claim with a repeated closing vertex still removes its whole area from later pieces", () => {
  // build 8, cell 62,5,1: a lot quad came out as [p, a, b, p]
  const partition = new GroundPartition({ step: 2, x0: -2, z0: -376 });
  const p = [123.59653020587174, -365.5965302058718];
  const lot = [p, [124, -364.3531383856291], [123.6937665446468, -364], [...p]];
  partition.claim(lot);
  const natural = partition.claim([[124, -366], [122, -364], [124, -364]]);
  for (const piece of natural) assert.ok(convexOverlapArea(piece, lot.slice(0, 3)) < 1e-9, `natural ground overlaps the lot: ${JSON.stringify(piece)}`);
});

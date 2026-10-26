// Checks for the curated mass fields of building-forms.json (stages/buildings.mjs): round cylinders and per-mass looks.
import assert from "node:assert/strict";
import test from "node:test";
import { metres } from "../lib/frame.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { lookOf, roundBaysOf, roundOf, smoothRound } from "./buildings.mjs";

const toModel = ([x, z]) => [x, z];

test("round: a cylinder of `segments` sides at radiusMetres, the outline replaced", () => {
  const { outer, round } = roundOf({ outer: [[0, 0], [1, 0], [1, 1]], round: { centre: [10, 20], radiusMetres: 3.9, segments: 24, slots: [60] } }, toModel, "T");
  assert.equal(outer.length, 24);
  for (const [x, z] of outer) assert.ok(Math.abs(Math.hypot(x - 10, z - 20) - metres(3.9)) < 1e-9);
  assert.deepEqual(round.slots, [60]);
  assert.equal(roundOf({ outer: [[0, 0], [1, 0], [1, 1]] }, toModel, "T").round, null);
  assert.throws(() => roundOf({ outer: [], round: { centre: [0, 0], radiusMetres: 2, segments: 5 } }, toModel, "T"), /segments >= 8/);
});

test("round: the glass slot bay sits only on the segment facing the slot bearing", () => {
  const { outer, round } = roundOf({ outer: [], round: { centre: [0, 0], radiusMetres: 4, segments: 24, slots: [90] } }, toModel, "T");
  const bays = roundBaysOf(round, outer);
  assert.equal(bays.filter((b) => b === 0).length, 1);
  const i = bays.indexOf(0);
  const [a, b] = [outer[i], outer[(i + 1) % outer.length]];
  assert.ok((a[0] + b[0]) / 2 > 0 && Math.abs((a[1] + b[1]) / 2) < metres(0.6), "the slot faces east (+x)");
  assert.ok(bays.every((v) => [0, 1, 2].includes(v)));
});

test("round: walls get radial normals, roofs keep theirs; a mass look must exist", () => {
  const mesh = new MeshData();
  mesh.quad([1, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 0]);
  mesh.vertex([0, 1, 0], [0, 1, 0]);
  smoothRound(mesh, 0, [0, 0]);
  const n = (v) => mesh.normals.slice(v * 3, v * 3 + 3);
  assert.ok(Math.abs(n(0)[0] - 1) < 1e-9 && Math.abs(n(1)[2] - 1) < 1e-9, "radial on the wall");
  assert.deepEqual(n(4), [0, 1, 0]);
  assert.equal(lookOf({}, { looks: new Set() }, "T"), null);
  assert.throws(() => lookOf({ look: "nope" }, { looks: new Set(["F1"]) }, "T"), /not a look/);
});

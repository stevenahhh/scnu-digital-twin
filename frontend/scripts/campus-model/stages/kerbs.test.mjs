import assert from "node:assert/strict";
import test from "node:test";

import { sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";
import { segmentDistance } from "../lib/geometry.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";
import { kerbSolids, planKerbs } from "./kerbs.mjs";

const U = SCENE_UNITS_PER_METRE;
const TERRAIN = 12;
const terrainAt = () => TERRAIN;
const tm = (ring) => ring.map(([x, z]) => sceneToTm(x, z));
// Walkway: 20 x 10 scene units (about 32 x 16 m); everything outside is road unless the fixture says otherwise.
const RING = [[100, -200], [120, -200], [120, -190], [100, -190]];
const walkways = [[tm(RING)]];
const outlines = [{ ufid: "A003-T", closed: true, line: tm([...RING, RING[0]]) }];
// Crossing on the road just north (z < -200) of the walkway's z = -200 edge, x 108-112.
const crossing = { id: "CW_T01", ring: tm([[108, -206], [112, -206], [112, -200.3], [108, -200.3]]) };
const roadLabels = () => SURFACE_CLASS.ASPHALT;
const quiet = () => {};

test("a kerb ring on flat terrain: top 0.15 m above the terrain, outer face on the ring line", () => {
  const plan = planKerbs({ walkways, outlines, crossings: [], labelAt: roadLabels, terrainAt, warn: quiet });
  assert.equal(plan.pieces.length, plan.lines[0].pieces.length, "every piece of the ring is a kerb");
  const { kit, maxHeight } = kerbSolids(plan, terrainAt);
  assert.ok(Math.abs(maxHeight - 0.15) < 1e-12);
  const positions = kit.mesh.positions;
  let onLine = 0;
  for (let v = 0; v < positions.length; v += 3) {
    const p = [positions[v], positions[v + 2]];
    const d = Math.min(...RING.map((a, i) => segmentDistance(p, a, RING[(i + 1) % RING.length]))) / U;
    assert.ok(d < 0.001 || Math.abs(d - 0.2) < 0.001, `vertex ${d} m off the ring (neither the outer face nor the 0.20 m inner edge)`);
    if (d < 0.001) onLine += 1;
    const y = positions[v + 1];
    assert.ok(Math.abs(y - (TERRAIN + 0.15 * U)) < 1e-9 || Math.abs(y - (TERRAIN - 0.1 * U)) < 1e-9, `kerb y ${y}`);
  }
  assert.ok(onLine > 0);
  // the kerb lies inside the walkway ring (inward normals)
  for (const piece of plan.pieces) {
    const mid = [(piece.p[0] + piece.q[0]) / 2 + piece.inward[0], (piece.p[1] + piece.q[1]) / 2 + piece.inward[1]];
    assert.ok(mid[0] > 100 && mid[0] < 120 && mid[1] > -200 && mid[1] < -190);
  }
});

test("a crossing touching one side drops the kerb to 0 there and the slab ramps at 1/12", () => {
  const plan = planKerbs({ walkways, outlines, crossings: [crossing], labelAt: roadLabels, terrainAt, warn: quiet });
  assert.deepEqual(plan.touched, ["CW_T01"]);
  for (const piece of plan.pieces) {
    const mid = [(piece.p[0] + piece.q[0]) / 2, (piece.p[1] + piece.q[1]) / 2];
    if (Math.abs(mid[1] + 200) < 1e-6 && mid[0] > 108 && mid[0] < 112) assert.equal(plan.kerbHeight(mid), 0, `kerb at x ${mid[0]}`);
  }
  assert.ok(Math.abs(plan.kerbHeight([118, -200]) - 0.15) < 1e-12, "away from the crossing the kerb is full height");
  assert.ok(Math.abs(plan.slabHeight(110, -200 + 0.9 * U) - 0.075) < 1e-9, "0.9 m from the dropped kerb");
  assert.ok(Math.abs(plan.slabHeight(110, -200 + 1.8 * U) - 0.15) < 1e-9, "1.8 m from the dropped kerb");
});

test("groundHeightAt is terrain + 0.15 m inside the ring and terrain outside", () => {
  const plan = planKerbs({ walkways, outlines, crossings: [crossing], labelAt: roadLabels, terrainAt, warn: quiet });
  assert.ok(Math.abs(plan.groundHeightAt(115, -195) - (TERRAIN + 0.15 * U)) < 1e-9);
  assert.equal(plan.groundHeightAt(90, -195), TERRAIN);
});

test("no kerb on a ring edge next to a building apron (paved both sides); the slab feathers there", () => {
  const labelAt = ([x]) => (x > 120 ? SURFACE_CLASS.PAVING : SURFACE_CLASS.ASPHALT);
  const plan = planKerbs({ walkways, outlines, crossings: [], labelAt, terrainAt, warn: quiet });
  const east = plan.lines[0].pieces.filter((piece) => Math.abs(piece.p[0] - 120) < 1e-6 && Math.abs(piece.q[0] - 120) < 1e-6);
  assert.ok(east.length > 0);
  for (const piece of east) {
    assert.equal(piece.inward, null);
    assert.equal(piece.reason, "paved both sides");
  }
  assert.ok(Math.abs(plan.slabHeight(120 - 0.01, -195) - plan.exposedM * (0.01 / U / 0.5)) < 1e-9, "feathered next to the apron");
  assert.ok(Math.abs(plan.slabHeight(115, -195) - 0.15) < 1e-12);
});

test("an exposed height above the 0.25 m legal cap throws; a crossing far from any kerb is logged and skipped", () => {
  assert.throws(() => planKerbs({ walkways, outlines, crossings: [], labelAt: roadLabels, terrainAt, exposedM: 0.3, warn: quiet }), /legal cap 0\.25/);
  const warnings = [];
  const far = { id: "CW_T99", ring: tm([[60, -230], [64, -230], [64, -226], [60, -226]]) };
  const plan = planKerbs({ walkways, outlines, crossings: [far], labelAt: roadLabels, terrainAt, warn: (m) => warnings.push(m) });
  assert.deepEqual(warnings, ["crossing CW_T99 touches no kerb (estimated connector)"]);
  assert.deepEqual(plan.dropped, []);
});

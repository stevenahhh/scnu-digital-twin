// Geometry checks for the main-gate builders of stages/furniture.mjs on flat ground: the parking-gate canopy over the
// lane between two traffic islands (gate_canopy).
import assert from "node:assert/strict";
import test from "node:test";
import { metres } from "../lib/frame.mjs";
import { rgb } from "../lib/solids.mjs";
import { B, GATE_CANOPY, makeContext, postOnIsland, vaultArc } from "./furniture.mjs";

const M = metres;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
function vertices(mesh, hex = null) {
  const want = hex ? rgb(hex) : null;
  const out = [];
  for (let k = 0; k < mesh.vertexCount; k += 1) {
    if (want && [0, 1, 2].some((j) => mesh.colors[4 * k + j] !== want[j])) continue;
    out.push([mesh.positions[3 * k] / M(1), mesh.positions[3 * k + 1] / M(1), mesh.positions[3 * k + 2] / M(1)]);
  }
  return out;
}

test("vaultArc: a circular arc from one spring line over the crown to the other", () => {
  const points = vaultArc(1.5, 4.3, 5.0, 8);
  assert.equal(points.length, 9);
  near(points[0][0], -1.5, 1e-9, "first spring t");
  near(points[0][1], 4.3, 1e-9, "first spring h");
  near(points[8][0], 1.5, 1e-9, "last spring t");
  near(points[4][0], 0, 1e-9, "crown t");
  near(points[4][1], 5.0, 1e-9, "crown h");
  // every point lies on one circle whose centre is on t = 0
  const radius = (5.0 - 4.3) / 2 + (1.5 * 1.5) / (2 * (5.0 - 4.3));
  for (const [t, h] of points) near(Math.hypot(t, h - (5.0 - radius)), radius, 1e-9, "on the circle");
  for (let i = 1; i <= 4; i += 1) assert.ok(points[i][1] > points[i - 1][1], "rising to the crown");
});

test("postOnIsland: a post goes onto the island, inset from its kerb", () => {
  const axis = [[0, 0], [10, 0]];
  const [x1, z1] = postOnIsland([5, 2], axis, 0.8, 0.3);
  near(x1, 5, 1e-9, "beside the middle: x");
  near(z1, 0.5, 1e-9, "beside the middle: inset from the kerb");
  const [x2, z2] = postOnIsland([5, 0.2], axis, 0.8, 0.3);
  near(x2, 5, 1e-9, "already inside: x");
  near(z2, 0.2, 1e-9, "already inside: kept");
  const [x3, z3] = postOnIsland([12, 0], axis, 0.8, 0.3);
  near(x3, 10.5, 1e-9, "past the end: onto the rounded end");
  near(z3, 0, 1e-9, "past the end: on the axis line");
});

test("gate_canopy: posts stand on the named islands, the vault springs at eave_m and peaks at heightM", () => {
  // two islands 4.7 m apart (axes along x), the canopy outline over the lane between them
  const island = (id, z) => ({ id, kind: "traffic_island", line: [[0, M(z)], [M(10), M(z)]], p: { width_m: 1.6 } });
  const islands = [island("I1", 0), island("I2", 4.7)];
  const ctx = makeContext({ groundAt: () => 0, objects: islands, roads: { arterials: [], connectors: [], zoneRings: [] }, sites: null, fieldCentre: null });
  const footprint = [[M(1), M(0.85)], [M(9), M(0.85)], [M(9), M(3.85)], [M(1), M(3.85)]];
  B.gate_canopy(ctx, { id: "T1", kind: "gate_canopy", heightM: 5.0, footprint, p: { post_islands: ["I1", "I2"], eave_m: 4.3, colour: "#3f72b0", postColour: "#d9d7d0" } });
  const posts = vertices(ctx.solid.mesh, "#d9d7d0").filter(([, y]) => y < 0.5);
  assert.ok(posts.length >= 4 * 8, "the foot of every post");
  for (const [x, , z] of posts) {
    const onIsland = Math.min(Math.abs(z), Math.abs(z - 4.7)) <= 0.8 - 0.2 && x >= 0 && x <= 10;
    assert.ok(onIsland, `post foot on an island: ${x.toFixed(2)}, ${z.toFixed(2)}`);
  }
  const roof = vertices(ctx.solid.mesh, "#3f72b0");
  assert.ok(roof.length > 0, "a blue vault");
  assert.ok(Math.min(...roof.map((v) => v[1])) >= 4.3 - 1e-6, "the vault springs at the eave");
  near(Math.max(...vertices(ctx.solid.mesh).map((v) => v[1])), 5.0 + GATE_CANOPY.ribM, 0.005, "crown rib");
  assert.throws(() => B.gate_canopy(ctx, { id: "T2", kind: "gate_canopy", heightM: 5.0, footprint, p: { post_islands: ["I9"] } }), /gate_canopy T2: post island I9 is not a traffic_island/);
});

test("gate_canopy: bays side by side across a vault axis, posts on the islands under their post lines", () => {
  // lanes along x; islands at z 0 and 4.4 m, the kerb at z 7.4 m; two bays from z -0.4 to 7.6 m, 5 m along x
  const island = (id, z) => ({ id, kind: "traffic_island", line: [[0, M(z)], [M(10), M(z)]], p: { width_m: 1.6 } });
  const ctx = makeContext({ groundAt: () => 0, objects: [island("I1", 0), island("I2", 4.4)], roads: { arterials: [], connectors: [], zoneRings: [] }, sites: null, fieldCentre: null });
  const footprint = [[M(2.5), M(-0.4)], [M(7.5), M(-0.4)], [M(7.5), M(7.6)], [M(2.5), M(7.6)]];
  B.gate_canopy(ctx, { id: "T1", kind: "gate_canopy", heightM: 7.5, footprint, p: { post_islands: ["I1", "I2"], eave_m: 6.8, bays: 2, vault_axis_deg: 90, colour: "#3f72b0", postColour: "#d9d7d0" } });
  const feet = vertices(ctx.solid.mesh, "#d9d7d0").filter(([, y]) => y < 0.5);
  const lines = [...new Set(feet.map(([, , z]) => Math.round(z * 2) / 2))].sort((a, b) => a - b);
  // the first line already lies on I1 (0.4 m from its axis), the middle one moves onto I2, the far one has no island
  // within reach and stays at the outline's edge
  assert.deepEqual(lines, [-0.5, 4.0, 7.5], `post lines on I1, on I2, and at the far edge: ${lines}`);
  const roof = vertices(ctx.solid.mesh, "#3f72b0");
  // two vaults: the roof dips back to the spring line between them, over the middle post line
  const between = roof.filter(([, , z]) => Math.abs(z - 3.6) < 0.05);
  assert.ok(between.length > 0 && Math.max(...between.map((v) => v[1])) <= 6.8 + 1e-6, "the bays meet at the spring line");
  assert.ok(Math.max(...roof.map((v) => v[1])) <= 7.5 + 1e-6 && Math.max(...roof.map((v) => v[1])) >= 7.5 - 1e-6, "each crown at heightM");
  // the vault axis runs along x (bearing 90): ribs stand across it, so every rib vertex keeps one x
  const ribXs = new Set(vertices(ctx.solid.mesh, "#d9d7d0").filter(([, y]) => y > 6.85).map(([x]) => Math.round(x * 10)));
  assert.ok(ribXs.size <= 12, `ribs across the axis: ${ribXs.size} distinct x`);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildGroundGrid, clampOrbitAboveGround, sampleGroundGrid } from "./terrainClearance.mjs";

const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

// Indexed grid mesh of y = heightAt(x, z) over [x0, x1] x [z0, z1], split like the Topography stage.
function meshOf(heightAt, { x0 = -400, x1 = 400, z0 = -400, z1 = 400, step = 10 } = {}) {
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((z1 - z0) / step) + 1;
  const positions = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      positions.set([x, heightAt(x, z), z], (j * nx + i) * 3);
    }
  }
  const index = [];
  for (let j = 0; j + 1 < nz; j += 1) {
    for (let i = 0; i + 1 < nx; i += 1) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  return { positions, index: Uint32Array.from(index) };
}

// A bowl: flat campus floor at y 20 inside r 150, then a hill rising 0.5 m per m outwards, like OuterTerrain.
const bowl = (x, z) => 20 + Math.max(0, Math.hypot(x, z) - 150) * 0.5;

test("the ground grid reproduces planar and sloped terrain between grid points", () => {
  const grid = buildGroundGrid([meshOf((x, z) => 10 + 0.25 * x - 0.1 * z)]);
  for (const [x, z] of [[0, 0], [13.3, -7.1], [-250.5, 199.9], [301, -333]]) {
    close(sampleGroundGrid(grid, x, z), 10 + 0.25 * x - 0.1 * z, 1e-3, `plane at ${x},${z}`);
  }
  const hill = buildGroundGrid([meshOf(bowl)]);
  close(sampleGroundGrid(hill, -320, 40), bowl(-320, 40), 1, "hill slope");
});

test("overlapping meshes keep the upper surface and uncovered ground reads as null", () => {
  const low = meshOf(() => 5, { x0: -100, x1: 100, z0: -100, z1: 100 });
  const high = meshOf(() => 30, { x0: 0, x1: 100, z0: -100, z1: 100 });
  const grid = buildGroundGrid([low, high]);
  close(sampleGroundGrid(grid, -50, 0), 5, 1e-6, "low only");
  close(sampleGroundGrid(grid, 50, 0), 30, 1e-6, "both, upper wins");
  assert.equal(sampleGroundGrid(grid, 500, 0), null);
  assert.equal(sampleGroundGrid(null, 0, 0), null);
});

test("indexless triangle soup and vertical walls are handled", () => {
  const soup = new Float32Array([0, 7, 0, 0, 7, 40, 40, 7, 0, 10, 99, 10, 10, 0, 10, 10, 50, 30]);
  const grid = buildGroundGrid([{ positions: soup, index: null }]);
  close(sampleGroundGrid(grid, 4, 4), 7, 1e-6, "flat triangle, wall ignored");
});

test("a camera already above the ground is left alone", () => {
  const groundAt = () => 20;
  assert.equal(clampOrbitAboveGround([0, 60, 300], [0, 0, 0], groundAt, { clearance: 4 }), null);
  assert.equal(clampOrbitAboveGround([0, 60, 300], [0, 0, 0], () => null, { clearance: 4 }), null);
});

test("a camera inside the hill is rotated up around the target at the same distance and azimuth", () => {
  const grid = buildGroundGrid([meshOf(bowl)]);
  const groundAt = (x, z) => sampleGroundGrid(grid, x, z);
  const target = [0, 20, 0];
  // Max tilt (81.8 deg) at distance 367.7 toward the west, the QA repro: y 52.3 with the hill near y 118 there.
  const polar = Math.PI / 2.2;
  const radius = 367.7;
  const azimuth = -Math.PI / 2 + 0.3;
  const start = [
    target[0] + radius * Math.sin(polar) * Math.sin(azimuth),
    target[1] + radius * Math.cos(polar),
    target[2] + radius * Math.sin(polar) * Math.cos(azimuth),
  ];
  assert.ok(start[1] < groundAt(start[0], start[2]), "the repro starts inside the hill");
  const next = clampOrbitAboveGround(start, target, groundAt, { clearance: 4, minPolarAngle: Math.PI / 6 });
  close(Math.hypot(next[0] - target[0], next[1] - target[1], next[2] - target[2]), radius, 1e-6, "distance kept");
  close(Math.atan2(next[0] - target[0], next[2] - target[2]), azimuth, 1e-9, "azimuth kept");
  const clearance = next[1] - groundAt(next[0], next[2]);
  assert.ok(clearance >= 4 - 1e-6, `clearance ${clearance}`);
  assert.ok(clearance < 12, `rotated only as far as needed, clearance ${clearance}`);
});

test("lift is continuous as the camera sweeps round a hill, so it does not jump", () => {
  const grid = buildGroundGrid([meshOf((x) => 20 + Math.max(0, -x - 100) * 0.5)]);
  const groundAt = (x, z) => sampleGroundGrid(grid, x, z);
  const target = [0, 20, 0];
  let previous = null;
  for (let step = 0; step <= 360; step += 1) {
    const azimuth = (step / 360) * Math.PI * 2;
    const position = [300 * Math.sin(azimuth), 40, 300 * Math.cos(azimuth)];
    const next = clampOrbitAboveGround(position, target, groundAt, { clearance: 4 }) ?? position;
    assert.ok(next[1] - groundAt(next[0], next[2]) >= 4 - 1e-6, `clearance at ${step}`);
    if (previous) assert.ok(Math.abs(next[1] - previous[1]) < 3, `smooth at ${step}: ${previous[1]} -> ${next[1]}`);
    previous = next;
  }
});

test("when the polar limit stops the rotation the camera rises straight up instead", () => {
  const groundAt = () => 200;
  const next = clampOrbitAboveGround([0, 50, 100], [0, 0, 0], groundAt, { clearance: 4, minPolarAngle: Math.PI / 6 });
  assert.ok(next[1] >= 204, `y ${next[1]}`);
  close(Math.atan2(next[0], next[2]), 0, 1e-9, "azimuth kept");
});

test("a camera straight above the target is raised vertically", () => {
  assert.deepEqual(clampOrbitAboveGround([0, 10, 0], [0, 0, 0], () => 20, { clearance: 4 }), [0, 24, 0]);
});

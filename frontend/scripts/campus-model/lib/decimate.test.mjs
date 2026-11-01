import assert from "node:assert/strict";
import test from "node:test";

import { decimateDecal } from "./decimate.mjs";

// A 10 x 2 unit strip gridded every 0.5 unit (the partition slivers of a lane line), 160 triangles.
function strip(heightAt) {
  const W = 20;
  const H = 4;
  const positions = [];
  const indices = [];
  for (let j = 0; j <= H; j += 1) for (let i = 0; i <= W; i += 1) positions.push(i * 0.5, heightAt(i * 0.5, j * 0.5), j * 0.5);
  for (let j = 0; j < H; j += 1) {
    for (let i = 0; i < W; i += 1) {
      const a = j * (W + 1) + i;
      indices.push(a, a + W + 1, a + 1, a + 1, a + W + 1, a + W + 2);
    }
  }
  return { positions, indices };
}

const planArea = ({ positions: p, indices }) => {
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    area += Math.abs((p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]) - (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3])) / 2;
  }
  return area;
};

const outline = ({ positions: p, indices }) => {
  const use = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const a = indices[t + k];
      const b = indices[t + ((k + 1) % 3)];
      const key = [a, b].map((v) => `${p[v * 3]},${p[v * 3 + 2]}`).sort().join("|");
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  return new Set([...use].filter(([, n]) => n === 1).map(([key]) => key.split("|")).flat());
};

test("a flat strip collapses to a few triangles with its plan area and outline vertices kept", async () => {
  const source = strip(() => 10);
  const out = await decimateDecal({ ...source, toleranceM: 0.02, unitsPerMetre: 0.6242 });
  assert.equal(out.before, 160);
  assert.ok(out.after < 60, `${out.after} triangles left`);
  assert.ok(Math.abs(planArea(out) - 20) < 1e-6, "plan area kept");
  for (const vertex of outline(source)) assert.ok(outline(out).has(vertex), `outline vertex ${vertex} lost`);
});

test("a strip over rough terrain keeps every triangle the tolerance needs", async () => {
  const source = strip((x, z) => 10 + Math.sin(x * 7 + z * 3) * 0.3);
  const out = await decimateDecal({ ...source, toleranceM: 0.02, unitsPerMetre: 0.6242 });
  assert.equal(out.after, 160);
});

test("attributes ride along with the kept vertices", async () => {
  const source = strip(() => 10);
  const uvs = Float32Array.from({ length: (source.positions.length / 3) * 2 }, (_, k) => (k % 2 ? 0.5 : source.positions[Math.floor(k / 2) * 3]));
  const out = await decimateDecal({ ...source, attributes: [{ array: uvs, size: 2 }], toleranceM: 0.02, unitsPerMetre: 0.6242 });
  for (let v = 0; v < out.positions.length / 3; v += 1) {
    assert.equal(out.attributes[0].array[v * 2], out.positions[v * 3]);
    assert.equal(out.attributes[0].array[v * 2 + 1], 0.5);
  }
});

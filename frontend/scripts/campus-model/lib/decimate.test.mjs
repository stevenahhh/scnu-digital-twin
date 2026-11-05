import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { decimateDecal } from "./decimate.mjs";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";

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
test("faces at or below the paint invariant's 2e-8 m2 twice-area floor are dropped, larger faces kept", async () => {
  const { dropSliverFaces, PAINT_FACE_AREA2_FLOOR_M2 } = await import("./decimate.mjs");
  assert.equal(PAINT_FACE_AREA2_FLOOR_M2, 2e-8);
  // twice area 1e-8 m2 (between meshopt's old 1e-9 guard and the invariant floor) and 1 m2, at 2 scene units per metre.
  const k = 2;
  const positions = Float32Array.from([0, 0, 0, k, 0, 0, 0, 0, 1e-8 * k, 0, 0, k]);
  assert.deepEqual(dropSliverFaces(Uint32Array.from([0, 1, 2, 0, 1, 3]), positions, k), [0, 1, 3]);
});

test("D4 pavers remain one cover at the z=-272 seam after decimation", async () => {
  const source = JSON.parse(readFileSync(new URL("./decimate.d4.fixture.json", import.meta.url), "utf8"));
  const hits = mesh => {
    let count = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const tri = Array.from(mesh.indices.slice(i, i + 3), k => [mesh.positions[k * 3], mesh.positions[k * 3 + 2]]);
      const sides = tri.map((a, j) => {
        const b = tri[(j + 1) % 3], p = source.point;
        return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
      });
      if (!(sides.some(v => v < 0) && sides.some(v => v > 0))) count += 1;
    }
    return count;
  };
  assert.equal(hits(source), 1, "the pre-decimation partition has exactly one owner");
  const uvs = Float32Array.from({ length: source.positions.length / 3 * 2 }, (_, k) =>
    source.positions[Math.floor(k / 2) * 3 + (k % 2 ? 2 : 0)]);
  const out = await decimateDecal({ ...source, attributes: [{ array: uvs, size: 2 }], toleranceM: 0.02, unitsPerMetre: 0.6242 });
  assert.equal(hits(out), 1, "a folded face must not turn one paved surface into three");
  // Clipped edge vertices are stored as Float32. Bound area roundoff from the
  // source perimeter and its half-ULP radius, not from the observed result.
  // Evidence: waves/g-ground-numerics.md.
  const edges = new Map();
  for (let i = 0; i < source.indices.length; i += 3) for (let j = 0; j < 3; j += 1) {
    const a = source.indices[i + j], b = source.indices[i + (j + 1) % 3];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  const perimeter = [...edges].filter(([, uses]) => uses === 1).reduce((sum, [key]) => {
    const [a, b] = key.split(",").map(Number);
    return sum + Math.hypot(source.positions[a * 3] - source.positions[b * 3],
      source.positions[a * 3 + 2] - source.positions[b * 3 + 2]);
  }, 0);
  const ulp = Math.max(...[...new Set(source.indices)].flatMap(v => [0, 2].map(k =>
    2 ** (Math.floor(Math.log2(Math.abs(source.positions[v * 3 + k]))) - 23))));
  const radius = ulp / Math.sqrt(2);
  const areaDelta = planArea(out) - planArea({ ...source, positions: Float32Array.from(source.positions) });
  assert.ok(Math.abs(areaDelta) <= perimeter * radius + Math.PI * radius ** 2,
    `repair must retain the covered plan area instead of dropping the flipped face: delta ${areaDelta}`);
  for (let v = 0; v < out.positions.length / 3; v += 1) {
    assert.equal(out.attributes[0].array[v * 2], out.positions[v * 3]);
    assert.equal(out.attributes[0].array[v * 2 + 1], out.positions[v * 3 + 2]);
  }
});

for (const east of [243422.6, 243591.86]) {
  test(`a folded decal at the D4 boundary E=${east} produces finite geometry`, async () => {
    // Same real collapse fixture, translated to the authorized TM boundary.
    // Both cases threw before the repair box was clipped to that boundary.
    const source = JSON.parse(readFileSync(new URL("./decimate.d4.fixture.json", import.meta.url), "utf8"));
    const target = tmToScene(east, 263888);
    const positions = source.positions.map((value, i) => {
      if (i % 3 === 1) return value;
      const axis = i % 3 === 0 ? 0 : 1;
      return value + target[axis] - source.point[axis];
    });
    const out = await decimateDecal({ ...source, positions, toleranceM: 0.02, unitsPerMetre: 0.6242 });
    assert.ok(out.indices.length > 0, "the boundary decal must remain emitted");
    assert.ok(out.positions.every(Number.isFinite), "clipped interpolation must stay finite");
  });
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GRASS_CLASS, LANDCOVER_ORIGIN, TUFT_STRIDE, buildGrassField, chunksInRange, landcoverSampler, scatterChunk } from "./grassScatter.mjs";
import { EXTENT } from "../../scripts/campus-model/lib/frame.mjs";
import { LANDCOVER } from "../../scripts/campus-model/lib/landcover.mjs";

// A flat square [0, size] x [0, size] at height y, cut into cells x cells quads (two triangles each).
function flatGrid(size, cells, y = 0) {
  const positions = [];
  const index = [];
  const step = size / cells;
  for (let j = 0; j <= cells; j += 1) for (let i = 0; i <= cells; i += 1) positions.push(i * step, y, j * step);
  const at = (i, j) => j * (cells + 1) + i;
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      index.push(at(i, j), at(i + 1, j + 1), at(i + 1, j), at(i, j), at(i, j + 1), at(i + 1, j + 1));
    }
  }
  return { positions: new Float32Array(positions), index: new Uint32Array(index) };
}

function allTufts(field, options) {
  const tufts = [];
  for (const key of field.chunks.keys()) {
    const data = scatterChunk(field, key, options);
    for (let i = 0; i < data.length; i += TUFT_STRIDE) tufts.push(Array.from(data.subarray(i, i + TUFT_STRIDE)));
  }
  return tufts;
}

const byPlace = (a, b) => a[0] - b[0] || a[2] - b[2] || a[3] - b[3];

describe("generator contract", () => {
  it("uses the generator's grass class and land-cover origin", () => {
    assert.equal(GRASS_CLASS, LANDCOVER.GRASS);
    assert.deepEqual({ ...LANDCOVER_ORIGIN }, { minX: EXTENT.minX, minZ: EXTENT.minZ });
  });
});

describe("landcoverSampler", () => {
  it("reads one class byte per scene unit from the first channel, like the generator's landcoverAt", () => {
    // 3 x 2 RGB image: row 0 = [0, 1, 2], row 1 = [3, 1, 5]
    const pixels = new Uint8Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 1, 1, 1, 5, 5, 5]);
    const at = landcoverSampler({ pixels, width: 3, height: 2, channels: 3, minX: -2, minZ: -376 });
    assert.equal(at(-2, -376), 0);
    assert.equal(at(-0.5, -375.5), 1);
    assert.equal(at(0.2, -375), 5);
    // outside the extent clamps to the border cells
    assert.equal(at(-100, -1000), 0);
    assert.equal(at(100, 100), 5);
  });
});

describe("buildGrassField", () => {
  it("buckets every triangle into the chunk of its centroid, with the chunk centre inside that cell", () => {
    const field = buildGrassField({ sources: [flatGrid(20, 4, 3)], chunkSize: 10 });
    assert.deepEqual([...field.chunks.keys()].sort(), ["0,0", "0,1", "1,0", "1,1"]);
    let triangles = 0;
    for (const [key, chunk] of field.chunks) {
      const [ix, iz] = key.split(",").map(Number);
      assert.deepEqual(chunk.center, [(ix + 0.5) * 10, 3, (iz + 0.5) * 10]);
      triangles += chunk.parts.reduce((sum, part) => sum + part.triangles.length, 0);
    }
    assert.equal(triangles, 32);
  });

  it("keeps the triangles of several sources apart inside one chunk", () => {
    const field = buildGrassField({ sources: [flatGrid(10, 1), flatGrid(10, 2)], chunkSize: 10 });
    assert.deepEqual(field.chunks.get("0,0").parts.map((part) => [part.source, part.triangles.length]), [[0, 2], [1, 8]]);
  });
});

describe("scatterChunk", () => {
  it("places about area x density tufts on a flat lawn, every tuft on the surface", () => {
    const field = buildGrassField({ sources: [flatGrid(20, 8, 3.5)], chunkSize: 10 });
    const tufts = allTufts(field, { density: 4 });
    assert.ok(tufts.length > 1600 * 0.93 && tufts.length < 1600 * 1.07, `expected about 1600 tufts, got ${tufts.length}`);
    for (const [x, y, z] of tufts) {
      assert.ok(x >= 0 && x <= 20 && z >= 0 && z <= 20);
      assert.ok(Math.abs(y - 3.5) < 1e-4);
    }
  });

  it("marks every tuft with the index of its source", () => {
    // source 1 lies beside source 0 in the same chunk
    const right = flatGrid(5, 2);
    for (let i = 0; i < right.positions.length; i += 3) right.positions[i] += 5;
    const field = buildGrassField({ sources: [flatGrid(5, 2), right], chunkSize: 10 });
    const tufts = allTufts(field, { density: 4 });
    assert.ok(tufts.some(([x]) => x < 5) && tufts.some(([x]) => x > 5));
    for (const [x, , , , , source] of tufts) assert.equal(source, x < 5 ? 0 : 1);
  });

  it("plants only where the source accepts the point", () => {
    const source = { ...flatGrid(20, 4), accept: (x) => x < 10 };
    const tufts = allTufts(buildGrassField({ sources: [source], chunkSize: 10 }), { density: 3 });
    assert.ok(tufts.length > 0);
    assert.ok(tufts.every(([x]) => x < 10));
  });

  it("skips slopes steeper than maxSlopeDeg", () => {
    // a wall-like triangle rising 20 units over 1 unit of plan
    const wall = { positions: new Float32Array([0, 0, 0, 1, 20, 0, 0, 0, 10]), index: new Uint32Array([0, 2, 1]) };
    assert.equal(allTufts(buildGrassField({ sources: [wall], chunkSize: 10 }), { density: 5 }).length, 0);
  });

  it("keeps yaw in [0, 2pi) and scale near 1", () => {
    const tufts = allTufts(buildGrassField({ sources: [flatGrid(12, 3)], chunkSize: 6 }), { density: 2 });
    for (const [, , , yaw, scale] of tufts) {
      assert.ok(yaw >= 0 && yaw < Math.PI * 2);
      assert.ok(scale >= 0.6 && scale <= 1.4);
    }
  });

  it("gives the same tufts when triangles and their corners come in another order (a re-encoded model)", () => {
    const grid = flatGrid(12, 3);
    const reversed = new Uint32Array(grid.index.length);
    const count = grid.index.length / 3;
    for (let t = 0; t < count; t += 1) {
      const [a, b, c] = grid.index.subarray(t * 3, t * 3 + 3);
      reversed.set([b, c, a], (count - 1 - t) * 3);
    }
    const a = allTufts(buildGrassField({ sources: [grid], chunkSize: 6 }), { density: 2 }).sort(byPlace);
    const b = allTufts(buildGrassField({ sources: [{ positions: grid.positions, index: reversed }], chunkSize: 6 }), { density: 2 }).sort(byPlace);
    assert.ok(a.length > 0);
    assert.deepEqual(a, b);
  });

  it("applies the source's 4x4 transform (model frame) before the accept test and the output", () => {
    // column-major translation by (100, 2, -50)
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 2, -50, 1];
    const seen = [];
    const source = { ...flatGrid(10, 2), matrix, accept: (x, z) => { seen.push([x, z]); return true; } };
    const tufts = allTufts(buildGrassField({ sources: [source], chunkSize: 10 }), { density: 1 });
    assert.ok(seen.length > 0 && seen.every(([x, z]) => x >= 100 && x <= 110 && z >= -50 && z <= -40));
    assert.ok(tufts.every(([, y]) => Math.abs(y - 2) < 1e-4));
  });
});

describe("chunksInRange", () => {
  it("returns the keys of chunks whose centre is within the distance of the point", () => {
    const chunks = new Map([
      ["a", { center: [0, 0, 0] }],
      ["b", { center: [50, 0, 0] }],
      ["c", { center: [0, 120, 0] }],
    ]);
    assert.deepEqual(chunksInRange(chunks, [0, 0, 0], 60), new Set(["a", "b"]));
    assert.deepEqual(chunksInRange(chunks, [0, 100, 0], 30), new Set(["c"]));
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { pickTiles, score, splitSide, ssim } from "./fidelityCore.mjs";

const W = 64;
const H = 48;
function pattern(seed = 0) {
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) lum[y * W + x] = ((x * 7 + y * 13 + seed) % 50) * 5;
  return lum;
}

test("ssim is 1 for identical images and drops for a different structure", () => {
  const a = pattern();
  assert.equal(ssim(a, a, W, H), 1);
  const noisy = a.map((v, i) => Math.min(255, Math.max(0, v + ((i * 2654435761) % 41) - 20)));
  const s = ssim(a, noisy, W, H);
  assert.ok(s < 0.99 && s > 0.3, `noisy ssim ${s}`);
  assert.ok(ssim(a, pattern(17), W, H) < s);
});

test("ssim rejects images of different sizes", () => {
  assert.throws(() => ssim(new Float32Array(10), new Float32Array(W * H), W, H), /sizes differ/);
});

test("splitSide separates render | gap | photo", () => {
  const width = 2 * 3 + 8;
  const px = new Uint8Array(width * 2 * 3);
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < width; x += 1) px[(y * width + x) * 3] = x < 3 ? 10 : x >= 11 ? 200 : 17;
  const { left, right, width: half } = splitSide(px, width, 2, 3);
  assert.equal(half, 3);
  assert.deepEqual([...left].filter((_, i) => i % 3 === 0), [10, 10, 10, 10, 10, 10]);
  assert.deepEqual([...right].filter((_, i) => i % 3 === 0), [200, 200, 200, 200, 200, 200]);
});

test("pickTiles keeps the tiles with the most photo edges, ties by name", () => {
  const tiles = [{ name: "b", photoEdgeShare: 0.2 }, { name: "a", photoEdgeShare: 0.2 }, { name: "c", photoEdgeShare: 0.5 }];
  assert.deepEqual(pickTiles(tiles, 2).map((t) => t.name), ["c", "a"]);
});

test("score: literal clamps reductions to 0, signed credits them", () => {
  const base = { B: 100, D: 100, T: 100, L: 100, F: 60, Q: 0.5 };
  const smaller = { ...base, B: 50 };
  assert.equal(score(base, smaller), 0.5);
  assert.equal(score(base, smaller, { signed: true }), 0.5 + 0.15 * 0.5);
  assert.equal(score(base, { ...base, F: 30 }), 0.5 - 0.3 * 0.5);
});

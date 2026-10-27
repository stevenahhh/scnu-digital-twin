import assert from "node:assert/strict";
import test from "node:test";
import { WATER_REFLECTION_SIZE, reflectionSizeFor, rippleNormalMap, splitPools } from "./waterReflection.mjs";

test("reflection texture size per quality tier: smallest on low, unknown tiers fall back to low", () => {
  assert.ok(WATER_REFLECTION_SIZE.low < WATER_REFLECTION_SIZE.medium && WATER_REFLECTION_SIZE.medium < WATER_REFLECTION_SIZE.high);
  assert.equal(reflectionSizeFor("high"), WATER_REFLECTION_SIZE.high);
  assert.equal(reflectionSizeFor("bogus"), WATER_REFLECTION_SIZE.low);
});

test("splitPools: two separate pools stay apart, each with its own mean plane height; shared positions join", () => {
  // pool A: two triangles at y 1 (vertices duplicated, as a split primitive would be); pool B: one triangle at y 2
  const p = [0, 1, 0, 1, 1, 0, 0, 1, 1, /**/ 1, 1, 0, 1, 1, 1, 0, 1, 1, /**/ 5, 2, 5, 6, 2, 5, 5, 2, 6];
  const pools = splitPools(p).sort((a, b) => a.planeY - b.planeY);
  assert.equal(pools.length, 2);
  assert.equal(pools[0].triangles.length, 6);
  assert.equal(pools[0].planeY, 1);
  assert.equal(pools[1].planeY, 2);
});

test("rippleNormalMap tiles seamlessly and encodes upward normals", () => {
  const n = 32;
  const d = rippleNormalMap(n);
  assert.equal(d.length, n * n * 4);
  // mean |difference| across the wrap seam (last column to first) against the mean between neighbouring columns
  const at = (x, y, k) => d[(y * n + x) * 4 + k];
  let seam = 0, inner = 0;
  for (let y = 0; y < n; y += 1) for (let k = 0; k < 2; k += 1) {
    seam += Math.abs(at(n - 1, y, k) - at(0, y, k));
    for (let x = 0; x + 1 < n; x += 1) inner += Math.abs(at(x + 1, y, k) - at(x, y, k)) / (n - 1);
  }
  assert.ok(seam <= 1.5 * inner, `seam ${seam.toFixed(0)} vs neighbours ${inner.toFixed(0)}`);
  for (let i = 2; i < d.length; i += 4) assert.ok(d[i] > 128, "z component points up");
});

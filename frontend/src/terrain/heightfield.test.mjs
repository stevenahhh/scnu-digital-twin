import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadHeightfield, parseHeightfield, sampleHeight } from "./heightfield.mjs";

// Encodes a height function on a grid the way build-campus-model.mjs writes the sidecar.
function encode(width, height, heightAt, { originX = -2, originZ = -376, step = 2, minY = 10, scale = 0.01 } = {}) {
  const view = new DataView(new ArrayBuffer(width * height * 2));
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      view.setUint16((j * width + i) * 2, Math.round((heightAt(i, j) - minY) / scale), true);
    }
  }
  return { meta: { width, height, originX, originZ, step, minY, scale }, buffer: view.buffer };
}

const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test("grid points decode to minY + value * scale", () => {
  const { meta, buffer } = encode(3, 2, (i, j) => 10 + i + 2 * j);
  const field = parseHeightfield(meta, buffer);
  for (let j = 0; j < 2; j += 1) {
    for (let i = 0; i < 3; i += 1) close(sampleHeight(field, -2 + i * 2, -376 + j * 2), 10 + i + 2 * j, 1e-4, `(${i}, ${j})`);
  }
});

test("bilinear interpolates the four corners of a cell", () => {
  // Corners 10, 12 / 14, 20: a non-planar cell, so bilinear and triangle sampling differ inside it.
  const corners = [[10, 12], [14, 20]];
  const field = parseHeightfield(...Object.values(encode(2, 2, (i, j) => corners[j][i], { originX: 0, originZ: 0, step: 2 })));
  close(sampleHeight(field, 1, 1, "bilinear"), (10 + 12 + 14 + 20) / 4, 1e-4, "centre");
  close(sampleHeight(field, 1, 0, "bilinear"), 11, 1e-4, "north edge midpoint");
  close(sampleHeight(field, 0.5, 1.5, "bilinear"), (10 * 0.75 + 12 * 0.25) * 0.25 + (14 * 0.75 + 20 * 0.25) * 0.75, 1e-4, "off-centre");
});

test("triangle sampling follows the Topography diagonal a,c,b / b,c,d", () => {
  const corners = [[10, 12], [14, 20]];
  const field = parseHeightfield(...Object.values(encode(2, 2, (i, j) => corners[j][i], { originX: 0, originZ: 0, step: 2 })));
  // On the b-c diagonal the height is the b/c average, whatever a and d are.
  close(sampleHeight(field, 1, 1), (12 + 14) / 2, 1e-4, "diagonal midpoint");
  // Triangle a,c,b near a; triangle b,c,d near d.
  close(sampleHeight(field, 0.5, 0.5), 10 + (12 - 10) * 0.25 + (14 - 10) * 0.25, 1e-4, "a-side");
  close(sampleHeight(field, 1.5, 1.5), 20 + (14 - 20) * 0.25 + (12 - 20) * 0.25, 1e-4, "d-side");
});

test("a planar field is reproduced exactly by both modes", () => {
  const plane = (x, z) => 30 + 0.2 * x - 0.05 * z;
  const field = parseHeightfield(...Object.values(encode(20, 15, (i, j) => plane(-2 + i * 2, -376 + j * 2), { scale: 0.001 })));
  for (const [x, z] of [[-1.3, -375.1], [7.7, -366.2], [35.99, -348.01], [0.5, -370.5]]) {
    close(sampleHeight(field, x, z), plane(x, z), 0.002, `triangle (${x}, ${z})`);
    close(sampleHeight(field, x, z, "bilinear"), plane(x, z), 0.002, `bilinear (${x}, ${z})`);
  }
});

test("out-of-bounds points return null; the far edges are inside", () => {
  const field = parseHeightfield(...Object.values(encode(3, 3, (i, j) => 10 + i + j, { originX: 0, originZ: 0, step: 2 })));
  for (const [x, z] of [[-0.01, 1], [1, -0.01], [4.01, 1], [1, 4.01], [Number.NaN, 1], [1, Number.POSITIVE_INFINITY]]) {
    assert.equal(sampleHeight(field, x, z), null, `(${x}, ${z})`);
    assert.equal(sampleHeight(field, x, z, "bilinear"), null, `bilinear (${x}, ${z})`);
  }
  close(sampleHeight(field, 4, 4), 14, 1e-4, "far corner");
  close(sampleHeight(field, 0, 4), 12, 1e-4, "south-west corner");
});

test("a sidecar whose size does not match its metadata is rejected", () => {
  const { meta, buffer } = encode(3, 3, () => 10);
  assert.throws(() => parseHeightfield({ ...meta, width: 4 }, buffer), /expected 24 B/);
  assert.throws(() => parseHeightfield({ ...meta, step: undefined }, buffer), /incomplete/);
});

test("loadHeightfield resolves null when the sidecar is missing so callers keep their fallback", async () => {
  const missing = async () => ({ ok: false, status: 404 });
  assert.equal(await loadHeightfield(undefined, missing), null);
});

test("the shipped campus-v2 sidecar parses and samples its own grid values", async () => {
  const meta = JSON.parse(await readFile(new URL("../../public/campus-v2-height.json", import.meta.url), "utf8"));
  const bytes = await readFile(new URL("../../public/campus-v2-height.bin", import.meta.url));
  const field = parseHeightfield(meta, bytes);
  const raw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let n = 0; n < 20; n += 1) {
    const i = (n * 37) % meta.width;
    const j = (n * 53) % meta.height;
    const expected = meta.minY + raw.getUint16((j * meta.width + i) * 2, true) * meta.scale;
    close(sampleHeight(field, meta.originX + i * meta.step, meta.originZ + j * meta.step), expected, 0.01, `grid (${i}, ${j})`);
  }
});

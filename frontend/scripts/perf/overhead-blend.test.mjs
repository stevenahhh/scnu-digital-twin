import assert from "node:assert/strict";
import test from "node:test";

import { EXTENT, modelToGeo } from "../campus-model/lib/frame.mjs";
import { wgs84ToTm } from "../../src/geo/epsg5186.mjs";
import { SIDE_GAP, aggregate, measureTile, renderHalf, residualsMarkdown, sideBySide, tileGrid } from "./overheadBlendCore.mjs";

const W = 120;
const H = 100;

// Deterministic photo-like texture: blocks, a road band and diagonal stripes with sharp edges.
function photo() {
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let v = 90;
      if ((Math.floor(x / 13) + Math.floor(y / 11)) % 3 === 0) v = 200;
      if (y > 40 && y < 52) v = 40;
      if ((x + 2 * y) % 29 < 3) v = 240;
      if (x > 70 && x < 95 && y > 10 && y < 30) v = 150;
      rgb.set([v, v, v], (y * W + x) * 3);
    }
  }
  return rgb;
}

// render(x, y) = photo(x - sx, y - sy): content moved right by sx and down by sy (edge-replicated).
function shifted(src, sx, sy) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const px = Math.min(W - 1, Math.max(0, x - sx));
      const py = Math.min(H - 1, Math.max(0, y - sy));
      out.set(src.subarray((py * W + px) * 3, (py * W + px) * 3 + 3), (y * W + x) * 3);
    }
  }
  return out;
}

test("(a) a render shifted by (+2, -1) px against the photo measures dx 2, dy -1", () => {
  const p = photo();
  const r = measureTile({ render: shifted(p, 2, -1), photo: p, width: W, height: H });
  assert.equal(r.dx, 2);
  assert.equal(r.dy, -1);
  assert.equal(r.signal, true);
  assert.equal(r.pass, false);
  assert.ok(r.ratio === null || r.ratio > 1);
  const same = measureTile({ render: p, photo: p, width: W, height: H });
  assert.deepEqual([same.dx, same.dy, same.pass], [0, 0, true]);
});

test("(b) an all-flat tile is not a signal tile", () => {
  const flat = new Uint8Array(W * H * 3).fill(128);
  const r = measureTile({ render: flat, photo: photo(), width: W, height: H });
  assert.equal(r.signal, false);
  assert.equal(r.edgeShare, 0);
  assert.equal(r.pass, null);
});

test("(c) PASS only when every signal tile is within 1 px", () => {
  const ok = { signal: true, pass: true, dx: 1, dy: 0 };
  const bad = { signal: true, pass: false, dx: 0, dy: -3 };
  const quiet = { signal: false, pass: null, dx: 4, dy: 4 };
  assert.deepEqual(aggregate([ok, quiet]), { tilesTotal: 2, signalTiles: 1, failingTiles: 0, pass: true, maxShiftPx: 1 });
  assert.deepEqual(aggregate([ok, bad, quiet]), { tilesTotal: 3, signalTiles: 2, failingTiles: 1, pass: false, maxShiftPx: 3 });
  assert.equal(aggregate([quiet]).pass, false);
});

test("(d) the tile grid covers EXTENT and is snapped to 100 m", () => {
  const corners = [
    [EXTENT.minX, EXTENT.minZ],
    [EXTENT.maxX, EXTENT.minZ],
    [EXTENT.minX, EXTENT.maxZ],
    [EXTENT.maxX, EXTENT.maxZ],
  ].map(([x, z]) => wgs84ToTm(...modelToGeo(x, z)));
  const tiles = tileGrid(corners, 100);
  for (const t of tiles) {
    assert.equal(t.E0 % 100, 0);
    assert.equal(t.N0 % 100, 0);
  }
  for (const [E, N] of corners) {
    assert.ok(tiles.some((t) => E >= t.E0 && E <= t.E0 + 100 && N >= t.N0 && N <= t.N0 + 100), `corner ${E},${N} uncovered`);
  }
  const es = new Set(tiles.map((t) => t.E0));
  const ns = new Set(tiles.map((t) => t.N0));
  assert.equal(tiles.length, es.size * ns.size);
  assert.ok(tiles.length >= 40, `${tiles.length} tiles`);
});

test("renderHalf keeps only the render (left) half of a side-by-side image, never photo pixels", () => {
  const w = 3, h = 2, W = w * 2 + SIDE_GAP;
  const rgba = new Uint8Array(W * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < W; x += 1) rgba.set(x < w ? [10 + x, 20 + y, 30, 255] : [200, 200, 200, 255], (y * W + x) * 4);
  const half = renderHalf(rgba, W, h, 4);
  assert.deepEqual([half.width, half.height], [w, h]);
  assert.deepEqual([...half.pixels.subarray(0, 3)], [10, 20, 30]);
  assert.ok(![...half.pixels].includes(200), "no photo pixel survives the crop");
  assert.throws(() => renderHalf(rgba, W + 1, h, 4), /not a side-by-side image/);
});

test("sideBySide puts before left and after right with the same gap", () => {
  const img = (v) => ({ width: 2, height: 1, pixels: new Uint8Array(6).fill(v) });
  const pair = sideBySide(img(1), img(9));
  assert.equal(pair.width, 4 + SIDE_GAP);
  assert.equal(pair.pixels[0], 1);
  assert.equal(pair.pixels[(2 + SIDE_GAP) * 3], 9);
  assert.throws(() => sideBySide(img(1), { ...img(1), width: 3 }), /differ in size/);
});

test("residualsMarkdown lists every tile before vs after with the PASS counts", () => {
  const run = (dx, pass) => ({ signalTiles: 2, pass, thresholds: { passPx: 1 }, tiles: [{ E0: 1, N0: 2, dx: 0, dy: 0, signal: true, pass: true }, { E0: 3, N0: 4, dx, dy: 0, signal: true, pass }], windows: [{ name: "main-gate", dx, dy: 0, signal: true, pass }] });
  const md = residualsMarkdown(run(0, true), run(-2, false));
  assert.match(md, /before: 2\/2 .* after: 1\/2/);
  assert.match(md, /\| 3,4 \| 0, 0 PASS \| -2, 0 FAIL \|/);
  assert.match(md, /\| main-gate \| 0, 0 PASS \| -2, 0 FAIL \|/);
});

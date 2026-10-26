import assert from "node:assert/strict";
import test from "node:test";
import { DHASH_MAX_BITS, RECT_MAX_PX, compareScenario, dHashDistance, dHashImage, dHashPng, rectShift } from "./baseline.mjs";
import { encodePng } from "../../campus-model/lib/png.mjs";

function gradient(width, height, flip = false) {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = Math.round(((flip ? width - 1 - x : x) / (width - 1)) * 255 * ((y % 7) / 6 + 0.2) / 1.2);
      pixels.set([v, v, v], (y * width + x) * 3);
    }
  }
  return { width, height, channels: 3, pixels };
}

test("dHash is 16 hex chars, stable for identical images and far for a mirrored image", () => {
  const a = dHashImage(gradient(180, 120));
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(dHashDistance(a, dHashImage(gradient(180, 120))), 0);
  assert.ok(dHashDistance(a, dHashImage(gradient(180, 120, true))) > DHASH_MAX_BITS);
});

test("dHash survives a PNG round trip", () => {
  const image = gradient(90, 60);
  const png = encodePng(image.width, image.height, 3, image.pixels);
  assert.equal(dHashPng(png), dHashImage(image));
});

test("dHash distance counts differing bits", () => {
  assert.equal(dHashDistance("0000000000000000", "000000000000000f"), 4);
  assert.equal(dHashDistance("ffffffffffffffff", "0000000000000000"), 64);
});

test("rect fingerprint tolerance is 4 px per edge", () => {
  const base = { x: 10, y: 10, w: 100, h: 40 };
  assert.equal(rectShift(base, { ...base, x: 14, w: 96 }), 4);
  assert.equal(rectShift(base, base), 0);
  assert.equal(rectShift(null, null), 0);
  assert.equal(rectShift(base, null), Infinity);
  const current = { dhash: "0000000000000000", rects: { panel: { ...base, x: 10 + RECT_MAX_PX } } };
  assert.equal(compareScenario(current, { dhash: "0000000000000000", rects: { panel: base } }).pass, true);
  const moved = { dhash: "0000000000000000", rects: { panel: { ...base, x: 10 + RECT_MAX_PX + 1 } } };
  const verdict = compareScenario(moved, { dhash: "0000000000000000", rects: { panel: base } });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.problems[0].rect, "panel");
});

test("the mid-drag state S11 is gated by key rects only", () => {
  const base = { dhash: "0000000000000000", rects: { panel: { x: 0, y: 0, w: 10, h: 10 } } };
  const drift = compareScenario({ key: "legacy/S11-P-dark", dhash: "0000000000000fff", rects: base.rects }, base);
  assert.equal(drift.pass, true);
  assert.equal(drift.dhashGating, false);
  const moved = compareScenario({ key: "legacy/S11-P-dark", dhash: "0000000000000000", rects: { panel: { x: 9, y: 0, w: 10, h: 10 } } }, base);
  assert.equal(moved.pass, false);
  assert.equal(compareScenario({ key: "legacy/S01-P-dark", dhash: "0000000000000fff", rects: base.rects }, base).pass, false);
});

test("hash drift above the limit and a missing baseline are regressions", () => {
  const drift = compareScenario({ dhash: "00000000000001ff", rects: {} }, { dhash: "0000000000000000", rects: {} });
  assert.equal(drift.pass, false);
  assert.equal(drift.distance, 9);
  assert.equal(compareScenario({ dhash: "0000000000000000", rects: {} }, undefined).pass, false);
});

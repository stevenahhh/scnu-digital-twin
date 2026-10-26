import assert from "node:assert/strict";
import test from "node:test";

import { TEXT_STRETCH, arrowTemplate, glyph, hasGlyph, textBlock } from "./markingGlyphs.mjs";

const bounds = (polys) => {
  const pts = polys.flatMap((rings) => rings[0]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

test("every syllable of the read road texts composes from its jamo", () => {
  for (const char of "국립순천대학교환영합니다안녕히가세요주차금지서행천천히경 0123456789") assert.ok(hasGlyph(char), char);
  assert.equal(hasGlyph("A"), false);
  // a syllable fills its box: width across, height along travel
  const b = bounds(glyph("환", 1, 2.5));
  assert.ok(b.x1 - b.x0 > 0.75 && b.x1 - b.x0 < 1.15, `width ${b.x1 - b.x0}`);
  assert.ok(b.y1 - b.y0 > 2.2 && b.y1 - b.y0 < 2.7, `height ${b.y1 - b.y0}`);
});

test("a text block reads for the approaching driver: first line farthest (+y), syllables stretched along travel", () => {
  const { polys, charWidth, charHeight } = textBlock(["국립", "순천대학교"], 5.5, 8);
  assert.ok(Math.abs(charHeight - TEXT_STRETCH * charWidth) < 1e-9, "syllables 2.5 times as long as wide when the block has room");
  const first = bounds(textBlock(["국립"], 5.5, 8).polys);
  const all = bounds(polys);
  // the first line lies at the far (+y) end of the block, the second at the near end
  assert.ok(Math.abs(all.y1 - first.y1) > 0, "sanity");
  const top = polys.filter((rings) => rings[0].every((p) => p[1] > 0));
  const bottom = polys.filter((rings) => rings[0].every((p) => p[1] < 0));
  assert.ok(top.length && bottom.length);
  assert.ok(bounds(bottom).x1 - bounds(bottom).x0 > 5, "the five-syllable line fills the width");
  // the two-syllable line is spread over the same width (as painted at the main gate)
  assert.ok(Math.abs((bounds(top).x1 - bounds(top).x0) - (bounds(bottom).x1 - bounds(bottom).x0)) < 0.3);
  assert.ok(bounds(top).y0 > bounds(bottom).y1, "top line beyond the bottom line along travel");
});

test("arrows point along +y (travel) and turn arrows branch to their side", () => {
  const straight = bounds(arrowTemplate("arrow_straight", 5, 1.3));
  assert.ok(Math.abs(straight.y1 - 2.5) < 1e-9 && Math.abs(straight.y0 + 2.5) < 1e-9);
  const left = bounds(arrowTemplate("arrow_left", 5, 1.3));
  const right = bounds(arrowTemplate("arrow_right", 5, 1.3));
  assert.ok(left.x0 < -1 && left.x1 < 0.5, "a left arrow reaches to the left of travel");
  assert.ok(right.x1 > 1 && right.x0 > -0.5, "a right arrow reaches to the right of travel");
});

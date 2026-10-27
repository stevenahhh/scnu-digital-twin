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
  assert.equal(hasGlyph("a"), false);
  // a syllable fills its box: width across, height along travel
  const b = bounds(glyph("환", 1, 2.5));
  assert.ok(b.x1 - b.x0 > 0.75 && b.x1 - b.x0 < 1.15, `width ${b.x1 - b.x0}`);
  assert.ok(b.y1 - b.y0 > 2.2 && b.y1 - b.y0 < 2.7, `height ${b.y1 - b.y0}`);
});

test("Latin capitals A-Z compose and fill their box", () => {
  for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    assert.ok(hasGlyph(char), char);
    const b = bounds(glyph(char, 1, 2));
    assert.ok(b.x1 - b.x0 > 0.3 && b.x1 - b.x0 < 1.2, `${char} width ${b.x1 - b.x0}`);
    assert.ok(b.y1 - b.y0 > 1.7 && b.y1 - b.y0 < 2.2, `${char} height ${b.y1 - b.y0}`);
  }
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

test("bay symbols are solid polygons: the P one polygon with its counter as a hole, the wheelchair four solid parts", async () => {
  const { parkingPTemplate, wheelchairTemplate } = await import("./markingGlyphs.mjs");
  const p = parkingPTemplate(2);
  assert.equal(p.length, 1, "one polygon");
  assert.equal(p[0].length, 2, "outer ring and the counter");
  const pb = bounds(p);
  assert.ok(Math.abs(pb.y1 - pb.y0 - 2) < 1e-9 && Math.abs(pb.x1 - pb.x0 - 1.24) < 1e-9);
  const w = wheelchairTemplate(1.5);
  assert.equal(w.length, 4);
  for (const rings of w) assert.equal(rings.length, 1, "each part one ring, no joint pieces");
  const wb = bounds(w);
  assert.ok(wb.y1 - wb.y0 > 1.2 && wb.y1 - wb.y0 < 1.6, `height ${wb.y1 - wb.y0}`);
  // facing +x: the foot reaches further right than the head
  assert.ok(bounds([w[1]]).x1 > bounds([w[0]]).x1);
});

test("scooter and hatched-aisle templates: solid parts inside their boxes, the aisle's divider along its whole length", async () => {
  const { hatchTemplate, scooterTemplate } = await import("./markingGlyphs.mjs");
  const sc = scooterTemplate(1.4);
  assert.equal(sc.length, 5, "two wheels, deck, stem, handlebar");
  for (const rings of sc) assert.ok(rings.length <= 2, "a wheel is one ring with its hole, the rest one ring");
  const sb = bounds(sc);
  assert.ok(Math.abs(sb.x1 - sb.x0 - 1.4) < 0.05 && sb.y1 - sb.y0 < 1.2, `scooter box ${sb.x1 - sb.x0} x ${sb.y1 - sb.y0}`);
  // the stem and handlebar (top) at the front (+x)
  assert.ok(bounds([sc[4]]).x0 > 0);
  const h = hatchTemplate(5, 1.2);
  const hb = bounds(h);
  for (const [v, want] of [[hb.x0, -2.5], [hb.x1, 2.5], [hb.y0, -0.6], [hb.y1, 0.6]]) assert.ok(Math.abs(v - want) < 1e-9, `${v} vs ${want}`);
  const divider = bounds([h[0]]);
  assert.ok(divider.x1 - divider.x0 === 5 && divider.y0 === -0.6, "divider on the bay side, full length");
  assert.ok(h.length >= 7, `stripes ${h.length - 1}`);
});

test("bus-stop box: one outline polygon with its inside as a hole, two chevrons in the front third, inside the box", async () => {
  const { busStopBoxTemplate } = await import("./markingGlyphs.mjs");
  const t = busStopBoxTemplate(12, 2.5);
  assert.equal(t.length, 3);
  assert.equal(t[0].length, 2, "outline and its hole");
  const b = bounds(t);
  assert.ok(Math.abs(b.x1 - b.x0 - 2.5) < 1e-9 && Math.abs(b.y1 - b.y0 - 12) < 1e-9, `box ${b.x1 - b.x0} x ${b.y1 - b.y0}`);
  for (const chevron of t.slice(1)) assert.ok(bounds([chevron]).y0 > 0, "chevrons in the front half (+y)");
});

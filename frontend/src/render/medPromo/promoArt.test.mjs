// Copy and LED schedule of the 의대 유치 promo layer: every poster, slide and picket line cites a recorded source, and
// the screen schedule loops through the slides with a short cross-fade.
import assert from "node:assert/strict";
import test from "node:test";
import {
  PICKET_LINES, POSTER_DESIGNS, PROMO_SOURCES, SCREEN_SLIDES, SLIDE_SECONDS, TRANSITION_SECONDS, screenFrame,
} from "./promoArt.mjs";

test("every poster, slide and the picket cite sources that exist", () => {
  for (const item of [...POSTER_DESIGNS, ...SCREEN_SLIDES, PICKET_LINES]) {
    assert.ok(item.sources.length > 0, `no source: ${JSON.stringify(item)}`);
    for (const id of item.sources) assert.ok(PROMO_SOURCES[id]?.url.startsWith("https://"), `unknown source ${id}`);
  }
  assert.equal(POSTER_DESIGNS.length, 3);
  assert.ok(SCREEN_SLIDES.length >= 5);
});

test("screenFrame holds a slide, then cross-fades into the next one", () => {
  const start = screenFrame(0);
  assert.equal(start.slide, 0);
  assert.equal(start.next, 1);
  assert.equal(start.mix, 0);
  const late = screenFrame(SLIDE_SECONDS - TRANSITION_SECONDS / 2);
  assert.equal(late.slide, 0);
  assert.ok(late.mix > 0.4 && late.mix < 0.6, `mix ${late.mix}`);
  assert.equal(screenFrame(SLIDE_SECONDS).slide, 1);
});

test("screenFrame wraps after the last slide and keeps the ticker in [0, 1)", () => {
  const cycle = SLIDE_SECONDS * SCREEN_SLIDES.length;
  const last = screenFrame(cycle - 0.01);
  assert.equal(last.slide, SCREEN_SLIDES.length - 1);
  assert.equal(last.next, 0);
  assert.equal(screenFrame(cycle).slide, 0);
  for (const t of [0, 1.3, 17.9, 1234.5]) {
    const { ticker } = screenFrame(t);
    assert.ok(ticker >= 0 && ticker < 1, `ticker ${ticker} at ${t}`);
  }
});

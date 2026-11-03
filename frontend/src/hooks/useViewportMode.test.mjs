import assert from "node:assert/strict";
import test from "node:test";
import { PHONE_QUERY, readViewportMode, resolveViewportMode, TABLET_QUERY } from "./useViewportMode.mjs";

test("resolveViewportMode splits phone < 640 <= tablet < 1024 <= desktop", () => {
  assert.equal(resolveViewportMode(390), "phone");
  assert.equal(resolveViewportMode(639), "phone");
  assert.equal(resolveViewportMode(640), "tablet");
  assert.equal(resolveViewportMode(1023), "tablet");
  assert.equal(resolveViewportMode(1024), "desktop");
  assert.equal(resolveViewportMode(1440), "desktop");
});

test("readViewportMode agrees with resolveViewportMode through the media queries", () => {
  for (const width of [320, 390, 639, 640, 800, 1023, 1024, 1440]) {
    const matchMedia = (query) => ({ matches: query === PHONE_QUERY ? width <= 639 : query === TABLET_QUERY ? width <= 1023 : false });
    assert.equal(readViewportMode(matchMedia), resolveViewportMode(width), `width ${width}`);
  }
});

test("readViewportMode falls back to desktop without matchMedia", () => {
  assert.equal(readViewportMode(undefined), "desktop");
});

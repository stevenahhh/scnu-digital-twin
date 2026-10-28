import assert from "node:assert/strict";
import test from "node:test";
import { mapLighting } from "./mapLighting.mjs";

test("the map night shade is off by day and keeps deepening through twilight after dusk", () => {
  assert.equal(mapLighting(10).nightOpacity, 0);
  assert.equal(mapLighting(-6).nightOpacity, 0.6);
  // 19:00 and 21:00 in late October sit at about -15 and -36 degrees: the evening keeps getting darker.
  assert.ok(mapLighting(-15).nightOpacity > 0.6 && mapLighting(-15).nightOpacity < mapLighting(-36).nightOpacity);
  assert.equal(Math.round(mapLighting(-36).nightOpacity * 100), 90);
});

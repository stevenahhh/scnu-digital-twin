import assert from "node:assert/strict";
import test from "node:test";
import { getFogColor } from "./atmosphere.mjs";

const DEG = Math.PI / 180;

test("fog colour matches the night and day scene backgrounds at the ends of the palette", () => {
  assert.equal(getFogColor(-10 * DEG), "#09111d");
  assert.equal(getFogColor(0), "#09111d");
  assert.equal(getFogColor(6 * DEG), "#e6d6c6");
  assert.equal(getFogColor(25 * DEG), "#d6e0e6");
  assert.equal(getFogColor(70 * DEG), "#d6e0e6");
});

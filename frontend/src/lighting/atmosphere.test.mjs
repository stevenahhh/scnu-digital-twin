import assert from "node:assert/strict";
import test from "node:test";
import { CLEAR_COLOR_FLOOR, NIGHT_SKY_SRGB, getClearColor, getFogColor, getSkyNightMix } from "./atmosphere.mjs";

const DEG = Math.PI / 180;

test("fog colour matches the night and day scene backgrounds at the ends of the palette", () => {
  assert.equal(getFogColor(-10 * DEG), "#09111d");
  assert.equal(getFogColor(0), "#09111d");
  assert.equal(getFogColor(6 * DEG), "#e6d6c6");
  assert.equal(getFogColor(25 * DEG), "#d6e0e6");
  assert.equal(getFogColor(70 * DEG), "#d6e0e6");
});

test("sky night fade is off with the sun up, monotonic through twilight and full by -12 deg", () => {
  assert.equal(getSkyNightMix(10 * DEG), 0);
  assert.equal(getSkyNightMix(0), 0);
  assert.equal(getSkyNightMix(-12 * DEG), 1);
  assert.equal(getSkyNightMix(-40 * DEG), 1);
  let previous = 0;
  for (let degrees = 0; degrees >= -12; degrees -= 0.5) {
    const mix = getSkyNightMix(degrees * DEG);
    assert.ok(mix >= previous, `mix decreased at ${degrees} deg`);
    previous = mix;
  }
});

test("the faded night sky ends on the night fog colour", () => {
  const hex = `#${NIGHT_SKY_SRGB.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  assert.equal(hex, getFogColor(-20 * DEG));
});

test("the clear colour follows the fog colour and never goes darker than the canvas token", () => {
  const luminance = (hex) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  assert.equal(CLEAR_COLOR_FLOOR, "#0b0c0e");
  for (let degrees = -90; degrees <= 90; degrees += 0.5) {
    const clear = getClearColor(degrees * DEG);
    assert.ok(luminance(clear) >= luminance(CLEAR_COLOR_FLOOR), `${clear} at ${degrees} deg is darker than the floor`);
    assert.equal(clear, getFogColor(degrees * DEG), `clear colour left the fog colour at ${degrees} deg`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { nightAmbientAt, windowGlowAt } from "./nightCurve.mjs";

const rad = (degrees) => (degrees * Math.PI) / 180;
const NIGHT = rad(-30);

test("window glow is 0 while the sun is above -2 deg", () => {
  assert.equal(windowGlowAt(19 * 60, rad(10)), 0);
  assert.equal(windowGlowAt(19 * 60, rad(-1)), 0);
  assert.equal(windowGlowAt(12 * 60, rad(45)), 0);
});

test("window glow at 19:00 differs from 21:00 and is at its peak at 19:00", () => {
  assert.equal(windowGlowAt(19 * 60, NIGHT), 1);
  assert.notEqual(windowGlowAt(21 * 60, NIGHT), windowGlowAt(19 * 60, NIGHT));
});

test("window glow falls monotonically from 21:00 to 01:00 and reaches 0.35 at 23:00 and 0.1 at 01:00", () => {
  let previous = Infinity;
  for (let minute = 21 * 60; minute <= 25 * 60; minute += 10) {
    const value = windowGlowAt(minute % 1440, NIGHT);
    assert.ok(value <= previous, `glow rose at ${minute}`);
    previous = value;
  }
  assert.ok(Math.abs(windowGlowAt(23 * 60, NIGHT) - 0.35) < 1e-9);
  assert.ok(Math.abs(windowGlowAt(60, NIGHT) - 0.1) < 1e-9);
  assert.ok(Math.abs(windowGlowAt(6 * 60, NIGHT) - 0.3) < 1e-9);
});

test("night ambient is strictly lower at 21:00 than at 19:00, and keeps falling below -12 deg", () => {
  assert.ok(nightAmbientAt(21 * 60, rad(-25)) < nightAmbientAt(19 * 60, rad(-8)));
  assert.ok(nightAmbientAt(21 * 60, NIGHT) < nightAmbientAt(19 * 60, NIGHT));
  assert.ok(nightAmbientAt(3 * 60, rad(-30)) < nightAmbientAt(3 * 60, rad(-12)));
  assert.equal(nightAmbientAt(12 * 60, rad(40)), 1);
});

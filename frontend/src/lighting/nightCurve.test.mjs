import assert from "node:assert/strict";
import test from "node:test";
import { nightAmbientAt, windowGlowAt } from "./nightCurve.mjs";

const DEG = Math.PI / 180;
const at = (hour, minute = 0) => hour * 60 + minute;
// Sun altitudes at SCNU (34.97 N, 127.48 E) on 26 October, as the dashboard shows them.
const OCTOBER_19H = -16.3 * DEG;
const OCTOBER_21H = -40.7 * DEG;
const DEEP = -50 * DEG;

test("window glow is off while the sun is above -2 deg, at any hour", () => {
  for (const degrees of [60, 20, 0, -1.9]) {
    for (const minute of [at(3), at(12), at(19), at(21), at(23, 59)]) {
      assert.equal(windowGlowAt(minute, degrees * DEG), 0, `${minute} min at ${degrees} deg`);
    }
  }
});

test("window glow differs between 19:00 and 21:00 and peaks at 19:00", () => {
  const seven = windowGlowAt(at(19), OCTOBER_19H);
  const nine = windowGlowAt(at(21), OCTOBER_21H);
  assert.equal(seven, 1);
  assert.notEqual(seven, nine);
  assert.ok(nine < seven);
});

test("window glow falls monotonically from 21:00 to 01:00 across midnight", () => {
  let previous = Infinity;
  for (let minute = at(21); minute <= at(25); minute += 1) {
    const glow = windowGlowAt(minute % 1440, DEEP);
    assert.ok(glow <= previous, `glow rose at minute ${minute % 1440}`);
    previous = glow;
  }
  assert.ok(Math.abs(windowGlowAt(at(23), DEEP) - 0.35) < 1e-9);
  assert.ok(Math.abs(windowGlowAt(at(1), DEEP) - 0.1) < 1e-9);
  assert.ok(Math.abs(windowGlowAt(at(6), DEEP) - 0.3) < 1e-9);
});

test("window glow moves less than 0.01 per 1-minute step", () => {
  for (let minute = 0; minute < 1440; minute += 1) {
    const step = Math.abs(windowGlowAt((minute + 1) % 1440, DEEP) - windowGlowAt(minute, DEEP));
    assert.ok(step < 0.01, `step ${step} at minute ${minute}`);
  }
});

test("night ambient is untouched above -12 deg and strictly lower at 21:00 than at 19:00", () => {
  assert.equal(nightAmbientAt(at(12), 40 * DEG), 1);
  assert.equal(nightAmbientAt(at(18), -12 * DEG), 1);
  const seven = nightAmbientAt(at(19), OCTOBER_19H);
  const nine = nightAmbientAt(at(21), OCTOBER_21H);
  assert.ok(nine < seven, `21:00 ${nine} is not below 19:00 ${seven}`);
  assert.ok(nine > 0.4, "the night fill never goes near black");
});

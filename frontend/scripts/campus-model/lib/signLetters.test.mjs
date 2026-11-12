// Checks for the sign lettering outlines (lib/signLetters.mjs): layout inside the given box, smooth curves, counters.
import assert from "node:assert/strict";
import test from "node:test";
import { signLetters } from "./signLetters.mjs";

const points = (letters) => letters.flatMap((l) => l.shapes.flatMap((s) => [...s.outer, ...s.holes.flat()]));
// turn of the outline at every vertex of a ring, degrees
function turns(ring) {
  return ring.map((p, i) => {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[(i + 1) % ring.length];
    const [u, v] = [[p[0] - a[0], p[1] - a[1]], [b[0] - p[0], b[1] - p[1]]];
    return Math.abs((Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180) / Math.PI);
  });
}

test("signLetters: a line too long for the sign is condensed to it, standing on the foot and reaching the top", () => {
  const letters = signLetters("SCNU", { lengthM: 10, heightM: 3 });
  assert.deepEqual(letters.map((l) => l.char), ["S", "C", "N", "U"]);
  for (let i = 1; i < letters.length; i += 1) assert.ok(letters[i].centre > letters[i - 1].centre, "left to right");
  const all = points(letters);
  const [s0, s1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  assert.ok(Math.abs(s0) < 1e-6 && Math.abs(s1 - 10) < 1e-6, `fills the length: ${s0} to ${s1}`);
  assert.ok(Math.abs(Math.max(...all.map((p) => p[1])) - 3) < 1e-6, "the tallest letter reaches the top");
  // N has a flat foot on the line; the round letters overshoot below it by a few centimetres
  const feet = letters.map((l) => Math.min(...points([l]).map((p) => p[1])));
  for (const foot of feet) assert.ok(foot <= 1e-6 && foot > -0.1, `every letter reaches the foot of the line: ${foot}`);
  assert.ok(Math.max(...feet) > -1e-6, "one letter stands exactly on it");
});

test("signLetters: a short line keeps its proportions and is spaced out to the length", () => {
  const letters = signLetters("국립순천대학교", { lengthM: 10, heightM: 1.4 });
  assert.equal(letters.length, 7);
  const all = points(letters);
  assert.ok(Math.abs(Math.min(...all.map((p) => p[0]))) < 1e-6 && Math.abs(Math.max(...all.map((p) => p[0])) - 10) < 1e-6, "fills the length");
  const pitch = letters.slice(1).map((l, i) => l.centre - letters[i].centre);
  for (const d of pitch) assert.ok(Math.abs(d - pitch[0]) < 0.15, `even spacing: ${pitch.map((x) => x.toFixed(2))}`);
  assert.deepEqual(signLetters("A B", { lengthM: 5, heightM: 1 }).map((l) => l.char), ["A", "B"], "spaces carry no shape");
});

test("signLetters: curves are cut finely enough to read as curves, counters become holes", () => {
  const [s] = signLetters("S", { lengthM: 3, heightM: 3 });
  const ring = s.shapes[0].outer;
  assert.ok(ring.length >= 120, `S outline has ${ring.length} points`);
  const sharp = turns(ring).filter((t) => t > 12);
  assert.ok(sharp.length <= 4, `only the two cut ends of the S turn sharply: ${sharp.length} corners`);
  const [o] = signLetters("O", { lengthM: 3, heightM: 3 });
  assert.equal(o.shapes.length, 1);
  assert.equal(o.shapes[0].holes.length, 1, "the counter of O");
  // a coarser tolerance gives fewer points: the cut follows the tolerance, not a fixed count
  const coarse = signLetters("S", { lengthM: 3, heightM: 3, toleranceM: 0.02 })[0].shapes[0].outer;
  assert.ok(coarse.length < ring.length, `${coarse.length} points at 20 mm against ${ring.length} at 0.5 mm`);
  assert.throws(() => signLetters("S\uE000", { lengthM: 2, heightM: 1 }), /no glyph for \uE000/);
});

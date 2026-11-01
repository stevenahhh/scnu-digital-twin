import assert from "node:assert/strict";
import test from "node:test";
import { paintedLanes } from "./contextGround.mjs";

// A straight 100 m road along +x (metres) and paint points every metre on lines at the given lateral offsets.
const fit = [[0, 0], [100, 0]];
const line = (kind, offset, every = 1) => Array.from({ length: Math.floor(100 / every) }, (_, i) => ({ kind, p: [i * every, offset] }));

test("a yellow centre line with one dashed lane line each side reads as four lanes", () => {
  const paint = [...line("centre_line_yellow", 0.4), ...line("lane_line_dashed", 3.6), ...line("lane_line_dashed", -2.9)];
  assert.deepEqual(paintedLanes(fit, paint), { lanes: 4, sections: 10 });
});

test("the narrowest section wins: a turn lane near a junction does not raise the count", () => {
  const turn = Array.from({ length: 20 }, (_, i) => ({ kind: "lane_line_dashed", p: [80 + i, -6.2] }));
  const paint = [...line("centre_line_yellow", 0), ...line("lane_line_dashed", 3.2), ...line("lane_line_dashed", -3.2), ...turn];
  assert.equal(paintedLanes(fit, paint).lanes, 4);
});

test("a yellow line alone is one lane each way; no paint gives no lane count", () => {
  assert.deepEqual(paintedLanes(fit, line("centre_line_yellow", 0)), { lanes: 2, sections: 10 });
  assert.equal(paintedLanes(fit, []), null);
  assert.equal(paintedLanes(fit, line("lane_line_dashed", 3)), null);
});

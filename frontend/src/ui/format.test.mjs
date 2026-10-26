import assert from "node:assert/strict";
import test from "node:test";
import { formatHHmm } from "./format.mjs";

test("formats instants as 24-hour KST HH:mm", () => {
  assert.equal(formatHHmm("2026-10-26T00:40:00Z"), "09:40");
  assert.equal(formatHHmm(new Date("2026-10-26T12:05:00Z")), "21:05");
  assert.equal(formatHHmm("2026-10-26T15:00:00Z"), "00:00");
});

test("returns null for missing or invalid instants", () => {
  for (const value of [null, undefined, "", "not a date"]) assert.equal(formatHHmm(value), null);
});

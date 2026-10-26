import assert from "node:assert/strict";
import test from "node:test";
import { formatClock, formatDayLabel, formatHHmm, formatLongDate, formatNumber, formatShortTime } from "./format.mjs";

test("formats instants as 24-hour KST HH:mm", () => {
  assert.equal(formatHHmm("2026-10-26T00:40:00Z"), "09:40");
  assert.equal(formatHHmm(new Date("2026-10-26T12:05:00Z")), "21:05");
  assert.equal(formatHHmm("2026-10-26T15:00:00Z"), "00:00");
  assert.equal(formatShortTime("2026-10-26T06:12:00Z"), "15:12");
});

test("returns null for missing or invalid instants", () => {
  for (const value of [null, undefined, "", "not a date"]) {
    assert.equal(formatHHmm(value), null);
    assert.equal(formatClock(value), null);
    assert.equal(formatLongDate(value), null);
  }
});

test("formats the panel clock with seconds and a Korean date in KST", () => {
  assert.equal(formatClock("2026-10-26T06:12:09Z"), "15:12:09");
  assert.equal(formatLongDate("2026-10-25T16:00:00Z"), "10월 26일 (월)");
});

test("formats numbers to fixed digits and refuses non-numbers", () => {
  assert.equal(formatNumber(12.345), "12.3");
  assert.equal(formatNumber("7", 0), "7");
  for (const value of [null, undefined, "", "abc", Number.NaN]) assert.equal(formatNumber(value), null);
});

test("formats a simulation day as a Korean month-day label", () => {
  assert.equal(formatDayLabel("2026-05-18"), "5월 18일");
  assert.equal(formatDayLabel("2026-12-01"), "12월 1일");
  assert.equal(formatDayLabel("내일"), "내일");
});

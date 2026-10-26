import assert from "node:assert/strict";
import test from "node:test";
import { dateToDayOfYear, dayOfYearToDate, parseSceneDate, parseTypedTime } from "./timeControl.mjs";

test("dateToDayOfYear counts from 1 January and handles leap years", () => {
  assert.equal(dateToDayOfYear("2026-01-01"), 1);
  assert.equal(dateToDayOfYear("2026-12-31"), 365);
  assert.equal(dateToDayOfYear("2028-12-31"), 366);
  assert.equal(dateToDayOfYear("2028-03-01"), 61);
  assert.equal(dateToDayOfYear("2026-02-30"), null);
});

test("dayOfYearToDate is the inverse, leap day included", () => {
  assert.equal(dayOfYearToDate(2026, 365), "2026-12-31");
  assert.equal(dayOfYearToDate(2028, 60), "2028-02-29");
  for (const day of [1, 59, 60, 200, 365]) assert.equal(dateToDayOfYear(dayOfYearToDate(2026, day)), day);
});

test("parseSceneDate rejects malformed and impossible dates", () => {
  assert.deepEqual(parseSceneDate("2026-06-21"), { year: 2026, month: 6, day: 21 });
  assert.equal(parseSceneDate("2026-6-21"), null);
  assert.equal(parseSceneDate("2026-13-01"), null);
  assert.equal(parseSceneDate(""), null);
});

test("parseTypedTime accepts HH:mm and returns null for invalid times", () => {
  assert.equal(parseTypedTime("00:00"), 0);
  assert.equal(parseTypedTime("9:05"), 545);
  assert.equal(parseTypedTime("23:59"), 1439);
  for (const bad of ["25:99", "24:00", "12:60", "1200", "", null, "ab:cd"]) assert.equal(parseTypedTime(bad), null, String(bad));
});

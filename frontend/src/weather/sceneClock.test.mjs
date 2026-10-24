import assert from "node:assert/strict";
import test from "node:test";
import {
  KEY_STEP_LARGE_MINUTES,
  KEY_STEP_MINUTES,
  MINUTES_PER_DAY,
  PAGE_STEP_MINUTES,
  PLAY_INTERVAL_MS,
  PLAY_STEP_MINUTES,
  formatMinuteOfDay,
  kstMinuteOfDay,
  minuteForKey,
  minuteOfDayFromParts,
  splitMinuteOfDay,
  stepMinuteOfDay,
  wrapMinuteOfDay,
} from "./sceneClock.mjs";

test("the slider covers one day of KST minutes and play advances 1 minute every 100 ms", () => {
  assert.equal(MINUTES_PER_DAY, 1440);
  assert.equal(PLAY_STEP_MINUTES, 1);
  assert.equal(PLAY_INTERVAL_MS, 100);
  assert.equal(stepMinuteOfDay(13 * 60 + 36), 13 * 60 + 37);
});

test("keyboard steps 1 minute, 10 with Shift, 60 with PageUp/PageDown and clamps at the day edges", () => {
  assert.equal(KEY_STEP_MINUTES, 1);
  assert.equal(KEY_STEP_LARGE_MINUTES, 10);
  assert.equal(PAGE_STEP_MINUTES, 60);
  assert.equal(minuteForKey(817, { key: "ArrowRight" }), 818);
  assert.equal(minuteForKey(817, { key: "ArrowUp" }), 818);
  assert.equal(minuteForKey(817, { key: "ArrowLeft" }), 816);
  assert.equal(minuteForKey(817, { key: "ArrowDown" }), 816);
  assert.equal(minuteForKey(817, { key: "ArrowRight", shiftKey: true }), 827);
  assert.equal(minuteForKey(817, { key: "ArrowLeft", shiftKey: true }), 807);
  assert.equal(minuteForKey(817, { key: "PageUp" }), 877);
  assert.equal(minuteForKey(817, { key: "PageDown" }), 757);
  assert.equal(minuteForKey(817, { key: "Home" }), 0);
  assert.equal(minuteForKey(817, { key: "End" }), 1439);
  assert.equal(minuteForKey(1439, { key: "ArrowRight" }), 1439);
  assert.equal(minuteForKey(0, { key: "PageDown" }), 0);
  assert.equal(minuteForKey(817, { key: "Enter" }), null);
});

test("KST minute of day ignores the browser time zone", () => {
  assert.equal(kstMinuteOfDay(new Date("2026-10-24T06:00:00Z")), 15 * 60);
  assert.equal(kstMinuteOfDay(new Date("2026-10-24T15:30:00Z")), 30);
  assert.equal(kstMinuteOfDay(new Date("2026-10-24T14:59:00Z")), 23 * 60 + 59);
});

test("minutes wrap around midnight in both directions", () => {
  assert.equal(stepMinuteOfDay(1435, 10), 5);
  assert.equal(stepMinuteOfDay(5, -10), 1435);
  assert.equal(wrapMinuteOfDay(1440), 0);
  assert.equal(wrapMinuteOfDay(-1), 1439);
  assert.equal(wrapMinuteOfDay(12.4), 12);
  assert.equal(wrapMinuteOfDay(Number.NaN), 0);
});

test("parts and labels round-trip", () => {
  assert.deepEqual(splitMinuteOfDay(930), { hour: 15, minute: 30 });
  assert.equal(minuteOfDayFromParts({ hour: 15, minute: 30 }), 930);
  assert.equal(formatMinuteOfDay(930), "15:30");
  assert.equal(formatMinuteOfDay(0), "00:00");
  assert.equal(formatMinuteOfDay(1439), "23:59");
});

import test from "node:test";
import assert from "node:assert/strict";
import { FEED_TONE_COLORS, TRAFFIC_STATE_TONES, WEATHER_STATE_TONES, formatClockTime } from "./feedStatus.mjs";

test("formatClockTime renders local HH:mm and rejects empty or invalid input", () => {
  assert.equal(formatClockTime(new Date(2026, 4, 18, 9, 5).toISOString()), "09:05");
  assert.equal(formatClockTime(new Date(2026, 4, 18, 23, 59)), "23:59");
  assert.equal(formatClockTime(null), null);
  assert.equal(formatClockTime(""), null);
  assert.equal(formatClockTime("not a date"), null);
});

test("every weather and traffic state maps to a defined tone color", () => {
  for (const tone of [...Object.values(WEATHER_STATE_TONES), ...Object.values(TRAFFIC_STATE_TONES)]) {
    assert.ok(FEED_TONE_COLORS[tone], `missing color for ${tone}`);
  }
  assert.equal(WEATHER_STATE_TONES.live, "success");
  assert.equal(WEATHER_STATE_TONES.stale, "warning");
  assert.equal(TRAFFIC_STATE_TONES.offline, "danger");
});

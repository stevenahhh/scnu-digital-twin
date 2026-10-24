import assert from "node:assert/strict";
import test from "node:test";
import SunCalc from "suncalc";
import { CAMPUS_LOCATION } from "../utils/sunPosition.mjs";
import {
  getAutumnWeight,
  getDaylightWeight,
  getNightWeight,
  getSkySunAltitude,
  getTwilightBand,
} from "./season.mjs";

const DEG = Math.PI / 180;
const kst = (iso) => new Date(`${iso}+09:00`);
const altitudeAt = (date) => SunCalc.getPosition(date, CAMPUS_LOCATION.latitude, CAMPUS_LOCATION.longitude).altitude;

test("autumn weight is 0 before the ramp, 1 at the Nov 8 peak and 0 again by December", () => {
  assert.equal(getAutumnWeight(kst("2026-10-01T12:00:00")), 0);
  assert.equal(getAutumnWeight(kst("2026-11-08T12:00:00")), 1);
  assert.equal(getAutumnWeight(kst("2026-12-01T12:00:00")), 0);
  assert.equal(getAutumnWeight(kst("2026-07-15T12:00:00")), 0);
});

test("autumn weight rises and falls without jumps between days", () => {
  const start = kst("2026-10-15T00:00:00").getTime();
  let previous = getAutumnWeight(new Date(start));
  for (let day = 1; day <= 45; day += 1) {
    const weight = getAutumnWeight(new Date(start + day * 86400000));
    assert.ok(Math.abs(weight - previous) <= 0.16, `day ${day}: ${previous} -> ${weight}`);
    previous = weight;
  }
  const rising = getAutumnWeight(kst("2026-10-26T12:00:00"));
  assert.ok(rising > 0 && rising < 1);
});

test("autumn weight reads the KST calendar, not the UTC one", () => {
  // 2026-10-20 00:30 KST is still Oct 19 in UTC; both are at or before the ramp start.
  assert.equal(getAutumnWeight(kst("2026-10-20T00:00:00")), 0);
  // 2026-11-01 00:30 KST is Oct 31 in UTC (weight < 1) but Nov 1 in KST (full colour).
  assert.equal(getAutumnWeight(kst("2026-11-01T00:30:00")), 1);
});

test("twilight bands follow the 0 / -6 / -12 / -18 degree limits", () => {
  assert.equal(getTwilightBand(5), "day");
  assert.equal(getTwilightBand(-3), "civil");
  assert.equal(getTwilightBand(-9), "nautical");
  assert.equal(getTwilightBand(-15), "astronomical");
  assert.equal(getTwilightBand(-25), "night");
});

// SunCalc.getTimes puts civil dusk at 18:12:33; its position model crosses -6 deg about a minute earlier.
test("civil dusk on 2026-10-24 falls around 18:12 KST at the campus", () => {
  assert.equal(getTwilightBand(altitudeAt(kst("2026-10-24T18:11:00")) / DEG), "civil");
  assert.equal(getTwilightBand(altitudeAt(kst("2026-10-24T18:13:00")) / DEG), "nautical");
});

test("night weight is 0 with the sun up, 1 after nautical dusk, and monotonic between", () => {
  assert.equal(getNightWeight(10 * DEG), 0);
  assert.equal(getNightWeight(-12 * DEG), 1);
  assert.equal(getNightWeight(-40 * DEG), 1);
  let previous = 0;
  for (let degrees = 5; degrees >= -20; degrees -= 0.5) {
    const weight = getNightWeight(degrees * DEG);
    assert.ok(weight >= previous, `${degrees} deg`);
    previous = weight;
  }
});

test("daylight weight is full above 6 deg and zero below civil dusk", () => {
  assert.equal(getDaylightWeight(30 * DEG), 1);
  assert.equal(getDaylightWeight(-6 * DEG), 0);
  assert.ok(Math.abs(getDaylightWeight(0) - 0.5) < 1e-9);
});

test("the sky altitude equals the sun's by day and stretches twilight continuously below the horizon", () => {
  assert.equal(getSkySunAltitude(20 * DEG), 20 * DEG);
  assert.ok(Math.abs(getSkySunAltitude(-15 * DEG) / DEG + 2.4) < 1e-9);
  assert.ok(Math.abs(getSkySunAltitude(-20 * DEG) / DEG + 7.4) < 1e-9);
  let previous = getSkySunAltitude(1 * DEG);
  for (let degrees = 0.9; degrees >= -20; degrees -= 0.1) {
    const sky = getSkySunAltitude(degrees * DEG);
    assert.ok(sky < previous && previous - sky <= 0.1 * DEG + 1e-9, `${degrees} deg`);
    previous = sky;
  }
});

test("a 17:50-18:40 KST sweep of 10 frames on 2026-10-24 never jumps", () => {
  const start = kst("2026-10-24T17:50:00").getTime();
  const step = (50 * 60000) / 9;
  let night = getNightWeight(altitudeAt(new Date(start)));
  let day = getDaylightWeight(altitudeAt(new Date(start)));
  for (let frame = 1; frame < 10; frame += 1) {
    const altitude = altitudeAt(new Date(start + frame * step));
    const nextNight = getNightWeight(altitude);
    const nextDay = getDaylightWeight(altitude);
    assert.ok(Math.abs(nextNight - night) < 0.15, `frame ${frame} night ${night} -> ${nextNight}`);
    assert.ok(Math.abs(nextDay - day) < 0.15, `frame ${frame} day ${day} -> ${nextDay}`);
    night = nextNight;
    day = nextDay;
  }
});

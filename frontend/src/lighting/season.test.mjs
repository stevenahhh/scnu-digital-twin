import assert from "node:assert/strict";
import test from "node:test";
import SunCalc from "suncalc";
import { CAMPUS_LOCATION } from "../utils/sunPosition.mjs";
import {
  AUTUMN_MATERIAL_NAMES,
  AUTUMN_PALETTE,
  SPECIES_AUTUMN_PALETTES,
  VR_CAPTURE_DATE,
  getAutumnInstanceColor,
  getAutumnInstanceMix,
  getAutumnProfile,
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

const profiles = Array.from({ length: 8000 }, (_, i) => getAutumnProfile(i));
const SUMMER = [0.3, 0.5, 0.22];
const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const saturation = (linear) => {
  const s = linear.map(toSrgb);
  return (Math.max(...s) - Math.min(...s)) / Math.max(...s);
};
// The old uniform tint: summer crown lerped 0.72 toward (0.62, 0.24, 0.05); sRGB saturation 0.543.
const OLD_ORANGE = SUMMER.map((v, i) => v + ([0.62, 0.24, 0.05][i] - v) * 0.72);

test("autumn profiles are deterministic and split into the species shares", () => {
  assert.deepEqual(getAutumnProfile(42), getAutumnProfile(42));
  const shares = Object.fromEntries(AUTUMN_PALETTE.map(({ species }) => [species, 0]));
  for (const profile of profiles) shares[profile.species] += 1 / profiles.length;
  for (const { species, share } of AUTUMN_PALETTE) {
    assert.ok(Math.abs(shares[species] - share) < 0.03, `${species}: ${shares[species]}`);
  }
  assert.ok(shares.green >= 0.3 && shares.green <= 0.4);
});

test("trees turn at different dates but are all summer-green out of season", () => {
  const oct24 = getAutumnWeight(kst("2026-10-24T12:00:00"));
  const mixes = profiles.map((profile) => getAutumnInstanceMix(oct24, profile));
  const turning = mixes.filter((mix) => mix > 0).length / mixes.length;
  assert.ok(turning > 0.2 && turning < 0.8, `turning on Oct 24: ${turning}`);
  for (const profile of profiles.slice(0, 200)) {
    assert.equal(getAutumnInstanceMix(0, profile), 0);
    assert.ok(Math.abs(getAutumnInstanceMix(1, profile) - profile.maxMix) < 1e-12);
    let previous = 0;
    for (let w = 0.05; w <= 1; w += 0.05) {
      const mix = getAutumnInstanceMix(w, profile);
      assert.ok(mix >= previous);
      previous = mix;
    }
  }
  const out = [0, 0, 0];
  assert.deepEqual(getAutumnInstanceColor(SUMMER, 0.4469, profiles[0], 0, out), SUMMER);
});

test("Nov 8 crowns mix ginkgo, zelkova and cherry colours, keep about a third green, and stay muted", () => {
  const oldSaturation = saturation(OLD_ORANGE);
  const out = [0, 0, 0];
  const ratios = { ginkgo: [], zelkova: [], cherry: [] };
  let green = 0;
  for (const profile of profiles) {
    const [r, g] = getAutumnInstanceColor(SUMMER, 0.4469, profile, 1, out);
    if (g >= r) green += 1;
    if (profile.species !== "green") ratios[profile.species].push(r / g);
    assert.ok(saturation(out) < oldSaturation, `${profile.species} ${out}`);
  }
  const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
  // Red/green ratio orders the hues: ginkgo yellow < zelkova russet < cherry red.
  assert.ok(median(ratios.ginkgo) > 1 && median(ratios.ginkgo) < median(ratios.zelkova));
  assert.ok(median(ratios.zelkova) < median(ratios.cherry));
  assert.ok(green / profiles.length > 0.3 && green / profiles.length < 0.45, `green ${green / profiles.length}`);
  for (const { colors } of AUTUMN_PALETTE) {
    for (const color of colors) assert.ok(saturation(color) < oldSaturation, `${color}`);
  }
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

test("species palettes: every autumn crown material has one, shares add up, ginkgo and metasequoia turn first", () => {
  assert.deepEqual(Object.keys(SPECIES_AUTUMN_PALETTES).sort(), [...AUTUMN_MATERIAL_NAMES].sort());
  for (const palette of Object.values(SPECIES_AUTUMN_PALETTES)) {
    assert.ok(Math.abs(palette.reduce((sum, entry) => sum + entry.share, 0) - 1) < 1e-9);
  }
  assert.ok(!SPECIES_AUTUMN_PALETTES.Tree_Crown.some((entry) => entry.species === "ginkgo"));
  const oct24 = getAutumnWeight(kst("2026-10-24T12:00:00"));
  const meanMix = (name) => {
    const list = Array.from({ length: 2000 }, (_, i) => getAutumnInstanceMix(oct24, getAutumnProfile(i, SPECIES_AUTUMN_PALETTES[name])));
    return list.reduce((sum, v) => sum + v, 0) / list.length;
  };
  assert.ok(meanMix("Tree_Ginkgo") > 2 * meanMix("Tree_Crown"), `ginkgo ${meanMix("Tree_Ginkgo")} vs broadleaf ${meanMix("Tree_Crown")}`);
  assert.ok(meanMix("Tree_Metasequoia") > meanMix("Tree_Crown"));
  for (const name of Object.keys(SPECIES_AUTUMN_PALETTES)) {
    const profile = getAutumnProfile(7, SPECIES_AUTUMN_PALETTES[name]);
    assert.equal(getAutumnInstanceMix(0, profile), 0);
    assert.ok(Math.abs(getAutumnInstanceMix(1, profile) - profile.maxMix) < 1e-12);
  }
});

test("a VR reading sets a tree's palette group, shade and mix and is reached by the VR capture date", () => {
  const palette = SPECIES_AUTUMN_PALETTES.Tree_Metasequoia;
  const yellow = getAutumnProfile(3, palette, [0, 0, 0.9]);
  const ochre = getAutumnProfile(3, palette, [0, 1, 0.9]);
  assert.deepEqual(yellow.color, palette[0].colors[0]);
  assert.deepEqual(ochre.color, palette[0].colors[1]);
  const w = getAutumnWeight(VR_CAPTURE_DATE);
  assert.ok(Math.abs(getAutumnInstanceMix(w, yellow) - 0.9) < 1e-9);
  assert.equal(getAutumnInstanceMix(0, yellow), 0);
  const cherry = getAutumnProfile(5, SPECIES_AUTUMN_PALETTES.Tree_Crown, [1, 0.5, 0.8]);
  assert.equal(cherry.species, "cherry");
});

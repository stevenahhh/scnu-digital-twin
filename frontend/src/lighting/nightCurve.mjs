// Night lighting curves by time of day (KST minute 0..1439) and sun altitude (radians).
// A modelled ambience for the 3D view, not occupancy or metered lighting data: the knots below are
// ASSUMED (lecture rooms and offices lit through the early evening, dormitories into the night).

const toDegrees = (radians) => (radians * 180) / Math.PI;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// Window share lit through the day (minute, share), linear in between and wrapped at midnight.
// 16:00-19:00 rise to the 19:00 peak, an ease to 21:00 as offices and lecture rooms empty (so 19:00 and 21:00 differ),
// then the late fall to 0.35 at 23:00 and 0.1 from 01:00; early risers bring it to 0.3 by 06:00.
const WINDOW_KNOTS = [
  [60, 0.1],
  [300, 0.1],
  [360, 0.3],
  [960, 0.3],
  [1140, 1],
  [1260, 0.75],
  [1380, 0.35],
];
// The sun gate: no window glow while the sun is above -2 deg, full schedule from -6 deg down.
const GLOW_OFF_DEGREES = -2;
const GLOW_FULL_DEGREES = -6;

const MINUTES_PER_DAY = 1440;

// The knots with the previous day's last one prepended and the next day's first one appended.
const WRAPPED_KNOTS = [
  [WINDOW_KNOTS[WINDOW_KNOTS.length - 1][0] - MINUTES_PER_DAY, WINDOW_KNOTS[WINDOW_KNOTS.length - 1][1]],
  ...WINDOW_KNOTS,
  [WINDOW_KNOTS[0][0] + MINUTES_PER_DAY, WINDOW_KNOTS[0][1]],
];

function windowScheduleAt(minuteOfDay) {
  const minute = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  let i = 1;
  while (WRAPPED_KNOTS[i][0] < minute) i += 1;
  const [m0, v0] = WRAPPED_KNOTS[i - 1];
  const [m1, v1] = WRAPPED_KNOTS[i];
  return v0 + ((v1 - v0) * (minute - m0)) / (m1 - m0);
}

// Window glow weight 0..1 (multiplies each window material's stored emissive strength).
export function windowGlowAt(minuteOfDay, sunAltitude) {
  const gate = smoothstep(GLOW_OFF_DEGREES, GLOW_FULL_DEGREES, toDegrees(sunAltitude));
  if (gate === 0) return 0;
  return gate * windowScheduleAt(minuteOfDay);
}

// getSkyNightMix is full at -12 deg, so without this every hour after nautical twilight looked the same.
// The night ambient and hemisphere fill keep darkening down to DEEP_NIGHT_DEGREES; part of the remaining
// fill stands in for the town's sky glow and follows the window schedule.
const AMBIENT_FADE_FROM_DEGREES = -12;
const DEEP_NIGHT_DEGREES = -36;
const DEEP_NIGHT_FLOOR = 0.3;
const CITY_GLOW_SHARE = 0.15;

// Multiplier 0..1 for the ambient and hemisphere light: 1 with the sun above -12 deg.
export function nightAmbientAt(minuteOfDay, sunAltitude) {
  const depth = smoothstep(AMBIENT_FADE_FROM_DEGREES, DEEP_NIGHT_DEGREES, toDegrees(sunAltitude));
  const floor = DEEP_NIGHT_FLOOR + CITY_GLOW_SHARE * windowGlowAt(minuteOfDay, sunAltitude);
  return 1 - depth * (1 - floor);
}

// Key on the R3F root scene's userData where CampusLighting publishes the KST minute of day, next to
// SUN_ALTITUDE_KEY, for CityModel's window-glow ramp.
export const MINUTE_OF_DAY_KEY = "campusMinuteOfDay";

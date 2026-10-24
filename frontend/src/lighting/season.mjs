// Season and twilight ramps for the campus scene. Pure functions; no three.js or React here.
//
// Autumn foliage (estimated, not observed): the colour change starts on Oct 20, is full from Nov 1 to
// Nov 15 (local peak about Nov 8), and is gone by Nov 25. The dates are ASSUMED from low-reliability
// aggregators; the KFS national peak forecast (Oct 30-31) is a published forecast, not a measurement.
// Dates are read on the KST calendar so the browser's own time zone does not shift the ramp.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Day numbers inside a non-leap year (Jan 1 = 0). The ramp is the same every year.
const dayOfYear = (month, day) => (Date.UTC(2025, month - 1, day) - Date.UTC(2025, 0, 1)) / DAY_MS;
const AUTUMN_START = dayOfYear(10, 20);
const AUTUMN_FULL = dayOfYear(11, 1);
const AUTUMN_FADE = dayOfYear(11, 15);
const AUTUMN_END = dayOfYear(11, 25);

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// Fractional KST day of year (Feb 29 folds onto Mar 1 so the ramp dates stay fixed).
function kstDayOfYear(date) {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const month = kst.getUTCMonth() + 1;
  const day = Math.min(kst.getUTCDate(), month === 2 ? 28 : 31);
  const dayFraction = (kst.getUTCHours() * 60 + kst.getUTCMinutes()) / (24 * 60);
  return dayOfYear(month, day) + dayFraction;
}

// 0 = summer green, 1 = full autumn colour. Smooth at both ends so a date sweep never jumps.
export function getAutumnWeight(date) {
  const day = kstDayOfYear(date);
  if (day <= AUTUMN_START || day >= AUTUMN_END) return 0;
  if (day < AUTUMN_FULL) return smoothstep(AUTUMN_START, AUTUMN_FULL, day);
  if (day <= AUTUMN_FADE) return 1;
  return 1 - smoothstep(AUTUMN_FADE, AUTUMN_END, day);
}

// Broadleaf crowns are lerped toward this linear-RGB colour (a ginkgo/zelkova orange; ASSUMED palette)
// by AUTUMN_MAX_MIX * weight. Less than 1 because campus crowns never turn uniformly: evergreens and
// late trees keep some green. Per-instance colour variation survives because it multiplies this.
export const AUTUMN_CROWN_COLOR = [0.62, 0.24, 0.05];
export const AUTUMN_MAX_MIX = 0.72;
export const AUTUMN_MATERIAL_NAMES = new Set(["Tree_Crown"]);

// Twilight bands by sun altitude in degrees: 0 / -6 / -12 / -18 are the civil, nautical and
// astronomical limits (civil dusk on 2026-10-24 at the campus is 18:12:32 KST).
export const TWILIGHT_BANDS = ["day", "civil", "nautical", "astronomical", "night"];

export function getTwilightBand(altitudeDegrees) {
  if (altitudeDegrees >= 0) return "day";
  if (altitudeDegrees >= -6) return "civil";
  if (altitudeDegrees >= -12) return "nautical";
  if (altitudeDegrees >= -18) return "astronomical";
  return "night";
}

const toDegrees = (radians) => (radians * 180) / Math.PI;

// Artificial-light weight (window glow, night colour tint): 0 with the sun up, rising through civil
// twilight, 1 by the end of nautical twilight. Piecewise linear through the band edges so it is
// continuous; the per-step change is bounded by how far the sun moves.
const NIGHT_KNOTS = [
  [2, 0],
  [0, 0.15],
  [-6, 0.75],
  [-12, 1],
];

export function getNightWeight(altitude) {
  const degrees = toDegrees(altitude);
  if (degrees >= NIGHT_KNOTS[0][0]) return 0;
  for (let i = 1; i < NIGHT_KNOTS.length; i += 1) {
    const [d1, w1] = NIGHT_KNOTS[i];
    if (degrees >= d1) {
      const [d0, w0] = NIGHT_KNOTS[i - 1];
      return w0 + ((degrees - d0) / (d1 - d0)) * (w1 - w0);
    }
  }
  return 1;
}

// Sunlight weight for the directional and ambient lights: full above 6 deg, fading through the
// horizon to the night level at -6 deg (end of civil twilight).
export function getDaylightWeight(altitude) {
  return smoothstep(-6, 6, toDegrees(altitude));
}

// three's Preetham Sky drops its sun term to zero at about -2.3 deg (cutoff angle 92.3 deg), so the sky
// would go dark within ~10 minutes of sunset. The sky (and the sky environment light) are fed this
// altitude instead: unchanged with the sun up, real 0..-15 deg squeezed into 0..-2.4 deg, then slope 1,
// so the afterglow fades over the whole of civil and nautical twilight (about 70 minutes in late October).
// Only the sky uses it; the shadow-casting light keeps the real sun.
const SKY_STRETCH_REAL_DEGREES = 15;
const SKY_STRETCH_SKY_DEGREES = 2.4;

export function getSkySunAltitude(altitude) {
  const degrees = toDegrees(altitude);
  if (degrees >= 0) return altitude;
  const sky =
    degrees >= -SKY_STRETCH_REAL_DEGREES
      ? degrees * (SKY_STRETCH_SKY_DEGREES / SKY_STRETCH_REAL_DEGREES)
      : degrees + SKY_STRETCH_REAL_DEGREES - SKY_STRETCH_SKY_DEGREES;
  return (sky * Math.PI) / 180;
}

// Key on the R3F root scene's userData where CampusLighting publishes the sun altitude (radians) that
// it lights the scene with, so CityModel's ramps follow the same sun in live and simulation modes.
export const SUN_ALTITUDE_KEY = "campusSunAltitude";

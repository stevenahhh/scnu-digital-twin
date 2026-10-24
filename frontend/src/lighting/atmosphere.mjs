// Exponential-squared fog: about 13 % at 300 units and 90 % at 1200 units.
export const CAMPUS_FOG_DENSITY = 0.00125;

const NIGHT = [0x09, 0x11, 0x1d];
const LOW_SUN = [0xe6, 0xd6, 0xc6];
const DAY = [0xd6, 0xe0, 0xe6];
const LOW_SUN_DEGREES = 6;
const DAY_DEGREES = 25;

const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => a.map((v, index) => v + (b[index] - v) * t);
const clamp01 = (value) => Math.min(1, Math.max(0, value));

// Fog colour by sun altitude (radians): night below the horizon, warm haze near it, day haze above 25 deg.
export function getFogColor(altitude) {
  const degrees = (altitude * 180) / Math.PI;
  if (degrees <= 0) return toHex(NIGHT);
  if (degrees <= LOW_SUN_DEGREES) return toHex(mix(NIGHT, LOW_SUN, degrees / LOW_SUN_DEGREES));
  return toHex(mix(LOW_SUN, DAY, clamp01((degrees - LOW_SUN_DEGREES) / (DAY_DEGREES - LOW_SUN_DEGREES))));
}

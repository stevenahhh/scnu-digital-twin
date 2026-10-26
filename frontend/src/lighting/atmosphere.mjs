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

// The night fog colour as sRGB components (0..1), for shaders that mix it in after colour-space encoding.
export const NIGHT_SKY_SRGB = NIGHT.map((v) => v / 255);

// three's Preetham Sky never goes dark: with the sun far below the horizon it still draws a purple-brown
// twilight glow, which shows as a brown band above the ridge against the navy night fog and also feeds
// the sky environment light. The dome is faded to the night fog colour as the sun sinks from 0 to
// -12 deg (end of nautical twilight), so the afterglow still shows through civil twilight.
const SKY_NIGHT_FULL_DEGREES = -12;

export function getSkyNightMix(altitude) {
  const t = clamp01(((altitude * 180) / Math.PI) / SKY_NIGHT_FULL_DEGREES);
  return t * t * (3 - 2 * t);
}

// Fog colour by sun altitude (radians): night below the horizon, warm haze near it, day haze above 25 deg.
export function getFogColor(altitude) {
  const degrees = (altitude * 180) / Math.PI;
  if (degrees <= 0) return toHex(NIGHT);
  if (degrees <= LOW_SUN_DEGREES) return toHex(mix(NIGHT, LOW_SUN, degrees / LOW_SUN_DEGREES));
  return toHex(mix(LOW_SUN, DAY, clamp01((degrees - LOW_SUN_DEGREES) / (DAY_DEGREES - LOW_SUN_DEGREES))));
}

// Darkest clear colour allowed for the canvas: the dark-theme canvas token (--colors-canvas).
export const CLEAR_COLOR_FLOOR = "#0b0c0e";
const relativeLuminance = (hex) =>
  [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);

// Canvas clear colour: the fog colour, so background, fog and far ground meet at the horizon, but never
// darker than the canvas token.
export function getClearColor(altitude) {
  const fog = getFogColor(altitude);
  return relativeLuminance(fog) < relativeLuminance(CLEAR_COLOR_FLOOR) ? CLEAR_COLOR_FLOOR : fog;
}

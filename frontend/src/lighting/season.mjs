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

export const AUTUMN_MATERIAL_NAMES = new Set(["Tree_Crown", "Tree_Ginkgo", "Tree_Metasequoia"]);

// Per-tree autumn palette (ASSUMED, an estimate - no per-tree species survey exists for the campus).
// Each broadleaf instance draws one group from a stable hash of its index. Shares loosely follow the
// Suncheon street-tree mix (cherry, ginkgo, zelkova) plus a group that stays mostly green at the
// peak: late, evergreen-broadleaf or shaded trees. Colours are muted linear-RGB crown colours (the
// final crown colour, material x instance), each a range [a, b] so trees of one group still differ;
// every colour sits at sRGB saturation 0.42-0.53, below the old single orange (0.62, 0.24, 0.05) mix.
// maxMix caps how far a tree moves from its summer colour at full weight.
export const AUTUMN_PALETTE = [
  // ginkgo yellow, sRGB about #b09c5c..#a59860
  { species: "ginkgo", share: 0.2, colors: [[0.434, 0.332, 0.107], [0.376, 0.314, 0.117]], maxMix: [0.8, 0.95] },
  // zelkova russet-brown, sRGB about #805c3e..#8e6c4a
  { species: "zelkova", share: 0.24, colors: [[0.216, 0.107, 0.048], [0.27, 0.15, 0.068]], maxMix: [0.7, 0.9] },
  // cherry dull red, sRGB about #8c5042..#7c5046
  { species: "cherry", share: 0.2, colors: [[0.262, 0.08, 0.054], [0.202, 0.08, 0.061]], maxMix: [0.65, 0.9] },
  // still green at the peak: a slight olive drift only, sRGB about #6e8044..#7a804a
  { species: "green", share: 0.36, colors: [[0.156, 0.216, 0.058], [0.195, 0.216, 0.068]], maxMix: [0.1, 0.35] },
];
// Per-material palettes of the species model (stages/trees.mjs builds one crown material per species type, read on
// the SCNU 360 VR tour; ASSUMED colours, the same muted range as above). The broadleaf crowns (Tree_Crown) are the
// zelkova, cherry and late-green trees without the ginkgo, which has its own crowns. weightScale > 1 makes a species
// turn ahead of the date ramp: in the VR tour (late October) the ginkgo and metasequoia are already half turned while
// the zelkova and cherry are mostly green.
export const SPECIES_AUTUMN_PALETTES = {
  Tree_Crown: [
    { species: "zelkova", share: 0.36, colors: AUTUMN_PALETTE[1].colors, maxMix: AUTUMN_PALETTE[1].maxMix },
    { species: "cherry", share: 0.28, colors: AUTUMN_PALETTE[2].colors, maxMix: AUTUMN_PALETTE[2].maxMix },
    { species: "green", share: 0.36, colors: AUTUMN_PALETTE[3].colors, maxMix: AUTUMN_PALETTE[3].maxMix },
  ],
  // ginkgo yellow, sRGB about #b8a03c..#ad9c48
  Tree_Ginkgo: [{ species: "ginkgo", share: 1, colors: [[0.48, 0.36, 0.045], [0.42, 0.34, 0.065]], maxMix: [0.85, 1], weightScale: 2 }],
  // metasequoia rust-ochre, sRGB about #a06c3a..#a8803e
  Tree_Metasequoia: [{ species: "metasequoia", share: 1, colors: [[0.35, 0.155, 0.042], [0.39, 0.216, 0.048]], maxMix: [0.75, 0.95], weightScale: 1.6 }],
};

// Largest per-tree lag on the season weight: a tree with phase p starts turning once the date weight
// passes p and reaches its full colour together with the others at weight 1 (ASSUMED spread).
export const AUTUMN_MAX_PHASE = 0.5;

// Stable 32-bit integer hash (lowbias32) -> three independent values in [0, 1).
function hashUnit(index, salt) {
  let x = (index * 0x9e3779b1 + salt * 0x85ebca77) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Species group, phase and colour choice of one crown instance; deterministic in its index. palette: AUTUMN_PALETTE
// (crowns of unknown species) or one of SPECIES_AUTUMN_PALETTES.
export function getAutumnProfile(index, palette = AUTUMN_PALETTE) {
  const pick = hashUnit(index, 1);
  let group = palette.length - 1;
  for (let i = 0, edge = 0; i < palette.length; i += 1) {
    edge += palette[i].share;
    if (pick < edge) {
      group = i;
      break;
    }
  }
  const entry = palette[group];
  const shade = hashUnit(index, 2);
  const [a, b] = entry.colors;
  const [mixLow, mixHigh] = entry.maxMix;
  return {
    species: entry.species,
    phase: hashUnit(index, 3) * AUTUMN_MAX_PHASE,
    color: [0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * shade),
    maxMix: mixLow + (mixHigh - mixLow) * hashUnit(index, 4),
    weightScale: entry.weightScale ?? 1,
  };
}

// How far one tree has moved toward its autumn colour for a date weight (0..1): 0 until the weight
// passes the tree's phase, its maxMix at weight 1, continuous and monotonic in the weight.
export function getAutumnInstanceMix(weight, profile) {
  const w = Math.min(1, weight * (profile.weightScale ?? 1));
  return clamp01((w - profile.phase) / (1 - profile.phase)) * profile.maxMix;
}

// Writes one tree's autumn crown colour into out (linear RGB). summer is its summer crown colour
// (material x instance); the autumn colour keeps the tree's summer brightness relative to the
// mean summer crown so per-instance light/dark variation survives the tint.
const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

export function getAutumnInstanceColor(summer, meanSummerLuminance, profile, weight, out) {
  const mix = getAutumnInstanceMix(weight, profile);
  const brightness = meanSummerLuminance > 0 ? luminance(summer) / meanSummerLuminance : 1;
  for (let c = 0; c < 3; c += 1) {
    out[c] = summer[c] + (profile.color[c] * brightness - summer[c]) * mix;
  }
  return out;
}

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

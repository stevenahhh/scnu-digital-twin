// Tree crown colour calibration. Pure functions; no three.js here.
//
// The campus model's crowns (material colour x per-instance colour, linear RGB) rendered as a light
// mint green next to the z19 orthophoto's darker canopy, and each tree drew an independent random hue
// (instance channels 0.6..1.35 apart), so neighbouring crowns flickered between yellow-green and
// blue-green. Measured at noon (Low tier, clear-sky weather) over the four compare-satellite.mjs
// windows as mean sRGB of crown pixels / mean sRGB of open ground: 0.81..0.97 in the render against
// 0.62..0.79 in the photo. The ratio is used rather than absolute values so the crowns sit right
// against the ground whatever the scene exposure is. Calibration:
// - CROWN_ALBEDO_SCALE darkens every crown colour (summer and autumn alike); at 0.6 the ratio comes
//   out at 0.66..0.81, within 0.06 of the photo in every window.
// - CROWN_INSTANCE_HUE_SPREAD pulls each tree's tint toward its own luminance, so trees still differ in
//   lightness but only a little in hue.
// Both values are fitted to that photo and are not measured leaf albedos.
// The species crowns of the campus model (stages/trees.mjs): broadleaf (Tree_Crown), ginkgo, pine, metasequoia, the
// clipped columnar conifers and the hedges all take the same calibration.
export const CROWN_MATERIAL_NAMES = new Set(["Tree_Crown", "Tree_Pine", "Tree_Ginkgo", "Tree_Metasequoia", "Tree_Conifer", "Tree_Hedge"]);
export const CROWN_ALBEDO_SCALE = 0.6;
export const CROWN_INSTANCE_HUE_SPREAD = 0.4;

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// The calibrated material colour of a crown material (linear RGB).
export function calibrateCrownMaterial([r, g, b]) {
  return [r * CROWN_ALBEDO_SCALE, g * CROWN_ALBEDO_SCALE, b * CROWN_ALBEDO_SCALE];
}

// The calibrated per-instance tint (linear RGB, multiplies the calibrated material colour): the same
// lightness as before, with the hue deviation narrowed by CROWN_INSTANCE_HUE_SPREAD.
export function calibrateCrownInstance([r, g, b], out = [0, 0, 0]) {
  const y = luminance(r, g, b);
  out[0] = y + (r - y) * CROWN_INSTANCE_HUE_SPREAD;
  out[1] = y + (g - y) * CROWN_INSTANCE_HUE_SPREAD;
  out[2] = y + (b - y) * CROWN_INSTANCE_HUE_SPREAD;
  return out;
}

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
// clipped columnar conifers, the hedges and the scrub mounds all take the same calibration.
export const CROWN_MATERIAL_NAMES = new Set(["Tree_Crown", "Tree_Pine", "Tree_Ginkgo", "Tree_Metasequoia", "Tree_Conifer", "Tree_Hedge", "Tree_Shrub"]);
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

// ---- foliage cards (generator stages/trees.mjs: Trees_<kind>_foliage, materials Tree_Foliage_<kind> with
// extras.crownMaterial naming the crown material whose calibration and autumn palette they share).
export const crownMaterialName = (material) => material?.userData?.crownMaterial ?? material?.name;
// Crowns that carry foliage cards: near the camera they shrink to a core under the cards and they cast no shadow (the
// alpha-tested cards cast the tree's shadow instead).
export const FOLIAGE_CROWN_PATTERN = /^Trees_(ginkgo|broadleaf|pine|metasequoia|conifer|canopy)_crown$/;
// Distance LOD in scene units (0.6242 per metre): the cards fade out (collapse per instance) between start and end,
// about 136-152 m, and the crown grows from FOLIAGE_CORE x its width back to its full fitted width over the same band.
export const FOLIAGE_LOD = Object.freeze({ start: 85, end: 95, core: 0.6 });
// Stable per-species salt for the hashed autumn profile, so a tree's crown and its cards draw the same colour.
export function autumnSalt(nodeName) {
  const key = String(nodeName ?? "").replace(/_(crown|foliage)$/, "");
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return h % 1000003;
}
// Vertex shader patch for three's MeshStandardMaterial (onBeforeCompile): mode "cards" collapses each instance beyond
// the LOD band, mode "core" narrows the crown inside it. The instance origin's distance to the camera decides.
export function patchFoliageLod(shader, mode, lod = FOLIAGE_LOD) {
  const f = (v) => v.toFixed(3);
  const apply = mode === "cards"
    ? `transformed *= 1.0 - smoothstep(${f(lod.start)}, ${f(lod.end)}, lodDist);`
    : `transformed.xz *= mix(${f(lod.core)}, 1.0, smoothstep(${f(lod.start)}, ${f(lod.end)}, lodDist));`;
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec4 lodOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#else
  vec4 lodOrigin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#endif
  float lodDist = distance(lodOrigin.xyz, cameraPosition);
  ${apply}`,
  );
  return shader;
}

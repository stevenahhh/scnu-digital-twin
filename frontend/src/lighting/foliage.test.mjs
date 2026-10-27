import assert from "node:assert/strict";
import test from "node:test";
import {
  CROWN_ALBEDO_SCALE,
  CROWN_INSTANCE_HUE_SPREAD,
  CROWN_MATERIAL_NAMES,
  calibrateCrownInstance,
  calibrateCrownMaterial,
} from "./foliage.mjs";

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const near = (a, b) => Math.abs(a - b) < 1e-12;

test("crown calibration covers every species crown and the hedges", () => {
  assert.deepEqual([...CROWN_MATERIAL_NAMES].sort(), ["Tree_Conifer", "Tree_Crown", "Tree_Ginkgo", "Tree_Hedge", "Tree_Metasequoia", "Tree_Pine", "Tree_Shrub"]);
});

test("calibrated crown materials keep their hue and are darkened by the albedo scale", () => {
  const out = calibrateCrownMaterial([0.3, 0.5, 0.22]);
  assert.ok(CROWN_ALBEDO_SCALE > 0 && CROWN_ALBEDO_SCALE < 1);
  assert.ok(near(out[0] / out[1], 0.3 / 0.5) && near(out[2] / out[1], 0.22 / 0.5));
  assert.ok(near(luminance(out), luminance([0.3, 0.5, 0.22]) * CROWN_ALBEDO_SCALE));
});

test("instance tints keep each tree's lightness and narrow its hue deviation", () => {
  const tint = [1.3, 0.7, 0.65];
  const out = [9, 9, 9];
  assert.equal(calibrateCrownInstance(tint, out), out);
  assert.ok(near(luminance(out), luminance(tint)));
  const y = luminance(tint);
  for (let c = 0; c < 3; c += 1) assert.ok(near(out[c] - y, (tint[c] - y) * CROWN_INSTANCE_HUE_SPREAD));
  assert.ok(CROWN_INSTANCE_HUE_SPREAD > 0 && CROWN_INSTANCE_HUE_SPREAD < 1);
});

test("a neutral instance tint is unchanged", () => {
  const out = calibrateCrownInstance([0.9, 0.9, 0.9]);
  for (const value of out) assert.ok(near(value, 0.9));
});

test("foliage cards share their crown's calibration and autumn salt, and the LOD patch hides cards / narrows crowns", async () => {
  const { autumnSalt, crownMaterialName, FOLIAGE_CROWN_PATTERN, FOLIAGE_LOD, patchFoliageLod } = await import("./foliage.mjs");
  assert.equal(crownMaterialName({ name: "Tree_Foliage_ginkgo", userData: { crownMaterial: "Tree_Ginkgo" } }), "Tree_Ginkgo");
  assert.equal(crownMaterialName({ name: "Tree_Pine", userData: {} }), "Tree_Pine");
  assert.equal(autumnSalt("Trees_ginkgo_crown"), autumnSalt("Trees_ginkgo_foliage"));
  assert.notEqual(autumnSalt("Trees_ginkgo_crown"), autumnSalt("Trees_canopy_crown"));
  assert.ok(FOLIAGE_CROWN_PATTERN.test("Trees_canopy_crown") && !FOLIAGE_CROWN_PATTERN.test("Trees_hedge_crown"));
  assert.ok(FOLIAGE_LOD.start < FOLIAGE_LOD.end && FOLIAGE_LOD.end * 1.602 > 145 && FOLIAGE_LOD.end * 1.602 < 160);
  const cards = patchFoliageLod({ vertexShader: "a\n#include <begin_vertex>\nb" }, "cards").vertexShader;
  assert.match(cards, /transformed \*= 1\.0 - smoothstep\(85\.000, 95\.000, lodDist\)/);
  const core = patchFoliageLod({ vertexShader: "#include <begin_vertex>" }, "core").vertexShader;
  assert.match(core, /transformed\.xz \*= mix\(0\.800, 1\.0/);
});

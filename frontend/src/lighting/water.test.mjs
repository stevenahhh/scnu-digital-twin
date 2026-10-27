import assert from "node:assert/strict";
import test from "node:test";
import { WATER_ALPHA, WATER_ENV_INTENSITY, WATER_MATERIAL_NAME, patchWaterFresnel } from "./water.mjs";

test("pool water: see-through looking down, nearly opaque at grazing angles", () => {
  assert.equal(WATER_MATERIAL_NAME, "Furniture_Water");
  assert.ok(WATER_ALPHA.down < WATER_ALPHA.grazing && WATER_ALPHA.grazing <= 1);
  assert.ok(WATER_ENV_INTENSITY > 1);
  const { fragmentShader } = patchWaterFresnel({ fragmentShader: "a\n#include <normal_fragment_maps>\nb" });
  assert.match(fragmentShader, /#include <normal_fragment_maps>\n {2}float waterFacing/);
  assert.match(fragmentShader, /diffuseColor\.a = mix\(0\.700, 0\.950, pow\(1\.0 - waterFacing, 3\.0\)\)/);
});

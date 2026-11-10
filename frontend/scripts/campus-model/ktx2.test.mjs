import assert from "node:assert/strict";
import test from "node:test";
import { basisuArgs } from "./ktx2.mjs";

test("colour textures are ETC1S with sRGB metrics, data textures ETC1S linear", () => {
  assert.deepEqual(basisuArgs(["baseColorTexture"]), ["-ktx2", "-mipmap", "-etc1s"]);
  assert.deepEqual(basisuArgs(["baseColorTexture", "emissiveTexture"]), ["-ktx2", "-mipmap", "-etc1s"]);
  assert.deepEqual(basisuArgs(["occlusionTexture"]), ["-ktx2", "-mipmap", "-etc1s", "-linear"]);
  assert.deepEqual(basisuArgs(["metallicRoughnessTexture"]), ["-ktx2", "-mipmap", "-etc1s", "-linear"]);
});

test("normal maps are ETC1S by default and UASTC on request", () => {
  assert.deepEqual(basisuArgs(["normalTexture"]), ["-ktx2", "-mipmap", "-etc1s", "-linear", "-normal_map"]);
  assert.deepEqual(basisuArgs(["normalTexture"], { normals: "uastc" }), ["-ktx2", "-mipmap", "-uastc", "-uastc_rdo_l", "2", "-linear", "-normal_map"]);
});

// All-UASTC D4 maps made campus-v2.glb 162 MB, over GitHub's 100 MB file limit: colour and data maps are
// max-quality ETC1S, normal maps (where ETC1S blocks show as facets) stay UASTC.
test("D4 normal maps use UASTC and other D4 maps max-quality ETC1S without changing campus defaults", () => {
  assert.deepEqual(basisuArgs(["baseColorTexture"], { d4: true }), ["-ktx2", "-mipmap", "-etc1s", "-q", "255"]);
  assert.deepEqual(basisuArgs(["metallicRoughnessTexture"], { d4: true }), ["-ktx2", "-mipmap", "-etc1s", "-q", "255", "-linear"]);
  assert.deepEqual(basisuArgs(["baseColorTexture"]), ["-ktx2", "-mipmap", "-etc1s"]);
  assert.deepEqual(basisuArgs(["normalTexture"], { d4: true }), ["-ktx2", "-mipmap", "-uastc", "-uastc_rdo_l", "2", "-linear", "-normal_map"]);
});

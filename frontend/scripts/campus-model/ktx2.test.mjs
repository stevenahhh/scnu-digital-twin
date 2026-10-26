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

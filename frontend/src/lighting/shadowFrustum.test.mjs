import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { campusModelCenter } from "../simulation/utils/campusTrafficCoordinates.mjs";
import { getSunVector } from "../utils/sunPosition.mjs";
import {
  SHADOW_CAMERA_BOUNDS,
  SHADOW_CAMERA_FAR,
  SHADOW_LIGHT_DISTANCE,
  getShadowCameraBounds,
  getShadowMapSize,
  isInsideShadowCamera,
  toShadowCameraSpace,
} from "./shadowFrustum.mjs";

const DEG = Math.PI / 180;

// glTF normalized integer -> float, per component type (5120 byte, 5121 ubyte, 5122 short, 5123 ushort).
const NORMALIZE = { 5120: (v) => Math.max(v / 127, -1), 5121: (v) => v / 255, 5122: (v) => Math.max(v / 32767, -1), 5123: (v) => v / 65535 };

// Every primitive of campus-v2.glb becomes one THREE.Mesh, so its POSITION box centre is a mesh
// centre. The packed file stores KHR_mesh_quantization POSITIONs whose dequantization lives in the
// node's translation/scale (as in campusModelAsset.test.mjs), so boxes are dequantized and mapped
// through them. CityModel moves the model by -campusModelCenter, so the light's target is that origin.
async function readCampusMeshCentres() {
  const file = await readFile(new URL("../../public/campus-v2.glb", import.meta.url));
  const json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString("utf8"));
  const boxOf = (node, primitive) => {
    const accessor = json.accessors[primitive.attributes.POSITION];
    const decode = accessor.normalized ? NORMALIZE[accessor.componentType] : (v) => v;
    const translation = new THREE.Vector3(...(node.translation ?? [0, 0, 0]));
    const scale = new THREE.Vector3(...(node.scale ?? [1, 1, 1]));
    const box = new THREE.Box3();
    for (const corner of [accessor.min, accessor.max]) {
      box.expandByPoint(new THREE.Vector3(...corner.map(decode)).multiply(scale).add(translation));
    }
    return box;
  };
  const nodeBox = (node) => json.meshes[node.mesh].primitives.reduce((box, primitive) => box.union(boxOf(node, primitive)), new THREE.Box3());
  const d4 = nodeBox(json.nodes.find((node) => node.name === "BLD_D4")).getCenter(new THREE.Vector3());
  const center = campusModelCenter([d4.x, d4.y, d4.z]);
  return json.nodes
    .filter((node) => node.mesh !== undefined)
    .flatMap((node) => json.meshes[node.mesh].primitives.map((primitive) => boxOf(node, primitive)))
    .map((box) => {
      const c = box.getCenter(new THREE.Vector3());
      return [c.x - center.x, c.y, c.z - center.z];
    });
}

test("the shadow camera half-size covers the half-diagonal of the 510 x 383 campus box", () => {
  assert.deepEqual(SHADOW_CAMERA_BOUNDS, { left: -320, right: 320, top: 320, bottom: -320, near: 1, far: 1400 });
  assert.equal(getShadowCameraBounds({ width: 100, depth: 0, margin: 0 }).right, 50);
  assert.ok(SHADOW_LIGHT_DISTANCE > SHADOW_CAMERA_BOUNDS.right, "light sits inside the campus");
  assert.ok(SHADOW_CAMERA_FAR >= SHADOW_LIGHT_DISTANCE + SHADOW_CAMERA_BOUNDS.right, "far plane cuts the campus");
});

test("camera space matches Object3D.lookAt from the light toward the origin", () => {
  const light = getSunVector({ altitude: 40 * DEG, azimuth: 70 * DEG, distance: SHADOW_LIGHT_DISTANCE });
  const camera = new THREE.OrthographicCamera();
  camera.position.set(...light);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const point = [120, 30, -80];
  const view = new THREE.Vector3(...point).applyMatrix4(camera.matrixWorldInverse);
  const mine = toShadowCameraSpace(point, light);
  assert.ok(Math.abs(mine.x - view.x) < 1e-6 && Math.abs(mine.y - view.y) < 1e-6 && Math.abs(mine.depth + view.z) < 1e-6);
});

test("every campus mesh centre is inside the shadow camera for azimuths 0, 45, 90 and 135 deg", async () => {
  const centres = await readCampusMeshCentres();
  assert.ok(centres.length >= 145, `expected the campus meshes, got ${centres.length}`);
  // 13.6 deg is the winter 09:00 KST sun (longest shadows); 75 deg is near the summer noon sun.
  for (const altitudeDegrees of [13.6, 45, 75]) {
    for (const azimuthDegrees of [0, 45, 90, 135]) {
      const light = getSunVector({ altitude: altitudeDegrees * DEG, azimuth: azimuthDegrees * DEG, distance: SHADOW_LIGHT_DISTANCE });
      const outside = centres.filter((point) => !isInsideShadowCamera(point, light));
      assert.equal(outside.length, 0, `${outside.length}/${centres.length} centres outside at alt ${altitudeDegrees}, az ${azimuthDegrees}`);
    }
  }
});

test("desktop GPUs get a 4096 shadow map, mobile and small-texture GPUs 2048", () => {
  assert.equal(getShadowMapSize({ maxTextureSize: 16384, isMobile: false }), 4096);
  assert.equal(getShadowMapSize({ maxTextureSize: 16384, isMobile: true }), 2048);
  assert.equal(getShadowMapSize({ maxTextureSize: 2048, isMobile: false }), 2048);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { campusModelCenter } from "./campusTrafficCoordinates.mjs";

// Building centers the simulation network was built against (backend/build_mobility_data.py BUILDING_TARGETS),
// in the Legacy display frame: uni.glb bounding-box centers after CityModel recenters the model.
const DISPLAY_TARGETS = {
  BLD_D4: [-214.35, -93.25],
  BLD_D3: [-161.23, -68.59],
  BLD_D2: [-129.92, -119.53],
  BLD_C1: [-61.76, -92.11],
  BLD_E1: [-29.27, -11.69],
  BLD_A1: [42.21, 38.64],
};

async function loadCampusScene() {
  const file = await readFile(new URL("../../../public/uni.glb", import.meta.url));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  return gltf.scene;
}

test("recentering on the BLD_D4 anchor puts every simulation reference building on its uni.glb building", async () => {
  const scene = await loadCampusScene();
  const centerOf = (name) => new THREE.Box3().setFromObject(scene.getObjectByName(name)).getCenter(new THREE.Vector3());
  const d4 = centerOf("BLD_D4");
  const center = campusModelCenter([d4.x, d4.y, d4.z]);

  for (const [id, [x, z]] of Object.entries(DISPLAY_TARGETS)) {
    const building = centerOf(id);
    const error = Math.hypot(building.x - center.x - x, building.z - center.z - z);
    assert.ok(error < 0.05, `${id} is ${error.toFixed(2)} scene units away from the simulation frame`);
  }
});

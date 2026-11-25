import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  CAMPUS_TRAFFIC_COORDINATE_CONFIG,
  D4_LABEL_OFFSET_V2,
  D4_LABEL_TARGET,
  campusModelCenter,
} from "./campusTrafficCoordinates.mjs";
import { D4_ANCHOR_TM, tmToScene } from "../../geo/epsg5186.mjs";

const repoFile = (relative) => new URL(`../../../../${relative}`, import.meta.url);
// GIS BLD_D4 footprint bbox centre (data/bld-node-map.json, record 133154), the Frame v2 BLD_D4 position.
const GIS_D4_CENTRE_TM = [243507.55, 263879.65];

// Building centers the simulation network was built against (backend/build_mobility_data.py BUILDING_TARGETS),
// in the Main display frame: Frame v1 bounding-box centers after CityModel recenters D4_ANCHOR onto the Frame v2
// traffic origin (the v1 values moved by the origin shift, so their simulation positions are unchanged).
const DISPLAY_TARGETS = {
  BLD_D4: [-215.27, -91.24],
  BLD_D3: [-162.15, -66.58],
  BLD_D2: [-130.84, -117.52],
  BLD_C1: [-62.68, -90.1],
  BLD_E1: [-30.19, -9.68],
  BLD_A1: [41.29, 40.65],
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

test("the JS traffic origin equals coordinate_transform.json and build_mobility_data.py", async () => {
  const json = JSON.parse(await readFile(repoFile("backend/simulation/data/coordinate_transform.json"), "utf8"));
  const { origin, scale } = CAMPUS_TRAFFIC_COORDINATE_CONFIG;
  for (const axis of ["x", "y", "z"]) {
    assert.ok(Math.abs(json.origin[axis] - origin[axis]) < 1e-9, `coordinate_transform.json origin.${axis} ${json.origin[axis]} != ${origin[axis]}`);
  }
  assert.ok(Math.abs(json.scale - scale) < 1e-9, `coordinate_transform.json scale ${json.scale}`);
  const py = await readFile(repoFile("backend/build_mobility_data.py"), "utf8");
  const [, x, z] = py.match(/^DISPLAY_ORIGIN = \((-?[\d.]+), (-?[\d.]+)\)/m);
  assert.deepEqual([Number(x), Number(z)], [origin.x, origin.z], "build_mobility_data.py DISPLAY_ORIGIN");
  for (const [id, [dx, dz]] of Object.entries(DISPLAY_TARGETS)) {
    const m = py.match(new RegExp(`"${id}": \\{[^}]*"display": \\((-?[\\d.]+), (-?[\\d.]+)\\)`));
    assert.deepEqual([Number(m[1]), Number(m[2])], [dx, dz], `build_mobility_data.py ${id} display`);
  }
});

test("Frame v2: D4_ANCHOR projects onto the traffic origin and the BLD_D4 label onto D4_LABEL_TARGET", () => {
  const anchor = tmToScene(...D4_ANCHOR_TM);
  const gisD4 = tmToScene(...GIS_D4_CENTRE_TM);
  assert.ok(Math.abs(gisD4[0] - anchor[0] - D4_LABEL_OFFSET_V2.x) < 1e-3, "D4_LABEL_OFFSET_V2.x");
  assert.ok(Math.abs(gisD4[1] - anchor[1] - D4_LABEL_OFFSET_V2.z) < 1e-3, "D4_LABEL_OFFSET_V2.z");
  const center = campusModelCenter([gisD4[0], 0, gisD4[1]], { frameVersion: 2 });
  const { origin } = CAMPUS_TRAFFIC_COORDINATE_CONFIG;
  assert.ok(Math.hypot(anchor[0] - center.x - origin.x, anchor[1] - center.z - origin.z) < 2e-3, "D4_ANCHOR off the origin");
  assert.ok(Math.hypot(gisD4[0] - center.x - D4_LABEL_TARGET.x, gisD4[1] - center.z - D4_LABEL_TARGET.z) < 1e-9, "label target");
  // v1 assets (no frameVersion) keep the old rule: the BLD_D4 label lands on the origin.
  const v1 = campusModelCenter([10, 0, 20]);
  assert.deepEqual(v1, { x: 10 - origin.x, z: 20 - origin.z });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CAMPUS_MODEL_URLS, resolveCampusModelUrl } from "./campusModelAsset.mjs";
import { campusModelCenter } from "./simulation/utils/campusTrafficCoordinates.mjs";

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);

// campus-v2.glb nodes carry no transforms (geometry is written in scene space), so a node's bounding
// box is the union of its primitives' POSITION min/max. Reading the JSON chunk avoids decoding the
// embedded JPEG textures, which node cannot do.
async function readGlbJson(name) {
  const file = await readFile(publicFile(name));
  return JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString("utf8"));
}

function nodeBox(json, node) {
  const box = new THREE.Box3();
  for (const primitive of json.meshes[node.mesh].primitives) {
    const accessor = json.accessors[primitive.attributes.POSITION];
    box.expandByPoint(new THREE.Vector3(...accessor.min));
    box.expandByPoint(new THREE.Vector3(...accessor.max));
  }
  return box;
}

async function loadUniScene() {
  const file = await readFile(publicFile("uni.glb"));
  const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "");
  return gltf.scene;
}

test("the dashboard loads the generated model unless ?model=uni asks for the original", () => {
  assert.equal(resolveCampusModelUrl(""), CAMPUS_MODEL_URLS.detailed);
  assert.equal(resolveCampusModelUrl("?model=uni"), CAMPUS_MODEL_URLS.original);
  assert.equal(resolveCampusModelUrl("?model=original"), CAMPUS_MODEL_URLS.original);
  assert.equal(resolveCampusModelUrl("?model=unknown"), CAMPUS_MODEL_URLS.detailed);
});

test("campus-v2.glb keeps every uni.glb building id and the Topography the traffic layer raycasts", async () => {
  const [uni, campus] = await Promise.all([readGlbJson("uni.glb"), readGlbJson("campus-v2.glb")]);
  const rootNames = new Set(campus.scenes[0].nodes.map((index) => campus.nodes[index].name));
  const uniBuildings = uni.scenes[0].nodes.map((index) => uni.nodes[index].name).filter((name) => name.startsWith("BLD_"));
  assert.ok(uniBuildings.length > 20);
  for (const name of uniBuildings) assert.ok(rootNames.has(name), `${name} is missing from campus-v2.glb`);
  const topography = campus.nodes.find((node) => node.name === "Topography");
  assert.ok(topography?.children?.length > 0, "Topography has no terrain chunks");
});

test("campus-v2.glb sits on the traffic simulation frame like uni.glb", async () => {
  const [uniScene, campus] = await Promise.all([loadUniScene(), readGlbJson("campus-v2.glb")]);
  const campusCenterOf = (name) => nodeBox(campus, campus.nodes.find((node) => node.name === name)).getCenter(new THREE.Vector3());
  const uniCenterOf = (name) => new THREE.Box3().setFromObject(uniScene.getObjectByName(name)).getCenter(new THREE.Vector3());

  // CityModel recenters on the BLD_D4 anchor; it must not move, or vehicles leave their roads.
  const d4 = campusCenterOf("BLD_D4");
  const uniD4 = uniCenterOf("BLD_D4");
  assert.ok(Math.hypot(d4.x - uniD4.x, d4.z - uniD4.z) < 0.05, "BLD_D4 moved");

  // Rebuilt footprints come from VWorld, so other buildings may differ slightly from uni.glb's outlines.
  const center = campusModelCenter([d4.x, d4.y, d4.z]);
  const uniCenter = campusModelCenter([uniD4.x, uniD4.y, uniD4.z]);
  for (const id of ["BLD_D3", "BLD_D2", "BLD_C1", "BLD_E1", "BLD_A1", "BLD_B7"]) {
    const rebuilt = campusCenterOf(id);
    const original = uniCenterOf(id);
    const error = Math.hypot(rebuilt.x - center.x - (original.x - uniCenter.x), rebuilt.z - center.z - (original.z - uniCenter.z));
    assert.ok(error < 3, `${id} is ${error.toFixed(2)} scene units from its uni.glb position`);
  }
});

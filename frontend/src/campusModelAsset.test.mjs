import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CAMPUS_MODEL_URLS, resolveCampusModelUrl } from "./campusModelAsset.mjs";
import { campusModelCenter } from "./simulation/utils/campusTrafficCoordinates.mjs";

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);

// campus-v2.glb is meshopt-packed with KHR_mesh_quantization: POSITION accessors may be normalized
// integers whose dequantization lives in the node's translation/scale (no rotations, no parents for
// BLD_* roots). A node's bounding box is therefore its primitives' POSITION min/max, dequantized and
// mapped through that translation/scale. Reading the JSON chunk avoids decoding the meshopt buffers
// and embedded textures, which node cannot do.
// Top-level objects: the scene roots, with the generator's collection nodes (extras.collection, lib/glb.mjs groupRoots)
// expanded into their children.
function topLevelNodes(gltf) {
  const out = [];
  const visit = (index) => {
    const node = gltf.nodes[index];
    if (node.extras?.collection) (node.children ?? []).forEach(visit);
    else out.push(node);
  };
  gltf.scenes[0].nodes.forEach(visit);
  return out;
}

async function readGlbJson(name) {
  const file = await readFile(publicFile(name));
  return JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString("utf8"));
}

// glTF normalized integer -> float, per component type (5120 byte, 5121 ubyte, 5122 short, 5123 ushort).
const NORMALIZE = { 5120: (v) => Math.max(v / 127, -1), 5121: (v) => v / 255, 5122: (v) => Math.max(v / 32767, -1), 5123: (v) => v / 65535 };

function nodeBox(json, node) {
  assert.equal(node.rotation, undefined, `${node.name} has a rotation nodeBox does not apply`);
  assert.equal(node.matrix, undefined, `${node.name} has a matrix nodeBox does not apply`);
  const translation = new THREE.Vector3(...(node.translation ?? [0, 0, 0]));
  const scale = new THREE.Vector3(...(node.scale ?? [1, 1, 1]));
  const box = new THREE.Box3();
  for (const primitive of json.meshes[node.mesh].primitives) {
    const accessor = json.accessors[primitive.attributes.POSITION];
    const decode = accessor.normalized ? NORMALIZE[accessor.componentType] : (v) => v;
    for (const corner of [accessor.min, accessor.max]) {
      box.expandByPoint(new THREE.Vector3(...corner.map(decode)).multiply(scale).add(translation));
    }
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
  const rootNames = new Set(topLevelNodes(campus).map((node) => node.name));
  const uniBuildings = uni.scenes[0].nodes.map((index) => uni.nodes[index].name).filter((name) => name.startsWith("BLD_"));
  assert.ok(uniBuildings.length > 20);
  for (const name of uniBuildings) assert.ok(rootNames.has(name), `${name} is missing from campus-v2.glb`);
  const topography = campus.nodes.find((node) => node.name === "Topography");
  assert.ok(topography?.children?.length > 0, "Topography has no terrain chunks");
});

test("campus-v2.glb gives every named SCNU campus building a labelled pick proxy with its own id", async () => {
  const [uni, campus, elements] = await Promise.all([
    readGlbJson("uni.glb"),
    readGlbJson("campus-v2.glb"),
    readFile(new URL("../../common/data/common_elemetns.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const taken = new Set([
    ...uni.nodes.map((node) => node.name).filter((name) => name?.startsWith("BLD_")),
    ...elements.elements.map((element) => element.element_id),
  ]);
  const rootNames = topLevelNodes(campus).map((node) => node.name);
  const proxies = campus.nodes.filter((node) => node.name.startsWith("BLD_SCNU_"));
  // 17 since 2026-10-29: the 14 annexes and greenhouses missing from the VR tour were removed (scnu-building-names.json status removed)
  assert.ok(proxies.length >= 17, `only ${proxies.length} BLD_SCNU_* nodes`);
  for (const record of [687709, 687746, 687750, 687777, 687828, 688041, 688059, 688401, 688403, 688981, 690033, 690034, 690076, 768570]) {
    assert.ok(!campus.nodes.some((node) => node.name === `BLD_SCNU_R${record}`), `removed building BLD_SCNU_R${record} is back`);
  }
  assert.equal(new Set(proxies.map((node) => node.name)).size, proxies.length, "duplicate BLD_SCNU_* ids");
  for (const node of proxies) {
    assert.ok(!taken.has(node.name), `${node.name} collides with an existing BLD_* id`);
    assert.ok(rootNames.includes(node.name), `${node.name} is not a scene root`);
    assert.equal(node.extras?.pickProxy, true, `${node.name} is not marked pickProxy`);
    assert.ok(node.extras?.label && !node.extras.label.startsWith("순천대학교"), `${node.name} has no display label`);
    assert.ok(node.extras?.nameSource, `${node.name} has no nameSource`);
    if (node.extras.nameSource.startsWith("estimated")) assert.match(node.extras.label, /\(추정\)$/, `${node.name} estimate is not labelled`);
  }
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

test("campus-v2.glb stands every VR-only building of vr-buildings.json, with estimated footprint and height lineage", async () => {
  const [campus, vr] = await Promise.all([
    readGlbJson("campus-v2.glb"),
    readFile(new URL("../scripts/campus-model/data/vr-buildings.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const roots = topLevelNodes(campus);
  assert.ok(vr.buildings.length > 0, "vr-buildings.json has no record");
  for (const record of vr.buildings) {
    const proxy = roots.find((node) => node.name === record.nodeId);
    if (proxy) {
      assert.equal(proxy.extras?.pickProxy, true, `${record.nodeId} is not marked pickProxy`);
      assert.equal(proxy.extras?.footprintEstimated, true, `${record.nodeId} footprint is not marked estimated`);
      assert.equal(proxy.extras?.label, record.label, `${record.nodeId} label`);
      assert.ok(proxy.extras?.heightLineage, `${record.nodeId} has no heightLineage`);
      continue;
    }
    // A record whose outline holds a uni.glb building is matched into that node (README "VR-only buildings").
    const host = roots.find((node) => node.name.startsWith("BLD_") && node.extras?.displayName === record.name);
    assert.ok(host, `${record.nodeId} (${record.name}) is neither a proxy nor matched into a uni.glb node`);
    assert.ok(host.extras.heightLineage, `${host.name} has no heightLineage`);
  }
  const furniture = roots.find((node) => node.name === "Furniture");
  assert.deepEqual(furniture?.extras?.counts?.gate_sign, { surveyed: 0, estimated: 1 }, "the A19 gate sign is not built exactly once");
});

test("campus-v2.glb trees are low poly only: no leaf cards, no alpha-tested tree material, every archetype at most 500 triangles", async () => {
  const campus = await readGlbJson("campus-v2.glb");
  const treeNodes = campus.nodes.filter((node) => node.name?.startsWith("Trees_"));
  assert.ok(treeNodes.length > 0, "no Trees_* nodes");
  for (const node of treeNodes) {
    assert.ok(!/_foliage$/.test(node.name), `${node.name} is a leaf-card node`);
    if (node.mesh === undefined) continue;
    for (const primitive of campus.meshes[node.mesh].primitives) {
      const material = campus.materials[primitive.material];
      assert.notEqual(material?.alphaMode, "MASK", `${node.name} uses an alpha-tested material ${material?.name}`);
      const triangles = (primitive.indices !== undefined ? campus.accessors[primitive.indices].count : campus.accessors[primitive.attributes.POSITION].count) / 3;
      assert.ok(triangles <= 500, `${node.name} archetype has ${triangles} triangles`);
    }
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { bearingToDirection, columnToAngle, faceYaw, groundTargets, modelWorldOffset, stationWorld, terrainHeight } from "./lib/vrCamera.mjs";

test("faceYaw turns the scene yaw into the four horizontal face bearings", () => {
  assert.equal(faceYaw(306.9, "f"), 306.9);
  assert.equal(faceYaw(306.9, "r"), 36.9);
  assert.equal(faceYaw(306.9, "b"), 126.9);
  assert.equal(faceYaw(306.9, "l"), 216.9);
  assert.throws(() => faceYaw(306.9, "u"), /no horizontal bearing/);
});

test("bearingToDirection maps compass bearings to +x east, +z south", () => {
  assert.deepEqual(bearingToDirection(90), [1, 0, 0]);
  assert.deepEqual(bearingToDirection(180), [0, 0, 1]);
  assert.deepEqual(bearingToDirection(0), [0, 0, -1]);
});

test("columnToAngle follows column = 1024 + 1024 tan(a)", () => {
  assert.equal(columnToAngle(1024), 0);
  assert.equal(columnToAngle(2048), 45);
  assert.equal(columnToAngle(0), -45);
});

test("stationWorld adds the runtime offset and prefers refined positions", () => {
  assert.deepEqual(stationWorld({ station_x: 73.69, station_z: -266.37 }, { x: -10, z: 5 }), { x: 63.69, z: -261.37 });
  assert.deepEqual(
    stationWorld({ station_x: 1, station_z: 2, station_refined_x: 3, station_refined_z: 4 }, { x: 0, z: 0 }),
    { x: 3, z: 4 },
  );
});

test("partitioned road and paving meshes fill terrain holes for station placement", () => {
  const meshes = ["Topography_joined", "Ground_Asphalt", "Ground_Pavers", "Road_Markings", "OuterTerrain", "Context_Far_Ground_0", "BLD_E3"]
    .map(name => ({ name, isMesh: true }));
  const scene = { traverse: visit => meshes.forEach(visit) };
  assert.deepEqual(groundTargets(scene).map(o => o.name), meshes.slice(0, 6).map(o => o.name));
});

test("station offset comes from the model transform rather than a shifted D4 mass bbox", () => {
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -260.5357, 0, 173.3459, 1];
  assert.deepEqual(modelWorldOffset(matrix), { x: -260.5357, z: 173.3459 });
  assert.throws(() => modelWorldOffset([2, ...matrix.slice(1)]), /translation/);
});

test("terrain ray hits partitioned ground on runtime render layer one", () => {
  const scene = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial());
  ground.name = "Ground_Asphalt_1";
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 12;
  ground.layers.set(1);
  scene.add(ground);
  const state = { scene, camera: new THREE.PerspectiveCamera(), raycaster: new THREE.Raycaster() };
  assert.ok(Math.abs(terrainHeight(state, [0, 0]) - 12) < 1e-6);
  ground.geometry.dispose();
  ground.material.dispose();
});

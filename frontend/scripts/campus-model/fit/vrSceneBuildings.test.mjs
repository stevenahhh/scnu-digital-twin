import assert from "node:assert/strict";
import test from "node:test";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { firstBuildingHit, sceneBuildingMap, checkSceneRefs } from "./vrSceneBuildings.mjs";

const E = 244000, N = 263800;
const [x, z] = tmToScene(E, N);
const station = { scene: "scene_e5", frame_version: 2, station_refined_x: x, station_refined_z: z, yaw_refined_deg: 270 };
const buildings = [
  { id: "BLD_E5", walls: [{ id: "BLD_E5/W00", a: [E + 10, N + 40], b: [E - 10, N + 40] }] },
  { id: "BLD_E3", walls: [{ id: "BLD_E3/W00", a: [E + 10, N + 20], b: [E - 10, N + 20] }] },
];

test("scene_e5 right-face ray selects the nearest GIS E3 wall, not the scene name", () => {
  const hit = firstBuildingHit(station, { face: "r", col: 1024 }, buildings);
  assert.equal(hit.building, "BLD_E3");
  assert.equal(hit.wall, "BLD_E3/W00");
  assert.equal(hit.distanceM, 20);
});

test("scene table is face-specific and unrefined scenes remain T4", () => {
  const table = sceneBuildingMap([station, { scene: "scene_d4", frame_version: 2, yaw_refined_deg: 12 }], buildings);
  assert.equal(table.scenes[0].faces.r.find(h => h.col === 1024).building, "BLD_E3");
  assert.equal(table.scenes[0].faces.l.find(h => h.col === 1024).building, null);
  assert.equal(table.scenes[1].tier, "T4");
});

test("a wrong existing wall fails a scene reference check rather than reporting success", () => {
  const refs = [{ id: "canopy", building: "BLD_E5", wall: "BLD_E5/W00", scene: "scene_e5", face: "r", col: 1024 }];
  const failures = checkSceneRefs(refs, [station], buildings);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].id, "canopy");
  assert.equal(failures[0].actualWall, "BLD_E3/W00");
});

test("an unknown scene reference is an explicit error", () => {
  assert.throws(() => checkSceneRefs([{ id: "bad", scene: "missing", face: "f", col: 1024 }], [station], buildings), /bad.*missing/);
});

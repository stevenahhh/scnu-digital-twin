// Scene names are not building names. Each sampled face column names the FIRST forward GIS wall (§7.5).
import { wallHit, readBearing } from "./vrWallHit.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTmFootprints } from "../lib/footprints.mjs";
import { wallsOf } from "../lib/anchors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCENE_MAP_FILE = join(HERE, "../data/vr-scene-buildings.json");
const INPUTS = ["data/gis-buildings.json", "data/vr-buildings.json", "data/bld-node-map.json", "../../public/uni.glb", "../perf/vr-stations.json"];

export function sceneMapInputs() {
  return Object.fromEntries(INPUTS.map(file => [file,
    createHash("sha256").update(readFileSync(resolve(HERE, "..", file))).digest("hex"),
  ]));
}

export function firstBuildingHit(station, reading, buildings) {
  const ray = readBearing(station, reading);
  if (ray.tier === "T4") return { ...ray, building: null, wall: null, point: null };
  let nearest = null;
  for (const building of buildings) {
    for (const wall of building.walls) {
      const hit = wallHit(station, reading, wall);
      if (hit.point && (!nearest || hit.distanceM < nearest.distanceM)) nearest = { ...hit, building: building.id };
    }
  }
  return nearest ?? { tier: "T2", estimated: true, building: null, wall: null, point: null, reason: "no_footprint_hit" };
}

export function sceneBuildingMap(stations, buildings) {
  return {
    frameVersion: 2,
    method: "first forward GIS footprint wall, refined stations only; cube columns 0,512,1024,1536,2048",
    scenes: stations.map(station => {
      const ray = readBearing(station, { face: "f", col: 1024 });
      return {
        scene: station.scene, tier: ray.tier, estimated: true,
        faces: Object.fromEntries(["f", "r", "b", "l"].map(face => [face,
          [0, 512, 1024, 1536, 2048].map(col => ({ col, ...firstBuildingHit(station, { face, col }, buildings) })),
        ])),
      };
    }),
  };
}

export function checkSceneRefs(records, stations, buildings) {
  const byScene = new Map(stations.map(s => [s.scene, s]));
  const failures = [];
  for (const record of records) {
    const station = byScene.get(record.scene);
    if (!station) throw new RangeError(`${record.id}: unknown scene ${record.scene}`);
    const hit = firstBuildingHit(station, record, buildings);
    if (hit.tier !== "T4" && ((record.wall && record.wall !== hit.wall) || (record.building && record.building !== hit.building))) {
      failures.push({ id: record.id, scene: record.scene, claimedWall: record.wall ?? null, actualWall: hit.wall, actualBuilding: hit.building, pass: false });
    }
  }
  return failures;
}

// Reuse the building stage's shared-record split, including C1/C1.001, but retain every GIS ring vertex
// for wallsOf(). Source geometry is used only for the split and the explicitly estimated no-GIS nodes.
export async function loadSceneBuildings() {
  const footprints = await loadTmFootprints();
  return Object.entries(footprints).map(([id, fp]) => ({ id, walls: wallsOf(id, fp).map(w => ({ id: w.id, a: w.A, b: w.B })) }));
}

// bun scripts/campus-model/fit/vrSceneBuildings.mjs [--write|--check]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stations = JSON.parse(readFileSync(join(HERE, "../../perf/vr-stations.json"), "utf8"));
  const table = { inputs: sceneMapInputs(), ...sceneBuildingMap(stations, await loadSceneBuildings()) };
  const bytes = `${JSON.stringify(table, null, 2)}\n`;
  if (process.argv.includes("--write")) writeFileSync(SCENE_MAP_FILE, bytes);
  if (process.argv.includes("--check") && readFileSync(SCENE_MAP_FILE, "utf8") !== bytes) {
    throw new Error("stale scene-building table; run vrSceneBuildings.mjs --write");
  }
  console.log(`SCENE_MAP scenes=${table.scenes.length} T4=${table.scenes.filter(s => s.tier === "T4").length}`);
}

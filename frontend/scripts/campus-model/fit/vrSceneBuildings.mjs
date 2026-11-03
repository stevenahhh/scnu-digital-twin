// Scene names are not building names. Each sampled face column names the FIRST forward GIS wall (§7.5).
import { wallHit, readBearing } from "./vrWallHit.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sceneToTm, tmToScene, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { wallsOf } from "../lib/anchors.mjs";
import { ringCentroid } from "../lib/geometry.mjs";

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
  const { loadSourceModel, meshFootprint } = await import("../stages/sources.mjs");
  const { nodeFootprints } = await import("../stages/buildings.mjs");
  const source = await loadSourceModel();
  const nodeMap = JSON.parse(readFileSync(join(HERE, "../data/bld-node-map.json"), "utf8"));
  const records = ["gis-buildings", "vr-buildings"].flatMap(name =>
    JSON.parse(readFileSync(join(HERE, `../data/${name}.json`), "utf8")).buildings)
    .filter(b => b.status !== "demolished" && b.status !== "removed");
  const parts = records.flatMap(record => record.polygons.map(polygon => {
    const [outer, ...holes] = polygon.map(r => r.map(p => tmToScene(...wgs84ToTm(...p))));
    return { outer, holes, centroid: ringCentroid(outer), footprintSource: record.footprintSource, footprintEstimated: record.estimated === true };
  }));
  const nodes = source.scene.children.flatMap((object, i) => object.isMesh && source.rawNames[i].startsWith("BLD_")
    ? [{ rawName: source.rawNames[i], footprint: meshFootprint(object) }] : []);
  const footprints = nodeFootprints({ bldNodes: nodes, footprintParts: parts, nodeMap });
  const consumed = new Set([...footprints.values()].map(fp => fp.footprintSource));
  const output = [...footprints].map(([id, fp]) => {
    const selected = fp.parts.length ? fp.parts : [nodes.find(n => n.rawName === id).footprint];
    return { id, polygons: selected.map(p => [p.outer, ...p.holes].map(r => r.map(q => sceneToTm(...q)))) };
  });
  // GIS records already owned by a uni node must not acquire a second BLD_SCNU_* identity.
  for (const record of records) {
    if (!record.nodeId || consumed.has(record.footprintSource)) continue;
    output.push({ id: record.nodeId, polygons: record.polygons.map(p => p.map(r => r.map(q => wgs84ToTm(...q)))) });
  }
  return output.map(b => ({ id: b.id, walls: wallsOf(b.id, b).map(w => ({ id: w.id, a: w.A, b: w.B })) }));
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

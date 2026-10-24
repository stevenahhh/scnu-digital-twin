#!/usr/bin/env bun
// Builds the Legacy dashboard campus model from:
//   - public/uni.glb               terrain heights, the original BLD_* ids and their footprints
//   - data/gis-buildings.json      building footprints, floor counts and heights (fetch-sources.mjs)
//   - data/landcover.png           MCEE land-cover classes and CHMv2 canopy (fetch-sources.mjs)
//   - data/ortho/                  VWorld z19 orthophoto mosaic for the ground and roof colours (fetch/ortho.mjs)
//   - data/cop30.png               Copernicus GLO-30 heights for the outer terrain ring (fetch/terrain.mjs)
//   - docs/assets/data/*.geojson   road zones, walkways and crosswalks
//   - data/photo/markings.geojson  road markings traced from the NGII 2025 orthophoto
//   - data/streetlights.json       real street-lamp positions (fetch/streetlights.mjs)
// Everything stays in uni.glb's scene frame (see lib/frame.mjs), so CityModel's recentering,
// the traffic simulation and the BLD_* selection contract keep working unchanged.
//
// This file only sequences the stages (scripts/campus-model/stages/):
//   sources.mjs   loads the inputs and builds the terrain heightfield
//   buildings.mjs selects BLD_*/CampusBuildings, their materials, meshes and nodes
//   markings.mjs  road markings from the photo detection (loadMarkings, before the ground, which suppresses the photo's
//                 own paint under them) and their decal mesh on the Topography triangles (buildMarkings)
//   ground.mjs    paints the ground texture (orthophoto over the procedural layer) and the Topography chunks
//   outerTerrain.mjs  the OuterTerrain hill ring around EXTENT, feathered onto Topography's edge
//   trees.mjs     placement masks and positions (placeTrees, before the ground, which keeps the photo's crowns
//                 out from under them), species geometry and instanced Trees_* nodes (buildTrees)
//   lights.mjs    instanced Lamps_heads / Lamps_pools (real and estimated lamp positions)
// Plan-view ring helpers live in lib/geometry.mjs.
//
// Outputs: the uncompressed scripts/campus-model/.build/campus-v2.raw.glb, which pack.mjs turns into
// the shipped public/campus-v2.glb, and the terrain height sidecar public/campus-v2-height.bin/.json.
//
//   bun run model:build      (generator, then pack.mjs)
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT, SCENE_UNITS_PER_METRE } from "./lib/frame.mjs";
import { GlbBuilder } from "./lib/glb.mjs";
import { buildBuildings } from "./stages/buildings.mjs";
import { buildGround } from "./stages/ground.mjs";
import { buildLights } from "./stages/lights.mjs";
import { SUPPRESS_MARGIN_M, buildMarkings, describeMarkings, loadMarkings } from "./stages/markings.mjs";
import { buildOuterTerrain } from "./stages/outerTerrain.mjs";
import { loadInputs } from "./stages/sources.mjs";
import { buildTrees, placeTrees } from "./stages/trees.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "../..");
const OUTPUT = path.join(HERE, ".build", "campus-v2.raw.glb");
const HEIGHT_BIN = path.join(FRONTEND, "public", "campus-v2-height.bin");
const HEIGHT_JSON = path.join(FRONTEND, "public", "campus-v2-height.json");
const HEIGHT_STEP = 2;

const inputs = await loadInputs();

const glb = new GlbBuilder();
const { selectableBuildings, campusBuildings, offCampusLots } = await buildBuildings({ glb, inputs });
const treePlacement = placeTrees({ inputs, selectableBuildings, campusBuildings, offCampusLots });
const markings = await loadMarkings({ inputs, buildings: [...selectableBuildings, ...campusBuildings] });
console.log(describeMarkings(markings));
const { surface } = await buildGround({
  glb, inputs, selectableBuildings, campusBuildings, offCampusLots,
  paint: markings.paint, paintMargin: SUPPRESS_MARGIN_M, treeInstances: treePlacement.treeInstances,
});
const markingMesh = buildMarkings({ glb, markings, surface });
const outerTerrain = await buildOuterTerrain({ glb, inputs });
const treeInstances = buildTrees({ glb, placement: treePlacement });
buildLights({ glb, inputs, selectableBuildings, campusBuildings, offCampusLots });

// ---------------------------------------------------------------- height sidecar
// The terrain heightfield (scene units) sampled every HEIGHT_STEP units over EXTENT, row-major with
// x fastest and rows running south from originZ: little-endian u16 centimetres above minY, so a
// sample's scene-unit height is minY + value * scale.
function writeHeightSidecar(heightAt) {
  const width = (EXTENT.maxX - EXTENT.minX) / HEIGHT_STEP + 1;
  const height = (EXTENT.maxZ - EXTENT.minZ) / HEIGHT_STEP + 1;
  const samples = new Float64Array(width * height);
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) samples[j * width + i] = heightAt(EXTENT.minX + i * HEIGHT_STEP, EXTENT.minZ + j * HEIGHT_STEP);
  }
  const minY = samples.reduce((min, y) => Math.min(min, y), Infinity);
  const scale = SCENE_UNITS_PER_METRE / 100;
  const view = new DataView(new ArrayBuffer(samples.length * 2));
  samples.forEach((y, k) => {
    const value = Math.round((y - minY) / scale);
    if (!(value >= 0 && value <= 0xffff)) throw new Error(`height ${y} at sample ${k} does not fit the u16 sidecar`);
    view.setUint16(k * 2, value, true);
  });
  return { bytes: new Uint8Array(view.buffer), meta: { width, height, originX: EXTENT.minX, originZ: EXTENT.minZ, step: HEIGHT_STEP, minY, scale } };
}

// ---------------------------------------------------------------- write
const bytes = glb.toBuffer();
await mkdir(path.dirname(OUTPUT), { recursive: true });
await Bun.write(OUTPUT, bytes);
const sidecar = writeHeightSidecar(inputs.heightAt);
await Bun.write(HEIGHT_BIN, sidecar.bytes);
await Bun.write(HEIGHT_JSON, `${JSON.stringify(sidecar.meta, null, 2)}\n`);
const treeCount = Object.values(treeInstances).reduce((sum, list) => sum + list.length, 0);
console.log(
  `campus-v2.glb: ${(bytes.length / 1048576).toFixed(2)} MiB, ${selectableBuildings.length} BLD nodes, ` +
  `${campusBuildings.length} other campus buildings, ${treeCount} trees ` +
  `(${Object.entries(treeInstances).map(([k, v]) => `${k} ${v.length}`).join(", ")}), ${markings.pieces.length} road-marking pieces ` +
  `(${markingMesh.triangles} triangles, ${markingMesh.vertices} vertices from ${markingMesh.sourceTriangles} before conforming to the terrain)`,
);
console.log(
  `OuterTerrain: ${outerTerrain.vertexCount} vertices, ${outerTerrain.triangleCount} triangles ` +
  `(${outerTerrain.vertexCountBefore} / ${outerTerrain.triangleCountBefore} before simplify), ` +
  `COP30 vertical offset ${outerTerrain.offsetMetres.toFixed(2)} m; ${outerTerrain.attribution}`,
);
console.log(`raw model written to ${path.relative(FRONTEND, OUTPUT)}; bun run model:pack ships it`);
console.log(`campus-v2-height.bin: ${sidecar.meta.width} x ${sidecar.meta.height} u16, ${sidecar.bytes.length} B`);

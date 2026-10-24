#!/usr/bin/env bun
// Builds public/campus-v2.glb, the Legacy dashboard campus model, from:
//   - public/uni.glb               terrain heights, the original BLD_* ids and their footprints
//   - data/vworld-buildings.json   real footprints, floor counts and heights (fetch-sources.mjs)
//   - data/landcover.png           satellite-derived ground classes (fetch-sources.mjs)
//   - docs/assets/data/*.geojson   road zones, walkways and crosswalks
// Everything stays in uni.glb's scene frame (see lib/frame.mjs), so CityModel's recentering,
// the traffic simulation and the BLD_* selection contract keep working unchanged.
//
// This file only sequences the stages (scripts/campus-model/stages/):
//   sources.mjs   loads the inputs and builds the terrain heightfield
//   buildings.mjs selects BLD_*/CampusBuildings, their materials, meshes and nodes
//   ground.mjs    paints the ground texture, Topography chunks and crosswalk stripes
//   trees.mjs     species geometry, placement masks and instanced Trees_* nodes
// Plan-view ring helpers live in lib/geometry.mjs.
//
//   bun run model:build
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlbBuilder } from "./lib/glb.mjs";
import { buildBuildings } from "./stages/buildings.mjs";
import { buildGround } from "./stages/ground.mjs";
import { loadInputs } from "./stages/sources.mjs";
import { buildTrees } from "./stages/trees.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "../..");
const OUTPUT = path.join(FRONTEND, "public", "campus-v2.glb");

const inputs = await loadInputs();

const glb = new GlbBuilder();
const { selectableBuildings, campusBuildings, offCampusLots, markingMaterial } = await buildBuildings({ glb, inputs });
await buildGround({ glb, inputs, selectableBuildings, campusBuildings, offCampusLots, markingMaterial });
const treeInstances = buildTrees({ glb, inputs, selectableBuildings, campusBuildings, offCampusLots });

// ---------------------------------------------------------------- write
const bytes = glb.toBuffer();
await Bun.write(OUTPUT, bytes);
const treeCount = Object.values(treeInstances).reduce((sum, list) => sum + list.length, 0);
console.log(
  `campus-v2.glb: ${(bytes.length / 1048576).toFixed(2)} MiB, ${selectableBuildings.length} BLD nodes, ` +
  `${campusBuildings.length} other campus buildings, ${treeCount} trees ` +
  `(${Object.entries(treeInstances).map(([k, v]) => `${k} ${v.length}`).join(", ")}), ${inputs.crosswalks.length} crosswalks`,
);

#!/usr/bin/env bun
// Refreshes the committed source data under ./data. Needs network access and VITE_VWORLD_API_KEY
// (read from the environment or frontend/.env; it is never written anywhere).
//
//   bun scripts/campus-model/fetch-sources.mjs
//
// Each source lives in its own module under ./fetch (shared settings in fetch/common.mjs):
//   fetch/buildings.mjs  -> data/gis-buildings.json     OSM footprints (ODbL) + SCNU registry floor counts (GIS건물통합정보 when downloaded)
//   fetch/landcover.mjs  -> data/landcover.png          landcover classes classified from VWorld Satellite z18 tiles
//   fetch/roofTags.mjs   -> data/osm-roof-tags.json     OSM roof:colour / roof:material / building:colour tags (ODbL)
//   fetch/ortho.mjs      -> data/ortho/                 VWorld Satellite z19 tile mosaic (stored under consent D1)
//   fetch/lod4Facades.mjs -> data/lod4-facades.json     facade palettes, wall heights and roof levels from the keyless
//                                                      VWorld LOD4 3D building models (stored under consent D1)
import { mkdir } from "node:fs/promises";
import { CACHE, DATA } from "./fetch/common.mjs";
import { writeBuildings } from "./fetch/buildings.mjs";
import { writeLandcover } from "./fetch/landcover.mjs";
import { writeLod4Facades } from "./fetch/lod4Facades.mjs";
import { writeOrtho } from "./fetch/ortho.mjs";
import { writeRoofTags } from "./fetch/roofTags.mjs";

await mkdir(DATA, { recursive: true });
await mkdir(CACHE, { recursive: true });
await writeBuildings();
await writeLandcover();
await writeRoofTags();
await writeOrtho();
await writeLod4Facades();

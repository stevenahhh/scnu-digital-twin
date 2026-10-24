#!/usr/bin/env bun
// Refreshes the committed source data under ./data. Needs network access and VITE_VWORLD_API_KEY
// (read from the environment or frontend/.env; it is never written anywhere).
//
//   bun scripts/campus-model/fetch-sources.mjs
//
// Each source lives in its own module under ./fetch (shared settings in fetch/common.mjs):
//   fetch/buildings.mjs  -> data/gis-buildings.json     OSM footprints (ODbL) + SCNU registry floor counts (GIS건물통합정보 when downloaded)
//   fetch/landcover.mjs  -> data/landcover.png          landcover classes classified from VWorld Satellite z18 tiles
import { mkdir } from "node:fs/promises";
import { CACHE, DATA } from "./fetch/common.mjs";
import { writeBuildings } from "./fetch/buildings.mjs";
import { writeLandcover } from "./fetch/landcover.mjs";

await mkdir(DATA, { recursive: true });
await mkdir(CACHE, { recursive: true });
await writeBuildings();
await writeLandcover();

#!/usr/bin/env bun
// OpenStreetMap roof appearance tags for the buildings in BBOX -> data/osm-roof-tags.json
// (© OpenStreetMap contributors, ODbL 1.0). stages/buildings.mjs colours a roof only from these tags;
// every other roof keeps the procedural light membrane. Imagery is never sampled for roof colours.
//
//   bun scripts/campus-model/fetch/roofTags.mjs
//
// Kept tags: roof:colour, roof:material, building:colour (and their US spellings), roof:garden.
// The file lists every building element that carries at least one of them, with its centre, plus
// how many building elements were scanned, so an empty list is a recorded result, not a gap.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { BBOX, DATA, TIMEOUT_MS, USER_AGENT } from "./common.mjs";

const OVERPASS = "https://overpass-api.de/api/interpreter";
export const ROOF_TAG_KEYS = ["roof:colour", "roof:color", "roof:material", "building:colour", "building:color", "roof:garden"];
export const ROOF_TAGS_FILE = path.join(DATA, "osm-roof-tags.json");

export async function fetchRoofTags() {
  const box = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const query = `[out:json][timeout:60];(way["building"](${box});relation["building"](${box}););out tags center;`;
  const response = await fetch(OVERPASS, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  const { elements } = await response.json();
  const buildings = elements.flatMap((element) => {
    const tags = Object.fromEntries(ROOF_TAG_KEYS.filter((key) => element.tags?.[key]).map((key) => [key, element.tags[key]]));
    if (!Object.keys(tags).length || !element.center) return [];
    return [{ osm: `${element.type}/${element.id}`, name: element.tags.name ?? "", centre: [element.center.lon, element.center.lat], tags }];
  });
  return {
    source: "© OpenStreetMap contributors (ODbL 1.0), Overpass API building ways/relations in bbox",
    fetched: new Date().toISOString().slice(0, 10),
    bbox: BBOX,
    keys: ROOF_TAG_KEYS,
    scanned: elements.length,
    buildings,
  };
}

export async function writeRoofTags() {
  const result = await fetchRoofTags();
  await mkdir(DATA, { recursive: true });
  await Bun.write(ROOF_TAGS_FILE, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`osm-roof-tags.json: ${result.buildings.length} of ${result.scanned} OSM buildings carry roof/building colour tags`);
}

if (import.meta.main) await writeRoofTags();

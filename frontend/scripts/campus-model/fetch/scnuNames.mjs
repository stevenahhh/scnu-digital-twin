#!/usr/bin/env bun
// Applies the curated SCNU building names (data/scnu-building-names.json) to the footprint records.
// Every record gets a nameSource; the SCNU records listed in the table also get their resolved name,
// status (standing / unresolved / demolished / removed), display label and selectable nodeId. A removed record (not
// in the official VR tour, user decision 2026-10-29) is dropped from the output entirely. fetch/buildings.mjs
// calls applyScnuNames() before it writes gis-buildings.json; run this file directly to apply a changed
// table to the committed gis-buildings.json without refetching:
//
//   bun scripts/campus-model/fetch/scnuNames.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
export const SCNU_NAMES = path.join(DATA, "scnu-building-names.json");
const GIS_NAME = "GIS건물통합정보";

// Name source of a record the table does not list, from where its footprint (and so its name) came from.
function defaultNameSource(record) {
  if (!record.name) return "none";
  return record.footprintSource.startsWith("OSM") ? "OSM name" : `${GIS_NAME} A24 건물명 + A25 동명`;
}

export function applyScnuNames(buildings, table) {
  const byFootprint = new Map(table.records.map((entry) => [entry.footprintSource, entry]));
  const seen = new Set();
  const result = buildings.flatMap((record) => {
    const { nameSource, status, label, nodeId, registerName, ...rest } = record;
    const entry = byFootprint.get(record.footprintSource);
    if (!entry) return [{ ...rest, nameSource: defaultNameSource(record) }];
    seen.add(entry.footprintSource);
    if (entry.status === "removed") return [];
    return [{
      ...rest,
      name: entry.name,
      nameSource: entry.nameSource,
      status: entry.status,
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.nodeId ? { nodeId: entry.nodeId } : {}),
      registerName: entry.registerName,
    }];
  });
  // a removed record is already gone from the committed gis-buildings.json, so only the others must match
  const missing = table.records.filter((entry) => entry.status !== "removed" && !seen.has(entry.footprintSource));
  if (missing.length) {
    console.warn(`scnu names: ${missing.length} table entries match no footprint: ${missing.map((e) => e.footprintSource).join("; ")}`);
  }
  return result;
}

export async function readScnuNames() {
  return JSON.parse(await Bun.file(SCNU_NAMES).text());
}

if (import.meta.main) {
  const file = path.join(DATA, "gis-buildings.json");
  const data = JSON.parse(await Bun.file(file).text());
  const table = await readScnuNames();
  const buildings = applyScnuNames(data.buildings, table);
  await Bun.write(file, `${JSON.stringify({ ...data, buildings })}\n`);
  const byStatus = Object.groupBy(buildings.filter((b) => b.status), (b) => b.status);
  console.log(
    `gis-buildings.json: names applied to ${buildings.length} records; SCNU ` +
    Object.entries(byStatus).map(([status, list]) => `${status} ${list.length}`).join(", "),
  );
}

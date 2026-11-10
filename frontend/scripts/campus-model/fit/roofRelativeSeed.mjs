// Migrate curated roof equipment at its source. Re-running retains authoritative relative coordinates.
// bun scripts/campus-model/fit/roofRelativeSeed.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { loadTmFootprints } from "../lib/footprints.mjs";
import { encodeRoofGeometry, mapRoofGeometry } from "../lib/roofRelative.mjs";
import { wgs84ToTm } from "../../../src/geo/epsg5186.mjs";

const file = new URL("../data/facade-attachments.json", import.meta.url);
const data = JSON.parse(readFileSync(file, "utf8"));
const footprints = await loadTmFootprints();
let count = 0;
for (const building of data.buildings) {
  for (const record of building.attachments) {
    if (!["mast", "solar", "roof"].includes(record.kind)) continue;
    record.roofRelative ??= encodeRoofGeometry(record.id,
      mapRoofGeometry(record, p => wgs84ToTm(...p)), footprints[building.node]);
    record.estimated = true;
    count += 1;
  }
}
const header = JSON.stringify({ ...data, buildings: [] }, null, 1);
const buildings = data.buildings.map(b => `  {\n   "node": ${JSON.stringify(b.node)},\n   "attachments": [\n${b.attachments.map(a => `    ${JSON.stringify(a)}`).join(",\n")}\n   ]\n  }`);
writeFileSync(file, `${header.replace('"buildings": []', `"buildings": [\n${buildings.join(",\n")}\n ]`)}\n`);
console.log(`roofRelative: ${count} curated roof elements`);

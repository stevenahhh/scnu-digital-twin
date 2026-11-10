// Numeric roof QA, no source imagery in the output. Usage: bun .../qa/roofReport.mjs <report.json>
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadTmFootprints } from "../lib/footprints.mjs";
import { mapRoofGeometry, resolveRoofGeometry } from "../lib/roofRelative.mjs";
import { wgs84ToTm } from "../../../src/geo/epsg5186.mjs";

const forms = JSON.parse(readFileSync(new URL("../data/building-forms.json", import.meta.url), "utf8"));
const attachments = JSON.parse(readFileSync(new URL("../data/facade-attachments.json", import.meta.url), "utf8"));
const footprints = await loadTmFootprints();
const gis = JSON.parse(readFileSync(new URL("../data/gis-buildings.json", import.meta.url), "utf8")).buildings;
const containmentInputs = [];
const rows = forms.buildings.map(b => {
  const cores = b.masses.filter(m => m.kind === "core");
  const equipment = attachments.buildings.find(a => a.node === b.key)?.attachments.filter(a => ["mast", "solar", "roof"].includes(a.kind)) ?? [];
  const elements = [...cores, ...equipment];
  const raw = gis.find(r => r.footprintSource === b.footprintSource);
  const footprint = footprints[b.key] ?? (raw ? { polygons: raw.polygons.map(p => p.map(r => r.map(q => wgs84ToTm(...q)))) } : null);
  containmentInputs.push({ id: b.key, footprint: footprint?.polygons ?? null,
    masses: b.masses.filter(m => ["main", "wing"].includes(m.kind)).map(m => mapRoofGeometry(m, p => wgs84ToTm(...p))) });
  let maxRoundTripM = 0;
  const missing = [];
  elements.forEach((element, i) => {
    const id = `${b.key}/roof/${i}`;
    if (!element.roofRelative || !footprints[b.key]) {
      missing.push(id);
      return;
    }
    const tm = resolveRoofGeometry(id, element, footprints[b.key]);
    const expected = [];
    const actual = [];
    mapRoofGeometry(element, p => { expected.push(wgs84ToTm(...p)); return p; });
    mapRoofGeometry(tm, p => { actual.push(p); return p; });
    if (expected.length !== actual.length) throw new Error(`${id}: roof geometry point count changed`);
    expected.forEach((p, j) => { maxRoundTripM = Math.max(maxRoundTripM, Math.hypot(p[0] - actual[j][0], p[1] - actual[j][1])); });
  });
  return { id: b.key, lod4Residual_m: b.lod4Residual_m, over1m: b.lod4Residual_m > 1,
    lod4Iou: b.iou.lod4, source: b.source, fromFootprint: b.masses.every(m => m.fromFootprint),
    cores: cores.length, equipment: equipment.length, missing, maxRoundTripM, estimated: true };
});
const check = spawnSync("uv", ["run", "--no-project", "--with", "shapely==2.2.0", "python",
  fileURLToPath(new URL("./roofContainment.py", import.meta.url))],
{ input: JSON.stringify(containmentInputs), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
if (check.status !== 0) throw new Error(`roof containment: ${check.error?.message ?? check.stderr}`);
const containment = JSON.parse(check.stdout);
rows.forEach((r, i) => { r.mainWingContainment = containment[i]; });
const report = { buildings: rows, totals: { buildings: rows.length,
  cores: rows.reduce((n, r) => n + r.cores, 0), equipment: rows.reduce((n, r) => n + r.equipment, 0),
  missing: rows.flatMap(r => r.missing), over1m: rows.filter(r => r.over1m).map(r => r.id),
  mainWingOutsideBuffer: containment.filter(r => r.inside !== true),
  maxRoundTripM: Math.max(...rows.map(r => r.maxRoundTripM)) } };
if (!process.argv[2]) throw new Error("roofReport requires an output JSON path");
writeFileSync(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.totals));

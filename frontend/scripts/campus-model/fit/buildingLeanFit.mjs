// Writes data/photo/building-lean.json: one relief-lean record per building of data/building-forms.json (the 29 BLD_*
// model nodes plus the other campus buildings), fitted on the NGII 2025 sheet (.cache/ngii-ortho, never committed) by
// fit/buildingLean.mjs, seeded by each building's leanPrior (registration lean field). Only numbers leave the sheet.
//   bun scripts/campus-model/fit/buildingLeanFit.mjs [--dry-run]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { DEFAULT_SHEET, openSheet } from "../lib/ngiiSheet.mjs";
import { fitLean, leanRecord } from "./buildingLean.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data");
const forms = JSON.parse(readFileSync(path.join(DATA, "building-forms.json"), "utf8"));
const sheet = openSheet(DEFAULT_SHEET);
const { a: gsd, c, f } = sheet.tfw;
const MARGIN_M = 14;

const records = [];
try {
  for (const b of forms.buildings) {
    const masses = b.masses.map((m) => ({ ring: m.outer.map(([lon, lat]) => wgs84ToTm(lon, lat)), holes: (m.holes ?? []).map((h) => h.map(([lon, lat]) => wgs84ToTm(lon, lat))), topM: m.topMetres }));
    const pts = masses.flatMap((m) => m.ring);
    const top = Math.max(...masses.map((m) => m.topM));
    const pad = MARGIN_M + 0.2 * top;
    const E0 = Math.min(...pts.map((p) => p[0])) - pad;
    const N1 = Math.max(...pts.map((p) => p[1])) + pad;
    const col0 = Math.floor((E0 - (c - gsd / 2)) / gsd);
    const row0 = Math.floor(((f + gsd / 2) - N1) / gsd);
    const w = Math.ceil((Math.max(...pts.map((p) => p[0])) + pad - E0) / gsd);
    const h = Math.ceil((N1 - Math.min(...pts.map((p) => p[1])) + pad) / gsd);
    const rgb = sheet.readWindow(col0, row0, w, h);
    const grey = new Float32Array(w * h);
    for (let k = 0; k < w * h; k += 1) grey[k] = 0.299 * rgb[k * 3] + 0.587 * rgb[k * 3 + 1] + 0.114 * rgb[k * 3 + 2];
    const win = { w, h, gsdM: gsd, origin: [c - gsd / 2 + col0 * gsd, f + gsd / 2 - row0 * gsd] };
    const fit = fitLean(grey, win, { masses, prior: b.leanPrior });
    const rec = leanRecord(b.key, fit);
    records.push(rec);
    console.log(`LEAN ${b.key.slice(0, 60)} ${rec.method} lean=${rec.lean} residual=${rec.residual_m} score=${fit.score} median=${fit.median} formsLean=${b.lean}`);
  }
} finally {
  sheet.close();
}
const doc = {
  description: "Per-building relief lean of the NGII 2025 orthophoto (sheet 34702020): the roof of a mass of height h appears at footprint + h * lean (m per m of height, [east, north]). method roof-edge: mass outlines slid over the photo's Sobel edges around the prior; method prior: no roof edge visible, so the registration lean field value (building-forms leanPrior) is kept and marked estimated. residual_m: RMS outline-to-edge distance. Estimates (추정), not survey data. Written by fit/buildingLeanFit.mjs.",
  sheet: path.basename(DEFAULT_SHEET),
  buildings: records,
};
if (!process.argv.includes("--dry-run")) writeFileSync(path.join(DATA, "photo", "building-lean.json"), `${JSON.stringify(doc, null, 2)}\n`);
const fitted = records.filter((r) => r.method === "roof-edge").length;
console.log(`RESULT ${records.length} buildings, ${fitted} roof-edge, ${records.length - fitted} prior`);

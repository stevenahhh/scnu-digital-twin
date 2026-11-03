// Curation coverage and door-centre residuals, not a claim of photographic fidelity.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { compileFacadeGrid } from "../lib/facadeGrid.mjs";

export function facadeCoverage({ buildings, reviews, grids, entrances }) {
  const rows = buildings.map(building => {
    const review = reviews[building];
    const gridCount = grids.get(building)?.walls.size ?? 0;
    const reason = review?.estimated === true ? review.fallbackReason?.trim() : null;
    return {
      building, gridCount, estimated: true,
      status: gridCount ? "grid" : reason ? "fallback" : "missing",
      fallbackReason: reason || null,
      scenes: review?.scenes ?? [],
      lod4Record: review?.lod4Record ?? null,
    };
  });
  return {
    buildings: rows,
    missingBuildings: rows.filter(r => r.status === "missing").map(r => r.building),
    entrances: entrances.map(entry => {
      const wall = grids.get(entry.anchor.building)?.walls.get(entry.anchor.wall);
      const cell = wall?.cells.find(c => c.kind === "door" && c.entrance?.id === entry.id);
      const centreSM = cell ? cell.s0M + (cell.s1M - cell.s0M) * cell.look.windowCentre : null;
      const deltaSM = centreSM === null ? null : Math.abs(centreSM - entry.anchor.sM);
      return {
        id: entry.id, building: entry.anchor.building, wall: entry.anchor.wall,
        canopySM: entry.anchor.sM, centreSM, deltaSM,
        status: deltaSM === null ? "ungridded" : deltaSM <= 0.3 ? "aligned" : "mismatch",
      };
    }),
  };
}

export async function loadFacadeCoverage() {
  const { loadTmFootprints } = await import("../lib/footprints.mjs");
  const footprints = await loadTmFootprints();
  const dir = new URL("../data/buildings/", import.meta.url);
  const reviews = JSON.parse(readFileSync(new URL("facade-review.json", dir), "utf8")).records;
  const entrances = JSON.parse(readFileSync(new URL("entrances.json", dir), "utf8")).records;
  const gis = JSON.parse(readFileSync(new URL("../gis-buildings.json", dir), "utf8")).buildings;
  const anonymous = gis.filter(r => r.status !== "removed" && r.status !== "demolished" &&
    /순천대/.test(r.name) && !r.nodeId).map(r => r.footprintSource);
  const grids = new Map(readdirSync(new URL("facades/", dir)).filter(f => f.endsWith(".json")).sort().map(file => {
    const doc = JSON.parse(readFileSync(new URL(`facades/${file}`, dir), "utf8"));
    return [doc.building, compileFacadeGrid(doc, footprints[doc.building], entrances)];
  }));
  return facadeCoverage({ buildings: [...Object.keys(footprints), ...anonymous].sort(), reviews, grids, entrances });
}

// bun scripts/campus-model/qa/facadeCoverage.mjs [--out /path/report.json]
// Ungridded entrances remain named gaps; missing coverage or a shifted gridded door fails.
if (import.meta.main) {
  const report = await loadFacadeCoverage();
  const arg = process.argv.indexOf("--out");
  if (arg >= 0) writeFileSync(process.argv[arg + 1], `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.missingBuildings.length || report.entrances.some(e => e.status === "mismatch")) process.exitCode = 1;
}

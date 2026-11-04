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
      requestedWalls: [...(grids.get(building)?.walls.keys() ?? [])],
      requestedSurfaceEdges: [...(grids.get(building)?.walls.values() ?? [])].flatMap(w =>
        (w.surfaceEdges ?? []).map((_, i) => `${w.wall}#${i}`)),
      status: reason ? (gridCount ? "grid" : "fallback") : "missing",
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

export function unappliedFacadeWalls(rows, nodes) {
  const built = new Map(nodes.map(n => [n.name, n.extras?.facadeGridAppliedWalls ?? []]));
  const edges = new Map(nodes.map(n => [n.name, n.extras?.facadeGridAppliedSurfaceEdges ?? []]));
  return rows.flatMap(row => [
    ...row.requestedWalls.filter(w => !built.get(row.building)?.includes(w)),
    ...(row.requestedSurfaceEdges ?? []).filter(e => !edges.get(row.building)?.includes(e)),
  ].map(w => `${row.building}/${w}`));
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

// bun scripts/campus-model/qa/facadeCoverage.mjs [--built] [--out /path/report.json]
// Ungridded entrances remain named gaps; missing coverage or a shifted gridded door fails.
if (import.meta.main) {
  const report = await loadFacadeCoverage();
  if (process.argv.includes("--built")) {
    const bytes = readFileSync(new URL("../../../public/campus-v2.glb", import.meta.url));
    const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    report.unappliedWalls = unappliedFacadeWalls(report.buildings, model.nodes);
  }
  const arg = process.argv.indexOf("--out");
  if (arg >= 0) writeFileSync(process.argv[arg + 1], `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.missingBuildings.length || report.entrances.some(e => e.status === "mismatch") ||
      report.unappliedWalls?.length) process.exitCode = 1;
}

// Seed, never hand-edit data/photo/site-detail-anchors.json:
// bun scripts/campus-model/fit/siteDetailAnchors.mjs --write | --check
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { mapSiteGeometry, seedSiteDetails, isWallSiteDetail } from "../lib/siteDetailAnchors.mjs";
import { firstBuildingHit, loadSceneBuildings } from "./vrSceneBuildings.mjs";
import { wallHit } from "./vrWallHit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = name => JSON.parse(readFileSync(join(root, name), "utf8"));
const inputNames = ["data/photo/site-detail.geojson", "data/gis-buildings.json",
  "data/vr-buildings.json", "data/bld-node-map.json", "../../public/uni.glb", "../perf/vr-stations.json"];
const inputs = Object.fromEntries(inputNames.map(name => [name,
  createHash("sha256").update(readFileSync(join(root, name))).digest("hex")]));
const survey = readJson("data/photo/site-detail.geojson");
const parcelList = readJson("data/ground/parcels.json").parcels;
const stations = readJson("../perf/vr-stations.json");
const buildings = await loadSceneBuildings();
// Until todo 19's shared loader lands, reconstruct the exact TM rings returned by todo 18.
// These are source rings, not fabricated saved wall snapshots. Resolver calls accept snapshots separately.
const footprints = {};
for (const building of buildings) {
  const polygons = [];
  for (const wall of building.walls) {
    const local = wall.id.slice(building.id.length + 1);
    const part = Number(/^P(\d+)\//.exec(local)?.[1] ?? 0);
    const hole = /H(\d+)\//.exec(local);
    const ring = hole ? Number(hole[1]) + 1 : 0;
    polygons[part] ??= [];
    polygons[part][ring] ??= [];
    polygons[part][ring].push(wall.a);
  }
  footprints[building.id] = { polygons };
}
const parcels = Object.fromEntries(parcelList.map(p => [p.id, p]));
const context = { footprints, parcels };
const wallRecords = {};
const readingAudit = [];
// Eye-read on the original 2048px cube face. F1's LED left/right edges are 1482/1839.
// B3 is diagnostic only: rays split across B4, B5 and B3, so its bed must not attach to one infinite wall.
for (const reading of [
  { id: "SD-F1-LED1", scene: "scene_f1", face: "f", cols: [1482, 1839] },
  { id: "SD-B3-K1", scene: "scene_b3", face: "l", cols: [530, 1450], diagnostic: true },
]) {
  const station = stations.find(s => s.scene === reading.scene);
  const hits = reading.cols.map(col => firstBuildingHit(station, { face: reading.face, col }, buildings));
  const middle = firstBuildingHit(station, { face: reading.face,
    col: reading.cols.reduce((a, b) => a + b, 0) / reading.cols.length }, buildings);
  const wall = buildings.find(b => b.id === middle.building)?.walls.find(w => w.id === middle.wall);
  const sameWallHits = wall ? reading.cols.map(col => wallHit(station, { face: reading.face, col }, wall)) : [];
  const clean = wall && sameWallHits.every(h => h.point) && hits.every(h => h.wall === middle.wall);
  readingAudit.push({ ...reading, estimated: true, hits, selectedWall: middle.wall, sameWallHits, clean: Boolean(clean) });
  if (!clean || reading.diagnostic) continue;
  const offsets = sameWallHits.map(h => h.sM).sort((a, b) => a - b);
  wallRecords[reading.id] = {
    id: reading.id, anchor: { building: middle.building, wall: middle.wall.slice(middle.building.length + 1),
      s0M: offsets[0], s1M: offsets[1], tM: 0.30 },
    // B.led_screen expects left-to-right as seen outdoors. Clockwise wall s runs the other way.
    geometry: { type: "LineString", coordinates: [[offsets[1] - offsets[0], 0], [0, 0]] },
    estimated: true, evidence: { tier: "T2", refs: [
      ...reading.cols.map((col, i) =>
        `VR ${reading.scene} ${reading.face} col ${col} -> ${hits[i].wall} s=${hits[i].sM} m; eye-read column, estimated`),
      "Generated F1 Facade_Atlas lies about 0.294 m outside the GIS wall; tM=0.30 estimated fascia offset, not a field measurement.",
    ] },
  };
}
const features = survey.features.map(f => ({
  ...f.properties, geometry: mapSiteGeometry({ id: f.properties.id, geometry: f.geometry }, p => wgs84ToTm(...p)),
  ...(f.properties.id.startsWith("SD-B3-") && f.properties.id !== "SD-B3-S1" ? {
    reason: "B3 bed reading spans BLD_B4/W12, BLD_B5_Greenhouse/W03 and BLD_B3/W05; col 1450 gives s=-8.922697 m on B4/W12 (L=18.643487 m). Retain parcel-local T4 estimate; station/footprint discrepancy unresolved, no clamping.",
  } : {}),
}));
const result = seedSiteDetails(features, context, wallRecords);
const targetIds = new Set(features.filter(isWallSiteDetail).map(f => f.id));
const outsideScope = features.filter(f => f.photo_support === "none" && !targetIds.has(f.id)).map(f => ({
  id: f.id, kind: f.kind, observation: f.note,
  reason: f.kind === "entrance_canopy" ? "todo 19 owns entrance/canopy migration"
    : "outside the five todo 20 classes; retained for todo 21 free-standing objects or the owning later stage",
}));
const usedBuildings = new Set(result.records.map(r => r.anchor.building).filter(Boolean));
const output = { frameVersion: 2, inputs,
  footprints: Object.fromEntries(Object.entries(footprints).filter(([id]) => usedBuildings.has(id))),
  ...result, readingAudit, outsideScope };
const bytes = `${JSON.stringify(output, null, 2)}\n`;
const destination = join(root, "data/photo/site-detail-anchors.json");
if (process.argv.includes("--write")) writeFileSync(destination, bytes);
if (process.argv.includes("--check") && readFileSync(destination, "utf8") !== bytes) throw new Error("stale site-detail anchors; rerun seed");
console.log(JSON.stringify({ total: targetIds.size, anchored: result.records.length,
  wall: result.records.filter(r => r.anchor.wall).length, parcel: result.records.filter(r => r.anchor.parcel).length,
  unresolved: result.unresolved, outsideScope: outsideScope.length }, null, 2));

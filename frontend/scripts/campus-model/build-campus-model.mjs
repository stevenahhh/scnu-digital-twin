#!/usr/bin/env bun
// Builds the Legacy dashboard campus model from:
//   - public/uni.glb               terrain heights, the original BLD_* ids and their footprints
//   - data/gis-buildings.json      building footprints, floor counts and heights (fetch-sources.mjs)
//   - data/landcover.png           MCEE land-cover classes and CHMv2 canopy (fetch-sources.mjs)
//   - data/ortho/                  VWorld z19 orthophoto mosaic: roof colours and the markings paint gate only (fetch/ortho.mjs)
//   - data/materials/ground-*.webp CC0 ground material tiles (fetch/groundMaterials.mjs, ground-materials.json)
//   - data/cop30.png               Copernicus GLO-30 heights for the outer terrain ring (fetch/terrain.mjs)
//   - docs/assets/data/*.geojson   road zones, walkways and crosswalks
//   - data/ground/road-sections.json + junctions.json  recorded road paint and speed humps
//   - data/photo/objects-campus.geojson  street furniture and lamps surveyed on the NGII 2025 orthophoto
// Everything stays in uni.glb's scene frame (see lib/frame.mjs), so CityModel's recentering,
// the traffic simulation and the BLD_* selection contract keep working unchanged.
//
// This file only sequences the stages (scripts/campus-model/stages/):
//   sources.mjs   loads the inputs and builds the terrain heightfield
//   buildings.mjs selects BLD_*/CampusBuildings, their materials, meshes and nodes
//   roadMarkings.mjs  road-section/junction records; markings.mjs assembles their terrain-conformed mesh
//   ground.mjs    the Topography chunks (natural ground) and the class polygons of the modelled ground (network/surfaces.mjs)
//   kerbs.mjs     kerb ribbons on the A003 outlines, the raised walkway slab, dropped kerbs at crossings, gutter bands
//   tactile.mjs   tactile paving bands and guidance strips at every dropped kerb
//   parking.mjs   stall rows, accessible bays, their symbols and the wheel stops from data/ground/parking.json
//   roadMarkings.mjs  the record-defined circular-arc speed humps and sidecar height function
//   surfaces.mjs  the Ground_* decal meshes (asphalt, pavers, lots, aprons, painted surfaces) with CC0 tiles; no photo pixels;
//                 like the road markings (markings.mjs), one editable node per parcel or parcel group (lib/groundNodes.mjs)
//   outerTerrain.mjs  the OuterTerrain hill ring around EXTENT, feathered onto Topography's edge
//   context.mjs / contextGround.mjs  off-campus building masses and the streets around the campus beyond EXTENT
//   trees.mjs     tree inventory and hedges (placeTrees, after the ground), species geometry and instanced Trees_* nodes (buildTrees)
//   furniture.mjs the surveyed outdoor objects (loadFurniture, before the trees: footprints trees keep out of) and the
//                 merged per-material meshes (buildFurniture, after the ground, on the drawn terrain), written to a
//                 scratch GlbBuilder; furnitureObjects.mjs recovers each object's geometry from it and
//                 lib/objectNodes.mjs emits one editable node per object (Furniture/<kind>/<id>) once the lamp heads
//                 are drawn
//   lights.mjs    lamp positions (placeLamps: surveyed lamps at their photo pole bases, pole placement contract), the
//                 lamp heads (on the lamp nodes) and the instanced Lamps_pools
// Plan-view ring helpers live in lib/geometry.mjs.
//
// Outputs: the uncompressed scripts/campus-model/.build/campus-v2.raw.glb, which pack.mjs turns into
// the shipped public/campus-v2.glb, and the terrain height sidecar public/campus-v2-height.bin/.json.
//
//   bun run model:build      (generator, then pack.mjs)
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneToTm, tmToScene } from "../../src/geo/epsg5186.mjs";
import { EXTENT, SCENE_UNITS_PER_METRE, frameAssetExtras } from "./lib/frame.mjs";
import { SURFACE_CLASS } from "./lib/surfaceClass.mjs";
import { loadRoadMarkings } from "./stages/roadMarkings.mjs";
import { GlbBuilder } from "./lib/glb.mjs";
import { emitObjectNodes } from "./lib/objectNodes.mjs";
import { assertPaintOnParcels, pieceKey, retainPaint, loadParcels, PARCELS_PATH } from "./lib/parcels.mjs";
import { candidatePaths } from "./qa/candidate.mjs";
import { GroundPartition, TinPartition, splitByLine } from "./lib/partition.mjs";
import { buildBuildings } from "./stages/buildings.mjs";
import { buildEntrances } from "./stages/entrances.mjs";
import { loadTmFootprints } from "./lib/footprints.mjs";
import { buildGround } from "./stages/ground.mjs";
import { buildFurniture, loadFurniture } from "./stages/furniture.mjs";
import { furnitureObjects } from "./stages/furnitureObjects.mjs";
import { buildLights, placeLamps } from "./stages/lights.mjs";
import { buildContext, meshHeightAt } from "./stages/context.mjs";
import { buildContextGround } from "./stages/contextGround.mjs";
import { buildMasts } from "./stages/masts.mjs";
import { buildMarkings, describeMarkings, inMarkingExtent } from "./stages/markings.mjs";
import { assertLotsOnParcels, describeParking, estimatedValueReport, implausibleStalls, loadParking, lotReviewReport, parkingPlan, symbolPieceReport } from "./stages/parking.mjs";
import { buildOuterTerrain } from "./stages/outerTerrain.mjs";
import { KERB_EXPOSED_M, SLAB_DECAL_DROP_M, buildKerbs, prepareKerbs } from "./stages/kerbs.mjs";
import { loadInputs } from "./stages/sources.mjs";
import { planTactile } from "./stages/tactile.mjs";
import { buildHumpMeshes, buildSurfaceMeshes, describeSurfaces, humpLayers } from "./stages/surfaces.mjs";
import { footprintCover } from "./lib/decimate.mjs";
import { buildTrees, placeTrees } from "./stages/trees.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const candidateDir = option("--candidate-dir", null);
const candidate = candidateDir ? candidatePaths(candidateDir) : null;
const OUTPUT = candidate ? (args.includes("--repeat") ? candidate.repeatRaw : candidate.raw) : path.join(HERE, ".build", "campus-v2.raw.glb");
// A raw bootstrap is never a public publish, including its sidecars.
const HEIGHT_BIN = candidate?.heightBin ?? path.join(HERE, ".build", "campus-v2-height.bin");
const HEIGHT_JSON = candidate?.heightJson ?? path.join(HERE, ".build", "campus-v2-height.json");
const parcelsPath = path.resolve(option("--parcels", PARCELS_PATH));
// 0.25 scene units (about 0.40 m): sub-metre sampling so the 0.15 m walkway slab (stages/kerbs.mjs) shows in the sidecar.
const HEIGHT_STEP = 0.25;
const PROBES_PER_KIND = 12;
const metresToUnits = (m) => m * SCENE_UNITS_PER_METRE;

const inputs = await loadInputs();

const glb = new GlbBuilder();
const parcelsDoc = loadParcels(parcelsPath);
// Plan terrain and raised walkway heights before buildings/entrances, but defer their mesh emission.
const { surface, surfaces, groundInfo, layers, aoTexture, buildTopography } = await buildGround({ glb, inputs, parcelsDoc });
const kerbPlan = await prepareKerbs({ surfaces, groundInfo, surface });
const groundAt = kerbPlan.groundHeightAt;
const anchorFootprints = await loadTmFootprints();
const wallSnapshots = Object.fromEntries(Object.entries(anchorFootprints).map(([id, fp]) => [id, fp.walls]));
const furniture = loadFurniture({ anchorFootprints, wallSnapshots });
const { selectableBuildings, campusBuildings, offCampusLots, contextParts, groundFootprints } = await buildBuildings({ glb, inputs, detailedStructures: furniture.detailedStructures });
const entranceRecords = JSON.parse(readFileSync(new URL("./data/buildings/entrances.json", import.meta.url), "utf8")).records;
buildEntrances({ glb, records: entranceRecords, footprints: anchorFootprints, groundAt });
const parkingDoc = loadParking();
assertLotsOnParcels(parkingDoc, surfaces.parcels);
const parking = parkingPlan(parkingDoc);
const markings = loadRoadMarkings();
const roadRecords = [...new Set(markings.pieces.map(p => p.record))];
const roadObjects = [...new Set(markings.pieces.map(p => p.objectId))];
const roadSourceHashes = Object.fromEntries(["road-sections", "junctions", "parcels"].map(name => [
  name, createHash("sha256").update(readFileSync(name === "parcels" ? parcelsPath : new URL(`./data/ground/${name}.json`, import.meta.url))).digest("hex"),
]));
console.log(describeMarkings(markings));
// The ground classes come from the one parcel map data/ground/parcels.json (design §5, lib/parcels.mjs).
// Trees after the ground: a trunk stands on open ground, in a planter or a street-tree pit (the surface-class raster).
const treePlacement = placeTrees({ inputs, selectableBuildings, campusBuildings, offCampusLots, blockedRings: furniture.treeBlock, furnitureObjects: furniture.objects, groundInfo });
// The parking rows of data/ground/parking.json join the paint; a symbol exists only through its record (markings.report).
markings.pieces.push(...parking.pieces);
console.log(describeParking(parking));
{
  const odd = implausibleStalls(parkingDoc);
  const rows = [...new Set(odd.map((x) => x.row))];
  console.log(`parking: ${odd.length} stalls of implausible width in ${rows.length} rows (markings.report): ${rows.join(", ") || "none"}`);
}
// The sidecar's road/lot samples use the same ground-class raster.
const labelAt = ([x, z]) => {
  const i = Math.floor((x - EXTENT.minX) * groundInfo.px);
  const j = Math.floor((z - EXTENT.minZ) * groundInfo.px);
  return i < 0 || j < 0 || i >= groundInfo.width || j >= groundInfo.height ? SURFACE_CLASS.NATURAL : groundInfo.labels[j * groundInfo.width + i];
};
// Design §10.3: paint lies only on parcels that allow it (road, lot). parcels.json `paintExcluded` lists the photo paint
// on surveyed non-road ground (A003 sidewalks), which is left undrawn; any other piece on such ground throws by id.
{
  const toTm = ([x, z]) => sceneToTm(x, z);
  const centre = (r) => r.reduce((a, q) => [a[0] + q[0] / r.length, a[1] + q[1] / r.length], [0, 0]);
  const drawn = markings.pieces.filter((p) => inMarkingExtent(centre(p.rings[0])));
  const kept = retainPaint(markings.pieces, surfaces, toTm);
  const check = assertPaintOnParcels(kept.filter((p) => inMarkingExtent(centre(p.rings[0]))), surfaces.parcels, toTm);
  console.log(`paint invariant (§10.3): ${check.checked} pieces inside EXTENT on road/lot parcels, 0 on other ground; ${drawn.length - check.checked} excluded (parcels.json paintExcluded)`);
  markings.pieces.splice(0, markings.pieces.length, ...kept);
}
// markings.report: the symbol pieces that reach the mesh, in the GLB's Road_Markings extras and in .build; the build stops on
// a symbol without a parking.json record.
markings.pieceReport = { ...symbolPieceReport(markings.pieces), roadRecords, roadObjects, roadSourceHashes, estimatedValues: estimatedValueReport(parkingDoc), lots: lotReviewReport(parkingDoc) };
if (markings.pieceReport.unrecorded) throw new Error(`markings.report: ${markings.pieceReport.unrecorded} symbol pieces without a parking.json record`);
await mkdir(path.dirname(OUTPUT), { recursive: true });
console.log(`markings.report: ${JSON.stringify(markings.pieceReport.byGlyph)} on ${markings.pieceReport.records.length} records, ${markings.pieceReport.unrecorded} without a record`);
const humps = markings;
const humpNodes = await buildHumpMeshes({ glb, humps: humps.humps, surface, ao: aoTexture });

// ---------------------------------------------------------------- ground partition (lib/partition.mjs)
// The ground is one planar partition: the ground classes claim by precedence (aprons, tiles, walkways, gutters, roads,
// lots, sports), then the natural Topography takes what is left, so no two ground triangles share area and every piece
// lies on the terrain (plus the walkway slab or a hump's arc). The road markings are not cut out of it
// (lib/groundNodes.mjs): they claim in a partition of their own (paint against paint) and lie MARKING_LIFT_M above the
// intact ground under them, so moving or deleting a marking leaves whole pavement.
const outerTerrain = await buildOuterTerrain({ glb, inputs });
const outerHeightAt = meshHeightAt(outerTerrain.positions, outerTerrain.indices);
// The hill ring is partitioned too: ground pieces beyond EXTENT (off-campus lots and courts) and the context streets
// claim their ground on it, and the OuterTerrain takes the rest (stages/outerTerrain.mjs emit, at the end).
const tin = new TinPartition(outerTerrain.positions, outerTerrain.indices);
const partition = new GroundPartition(surface.grid);
const inExtentXZ = (x, z) => x >= EXTENT.minX && x <= EXTENT.maxX && z >= EXTENT.minZ && z <= EXTENT.maxZ;
// pieces are cut along the EXTENT edges first, so each part goes to the Topography grid or to the hill ring
const extentCuts = [(p) => p[0] - EXTENT.minX, (p) => EXTENT.maxX - p[0], (p) => p[1] - EXTENT.minZ, (p) => EXTENT.maxZ - p[1]];
const claim = (piece) => {
  const out = [];
  let rest = piece;
  for (const f of extentCuts) {
    if (!rest) break;
    const { inside, outside } = splitByLine(rest, f);
    if (outside) out.push(...tin.claimOnTin(outside).map((part) => part.poly));
    rest = inside;
  }
  if (rest) out.push(...partition.claim(rest));
  return out;
};
const paintPartition = new GroundPartition(surface.grid);
// the ground under a piece: the Topography inside EXTENT, the hill ring beyond it
const groundSurface = {
  grid: surface.grid,
  height: (x, z) => (inExtentXZ(x, z) ? surface.height(x, z) : outerHeightAt(x, z) ?? surface.height(x, z)),
  normal: (x, z) => surface.normal(x, z),
};
// metres of the walkway slab under a ground piece, the walkway decal just under the kerb top (stages/kerbs.mjs)
const slabDecal = (x, z) => {
  const slab = kerbPlan.plan.slabHeight(x, z);
  return slab - SLAB_DECAL_DROP_M * Math.min(1, slab / 0.03);
};

console.log(`humps: ${humpNodes} from road-section records`);
let stageStart = performance.now();
const stageTime = (label) => { console.log(`ground partition: ${label} in ${((performance.now() - stageStart) / 1000).toFixed(1)} s, ${partition.cells.size} cells`); stageStart = performance.now(); };
const excludedParcelIds = new Set(surfaces.paintExcludedDetail.map(p => p.parcel));
const paintExclusions = surfaces.parcels.filter(p => excludedParcelIds.has(p.id) && !p.paintAllowed)
  .map(p => [p.ring, ...p.holes].map(r => r.map(([e,n]) => tmToScene(e,n))));
// the paint is cut along the hump tops' outlines, so no paint face spans a hump's raised edge
const humpOutlines = humpLayers(humps.humps).map((layer) => layer.rings[0].map(([e, n]) => tmToScene(e, n)));
const markingMesh = await buildMarkings({ glb, markings, surface: groundSurface, extraHeight: humps.heightAt, claim: (piece) => paintPartition.claim(piece), baseOffset: slabDecal, exclusions: paintExclusions, splits: humpOutlines });
const markingReport = {
  symbols: { ...markings.pieceReport, ...markingMesh.roadEmission.summary },
  emission: markingMesh.roadEmission,
  paintEmission: markingMesh.paintEmission,
  implausibleStalls: implausibleStalls(parkingDoc),
  pieces: markings.pieces.map(({ id, record, objectId, partId, ownerId, kind, colour, glyph, estimated, estimatedFields }) => ({ id: id ?? null, record: record ?? null, objectId: objectId ?? null, partId: partId ?? null, ownerId: ownerId ?? null, kind, colour, glyph: glyph ?? null, estimated: Boolean(estimated), ...(estimatedFields ? { estimatedFields } : {}) })),
};
stageTime("road markings");
const kerbs = await buildKerbs({ glb, surface, prepared: kerbPlan });
const tactile = planTactile(kerbs.plan);
console.log(`tactile: ${tactile.bands} bands at ${tactile.dropped} dropped kerbs (${tactile.layers.length - tactile.bands} guidance strips; 0.3 m modules, yellow, estimated placement)`);
const groundLayers = [...layers, ...kerbs.gutters, ...tactile.layers, ...humpLayers(humps.humps)]
  .map((layer, order) => ({ layer, order }))
  .sort((a, b) => b.layer.precedence - a.layer.precedence || b.order - a.order)
  .map(({ layer }) => layer);
// The ground under the paint is not decimated, so it keeps the height the paint was lifted from.
console.log(describeSurfaces(await buildSurfaceMeshes({
  glb, layers: groundLayers, surface: groundSurface, ao: aoTexture, claim,
  lockFace: footprintCover(markings.pieces.map((piece) => piece.rings)),
  heightOffset: (layer, x, z) => (layer.hump ? humps.heightAt(x, z) : layer.walkway || layer.tactile ? slabDecal(x, z) : 0),
  refine: { maxEdgeM: 0.25, needsFine: (layer, p, reach) => layer.hump || ((layer.walkway || layer.tactile) && kerbs.plan.nearSlabChange(p, reach / SCENE_UNITS_PER_METRE)) },
})));
stageTime("ground surfaces");
const topography = buildTopography(claim);
stageTime("natural Topography");
console.log(`ground partition: ${partition.cells.size} terrain triangles hold ground; Topography ${topography.triangles} natural triangles in ${topography.chunks} chunks`);
// Furniture and lamps stand on the raised walkway slab where there is one (stages/kerbs.mjs).
const { lamps, stats: lampStats, sites } = placeLamps({ inputs, furniture, selectableBuildings, campusBuildings, offCampusLots, groundInfo });
const furnitureScratch = new GlbBuilder();
const { glow } = buildFurniture({ glb: furnitureScratch, furniture, lamps, lampStats, sites, inputs, groundAt, wheelStops: parking.wheelStops });
const { objects, objectNumbers } = furnitureObjects({ glb, scratch: furnitureScratch, furniture, lamps, wheelStops: parking.wheelStops, glow });
const treeInstances = await buildTrees({ glb, placement: treePlacement });
buildLights({ glb, lamps, stats: lampStats, groundAt, glow, objects });
const objectNodes = emitObjectNodes(glb, objects, { objectNumbers });
console.log(`object nodes: ${objectNodes.length} (${Object.entries(Object.groupBy(objectNodes, (node) => node.category)).map(([category, list]) => `${category} ${list.length}`).join(", ")})`);
// Off-campus context masses on the drawn terrain (stages/context.mjs): merged per tile, not selectable, heights 추정.
const inExtent = (x, z) => x >= EXTENT.minX && x <= EXTENT.maxX && z >= EXTENT.minZ && z <= EXTENT.maxZ;
const contextGround = (x, z) => (inExtent(x, z) ? groundAt(x, z) : outerHeightAt(x, z) ?? groundAt(Math.min(Math.max(x, EXTENT.minX), EXTENT.maxX), Math.min(Math.max(z, EXTENT.minZ), EXTENT.maxZ)));
buildContext({ glb, parts: contextParts, groundAt: contextGround });
// The streets around the campus beyond EXTENT (stages/contextGround.mjs): OSM centrelines on the OuterTerrain ring, merged
// per tile, not part of the road network; widths and lanes 추정. Added last, so nothing above changes.
await buildContextGround({
  glb, tin, layers, paint: markings.pieces, heightAt: outerHeightAt,
  footprints: [...contextParts.map((p) => p.outer), ...[...selectableBuildings, ...campusBuildings].flatMap((b) => b.parts.map((p) => p.outer))],
});
// Free-standing lattice telecom masts off campus (stages/masts.mjs), on the context roofs they stand on; heights 추정.
buildMasts({ glb, parts: contextParts, groundAt: contextGround });
const outerEmitted = outerTerrain.emit(tin);
console.log(`OuterTerrain: ${outerEmitted.cut} triangles cut around the context streets, ${outerEmitted.triangles} triangles drawn`);

// ---------------------------------------------------------------- height sidecar
// The ground the traffic agents stand on (scene units): the drawn Topography plus the raised walkway slab
// (kerbs.groundHeightAt), sampled every HEIGHT_STEP units over EXTENT, row-major with x fastest and rows running south
// from originZ: little-endian u16 centimetres above minY, so a sample's scene-unit height is minY + value * scale.
// meta.probes lists grid points on full-height slab ("walkway") and on bare road ("road") with the generator's own
// ground and terrain heights, so src/terrain/heightfield.test.mjs can check the shipped file against the generator.
function writeHeightSidecar(heightAt, terrainAt, slabAt, labelAt) {
  for (const span of [EXTENT.maxX - EXTENT.minX, EXTENT.maxZ - EXTENT.minZ]) {
    if (!Number.isInteger(span / HEIGHT_STEP)) throw new Error(`EXTENT span ${span} is not a whole number of ${HEIGHT_STEP} steps`);
  }
  const width = (EXTENT.maxX - EXTENT.minX) / HEIGHT_STEP + 1;
  const height = (EXTENT.maxZ - EXTENT.minZ) / HEIGHT_STEP + 1;
  const samples = new Float64Array(width * height);
  const candidates = { walkway: [], road: [] };
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const x = EXTENT.minX + i * HEIGHT_STEP;
      const z = EXTENT.minZ + j * HEIGHT_STEP;
      samples[j * width + i] = heightAt(x, z);
      if (i % 8 || j % 8) continue;
      const slab = slabAt(x, z);
      if (slab >= KERB_EXPOSED_M - 1e-9) candidates.walkway.push([x, z]);
      else if (slab === 0 && labelAt([x, z]) === SURFACE_CLASS.ASPHALT) candidates.road.push([x, z]);
    }
  }
  const probes = Object.entries(candidates).flatMap(([kind, points]) => Array.from({ length: Math.min(PROBES_PER_KIND, points.length) }, (_, k) => {
    const [x, z] = points[Math.floor(((k + 0.5) * points.length) / Math.min(PROBES_PER_KIND, points.length))];
    return { kind, x, z, groundY: heightAt(x, z), terrainY: terrainAt(x, z) };
  }));
  const minY = samples.reduce((min, y) => Math.min(min, y), Infinity);
  const scale = SCENE_UNITS_PER_METRE / 100;
  const view = new DataView(new ArrayBuffer(samples.length * 2));
  samples.forEach((y, k) => {
    const value = Math.round((y - minY) / scale);
    if (!(value >= 0 && value <= 0xffff)) throw new Error(`height ${y} at sample ${k} does not fit the u16 sidecar`);
    view.setUint16(k * 2, value, true);
  });
  return {
    bytes: new Uint8Array(view.buffer),
    meta: {
      width, height, originX: EXTENT.minX, originZ: EXTENT.minZ, step: HEIGHT_STEP, minY, scale,
      includesKerbSlab: true,
      includesHumps: true,
      note: "생성기 지형 + 인도 단차 + 과속방지턱(추정), 측량값 아님",
      probes,
    },
  };
}

// ---------------------------------------------------------------- collections
// Every root node goes under a collection node (lib/glb.mjs groupRoots), so a DCC tool's outliner reads as layers.
// Order matters: the first match wins. A root no rule takes throws.
const startsWith = (...prefixes) => (name) => prefixes.some((p) => name.startsWith(p));
const collections = glb.groupRoots([
  { path: "Buildings/Entrances", match: startsWith("SD-", "ENT_") },
  // the generator's invisible pick prisms of named campus buildings: their own collection, so one click hides them
  { path: "Pick_Proxies", match: startsWith("BLD_SCNU_") },
  { path: "Buildings", match: (name) => name.startsWith("BLD_") || name === "CampusBuildings" },
  { path: "Context/Ground", match: startsWith("Context_Far_Ground_", "Ground_Context_", "OuterTerrain") },
  { path: "Context/Buildings", match: startsWith("Context_Buildings_", "Context_Far_", "Context_Mast_") },
  { path: "Ground/Terrain", match: (name) => name === "Topography" },
  { path: "Ground/Surfaces", match: startsWith("Ground_") },
  { path: "Ground/Kerbs", match: (name) => name === "Kerbs" },
  { path: "Vegetation", match: startsWith("Trees_") },
  { path: "Furniture", match: startsWith("Furniture") },
  { path: "Lighting", match: startsWith("Lamps_") },
]);
console.log(`collections: ${[...collections.keys()].join(", ")}`);

// ---------------------------------------------------------------- write
// Frame v2 tags sit beside the AO tags stages/buildings.mjs writes; lib/frame.mjs campusModelAsset reads them.
glb.json.asset.extras = { ...glb.json.asset.extras, ...frameAssetExtras() };
const bytes = glb.toBuffer();
await mkdir(path.dirname(OUTPUT), { recursive: true });
await Bun.write(OUTPUT, bytes);
await Bun.write(path.join(path.dirname(OUTPUT), "markings.report.json"), `${JSON.stringify({
  ...markingReport, rawGlbSha256: createHash("sha256").update(bytes).digest("hex"),
})}\n`);
// Preserve the actual selected footprints and all emitted paint, including parking.
// The orchestrator adds independent repeat-build hashes and packed application receipts.
if (candidate && !args.includes("--repeat")) {
  const readDoc = name => JSON.parse(readFileSync(path.join(HERE, "data", name), "utf8"));
  const site = readDoc("photo/site-detail-anchors.json");
  const free = readDoc("free-standing-anchors.json");
  const rows = parkingDoc.lots.flatMap(lot => lot.rows);
  const sections = Object.values(readDoc("ground/road-sections.json")).flatMap(road => road.sections);
  const junctions = Object.values(readDoc("ground/junctions.json"));
  const anchored = [...entranceRecords, ...site.records, ...free.records];
  const footprintRows = groundFootprints.map(b => ({
    ...b,
    expectedParts: anchorFootprints[b.id].polygons.map(p => p[0]),
  }));
  const paintById = new Map();
  for (const piece of markingMesh.paintEmission) {
    if (!paintById.has(piece.id)) paintById.set(piece.id, { id: piece.id, triangles: [] });
    paintById.get(piece.id).triangles.push(...piece.triangles.map(t => t.map(q => sceneToTm(...q))));
  }
  await Bun.write(path.join(candidate.dir, "invariant-inputs.json"), JSON.stringify({
    groundFootprints: footprintRows, footprints: anchorFootprints,
    anchors: anchored.filter(r => r.anchor),
    evidenceRecords: [...anchored, ...parcelsDoc.parcels, ...rows, ...sections, ...junctions],
    parcels: parcelsDoc.parcels,
    paintPieces: [...paintById.values()],
  }));
}
// Record-defined humps raise the drawn road; the agents must climb them too.
const sidecar = writeHeightSidecar((x, z) => kerbs.groundHeightAt(x, z) + metresToUnits(humps.heightAt(x, z)), (x, z) => surface.height(x, z), kerbs.plan.slabHeight, labelAt);
await Bun.write(HEIGHT_BIN, sidecar.bytes);
await Bun.write(HEIGHT_JSON, `${JSON.stringify(sidecar.meta, null, 2)}\n`);
const treeCount = Object.values(treeInstances).reduce((sum, list) => sum + list.length, 0);
console.log(
  `campus-v2.glb: ${(bytes.length / 1048576).toFixed(2)} MiB, ${selectableBuildings.length} BLD nodes, ` +
  `${campusBuildings.length} other campus buildings, ${treeCount} trees ` +
  `(${Object.entries(treeInstances).map(([k, v]) => `${k} ${v.length}`).join(", ")}), ${markings.pieces.length} road-marking pieces ` +
  `(${markingMesh.triangles} triangles, ${markingMesh.vertices} vertices in ${markingMesh.nodes} element nodes, from ${markingMesh.sourceTriangles} before conforming to the terrain)`,
);
{
  const editable = glb.json.nodes.filter((node) => node.extras?.editable);
  const primitives = glb.json.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0);
  console.log(`editable nodes: ${editable.length} (${Object.entries(Object.groupBy(editable, (node) => node.extras.editable.category)).map(([category, list]) => `${category} ${list.length}`).join(", ")}); ${primitives} primitives in the raw GLB`);
}
console.log(
  `OuterTerrain: ${outerTerrain.vertexCount} vertices, ${outerTerrain.triangleCount} triangles ` +
  `(${outerTerrain.vertexCountBefore} / ${outerTerrain.triangleCountBefore} before simplify), ` +
  `COP30 vertical offset ${outerTerrain.offsetMetres.toFixed(2)} m; ${outerTerrain.attribution}`,
);
console.log(`raw model written to ${path.relative(FRONTEND, OUTPUT)}; bun run model:pack ships it`);
console.log(`campus-v2-height.bin: ${sidecar.meta.width} x ${sidecar.meta.height} u16, ${sidecar.bytes.length} B`);

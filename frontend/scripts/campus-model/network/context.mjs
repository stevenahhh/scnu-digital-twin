// Shared inputs of the network builders (sidewalks, crossings, fallback, connectors, buildNetwork), all in the
// simulation frame (metres east/north of the D4 anchor in EPSG:5186 TM; a pure translation of EPSG:5186):
//   walkways   NGII A003 features { ufid, widt, qual, scls, lines } (docs/assets/data/walkways_wgs84.geojson)
//   layers     network/surfaces.mjs class polygons (todo 8), rings converted to the simulation frame
//   buildings  footprint outers { id, rings } of every modelled building
//   crossings  CW_001-CW_031 polygons { id, ring }
//   kerbs      stages/kerbs.mjs planKerbs() result (todo 11) and its kerb lines in the simulation frame
//   roads      network/roads.mjs buildRoads() fed with the real ASPHALT / LOT layers
// Loading builds the GLB buildings in memory (no file is written), about 10-15 s.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneToTm, simulationToTm, tmToScene, tmToSimulation, wgs84ToSimulation } from "../../../src/geo/epsg5186.mjs";
import { EXTENT } from "../lib/frame.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";
import { PX, buildSurfaces, loadGroundFeatures, loadWalkways } from "./surfaces.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../../..");
export const PATHS = {
  walkways: path.join(REPO, "docs/assets/data/walkways_wgs84.geojson"),
  crosswalks: path.join(REPO, "docs/assets/data/crosswalks_wgs84.geojson"),
  roadZones: path.join(REPO, "docs/assets/data/road_zones_wgs84.geojson"),
  roadSegments: path.join(REPO, "backend/simulation/data/road_segments.geojson"),
  network: path.join(REPO, "backend/simulation/data/campus_transport_network.geojson"),
  baseline: path.join(REPO, "backend/simulation/data/campus_transport_network.derived-v1.geojson"),
  entrances: path.join(REPO, "backend/simulation/data/building_entrances.json"),
  elements: path.join(REPO, "common/data/common_elemetns.json"),
  elementsCopy: path.join(REPO, "backend/simulation/data/source/common_elemetns.json"),
  osmGround: path.join(HERE, "../data/osm-ground.json"),
  sidewalks: path.join(HERE, "../data/network/sidewalks.json"),
  estimatedWalkways: path.join(HERE, "../data/network/walkways.json"),
};

export const tmToSim = ([E, N]) => {
  const p = tmToSimulation(E, N);
  return [p.x, p.z];
};
export const simToTm = ([x, z]) => simulationToTm({ x, z });
export const sceneToSim = ([x, z]) => tmToSim(sceneToTm(x, z));
export const lonLatToSim = ([lon, lat]) => {
  const p = wgs84ToSimulation(lon, lat);
  return [p.x, p.z];
};

export const readJson = async (p) => JSON.parse(await Bun.file(p).text());

// Raw A003 features with their outlines in the simulation frame.
export function walkwayFeatures(geojson) {
  return geojson.features.map((f) => ({
    ufid: f.properties.ufid ?? null,
    widt: Number(f.properties.widt) || 0,
    qual: f.properties.qual ?? null,
    scls: f.properties.scls ?? null,
    lines: (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates).map((line) => line.map(lonLatToSim)),
  }));
}

export async function loadCrosswalks() {
  const data = await readJson(PATHS.crosswalks);
  return data.features.map((f) => ({ id: f.properties.id, ring: f.geometry.coordinates[0].map(lonLatToSim), name: f.properties.name ?? null }));
}

// Road-polygon layers for buildRoads (simulation frame): arterial/connector strips (ASPHALT not from the road zones and
// not an A003 walkway) and the car parks (LOT layers whose label is a driving surface, off-campus parcels excluded; the
// roundabout ring included, its island and rims not).
export function roadLayers(layers) {
  const ASPHALT = [];
  const LOT = [];
  layers.forEach((l, i) => {
    if (l.walkway) return;
    if (l.cls === "ASPHALT" && l.source !== "road-zone-measured") ASPHALT.push({ id: l.source_ref ?? `asphalt-${i}`, rings: l.rings, estimated: Boolean(l.estimated) });
    // off-campus lots are the parcels around off-campus buildings, not car parks
    if (l.cls === "LOT" && !String(l.source_ref).startsWith("off-campus lot") && (l.label === SURFACE_CLASS.ASPHALT || l.label === SURFACE_CLASS.LOT || l.paint?.kind === "roundabout")) {
      LOT.push({ id: l.source_ref ?? `lot-${i}`, rings: l.rings, estimated: Boolean(l.estimated) });
    }
  });
  return { ASPHALT, LOT };
}

let cached = null;
// Everything except the vehicle graph (roads.mjs imports this for its layers; loading roads here would be circular).
export async function loadSurfaceContext({ log = console.log } = {}) {
  if (cached) return cached;
  const { loadInputs } = await import("../stages/sources.mjs");
  const { loadFurniture } = await import("../stages/furniture.mjs");
  const { buildBuildings } = await import("../stages/buildings.mjs");
  const { GlbBuilder } = await import("../lib/glb.mjs");
  const { loadCrossings, planKerbs } = await import("../stages/kerbs.mjs");
  const inputs = await loadInputs();
  const furniture = loadFurniture();
  const quiet = console.log;
  console.log = () => {};
  let built;
  try {
    built = await buildBuildings({ glb: new GlbBuilder(), inputs, detailedStructures: furniture.detailedStructures });
  } finally {
    console.log = quiet;
  }
  const { selectableBuildings, campusBuildings, offCampusLots } = built;
  const allBuildings = [...selectableBuildings, ...campusBuildings];
  const surfaces = buildSurfaces({
    inputs,
    walkways: await loadWalkways(),
    groundFeatures: await loadGroundFeatures(),
    offCampusLots,
    buildings: allBuildings,
    crosswalks: inputs.crosswalks,
    warn: () => {},
  });
  // label raster at the ground stage resolution, for the kerb plan
  const width = Math.round((EXTENT.maxX - EXTENT.minX) * PX);
  const height = Math.round((EXTENT.maxZ - EXTENT.minZ) * PX);
  const labels = surfaces.labelRaster(width, height, ([E, N]) => {
    const [x, z] = tmToScene(E, N);
    return [(x - EXTENT.minX) * PX, (z - EXTENT.minZ) * PX];
  });
  const labelAtScene = ([x, z]) => {
    const i = Math.floor((x - EXTENT.minX) * PX);
    const j = Math.floor((z - EXTENT.minZ) * PX);
    return i < 0 || j < 0 || i >= width || j >= height ? SURFACE_CLASS.NATURAL : labels[j * width + i];
  };
  const kerbCrossings = await loadCrossings();
  const kerbPlan = planKerbs({
    walkways: surfaces.layers.filter((l) => l.walkway).map((l) => l.rings),
    outlines: surfaces.outlines,
    crossings: kerbCrossings,
    labelAt: labelAtScene,
    terrainAt: inputs.heightAt,
    warn: () => {},
  });
  const sceneToSimPt = (p) => sceneToSim(p);
  const kerbPieces = kerbPlan.pieces.map((piece) => ({ points: [sceneToSimPt(piece.p), sceneToSimPt(piece.q)], height_m: Number(kerbPlan.kerbHeight([(piece.p[0] + piece.q[0]) / 2, (piece.p[1] + piece.q[1]) / 2]).toFixed(3)), dropped: piece.dropped ?? null }));

  const layers = surfaces.layers.map((l) => ({ ...l, rings: l.rings.map((r) => r.map(tmToSim)) }));
  const buildings = allBuildings.flatMap((b) => b.parts.filter((p) => p.outer?.length >= 3).map((p) => ({ id: b.nodeName ?? b.nodeId ?? b.label ?? null, name: b.displayName ?? null, rings: [p.outer.map(sceneToSimPt)] })));
  const walkways = walkwayFeatures(await readJson(PATHS.walkways));
  const crossings = await loadCrosswalks();
  const elementsText = await Bun.file(PATHS.elements).text();
  const { elements } = JSON.parse(elementsText);
  const roadSegments = await readJson(PATHS.roadSegments);
  const baselineFile = Bun.file(PATHS.baseline);
  const oldNetwork = await readJson((await baselineFile.exists()) ? PATHS.baseline : PATHS.network);
  cached = {
    inputs, layers, buildings, walkways, crossings, roadSegments, elements, elementsText, oldNetwork,
    kerbs: { touched: kerbPlan.touched, dropped: kerbPlan.dropped.map((d) => ({ cwId: d.cwId, ufid: d.ufid })), pieces: kerbPieces, exposedM: kerbPlan.exposedM },
  };
  log(`network context: ${layers.length} surface layers, ${buildings.length} building parts, ${walkways.length} A003 features, ${crossings.length} crossings, ${kerbPieces.length} kerb pieces (${kerbPlan.touched.length} crossings with dropped kerbs)`);
  return cached;
}

// Surface context plus the vehicle centreline graph of roads.mjs fed with the real ASPHALT / LOT layers.
export async function loadNetworkContext({ log = console.log } = {}) {
  const ctx = await loadSurfaceContext({ log });
  if (ctx.roads) return ctx;
  const { buildRoads } = await import("./roads.mjs");
  const osmGround = await readJson(PATHS.osmGround);
  const roadZones = await readJson(PATHS.roadZones);
  ctx.roads = buildRoads({ roadZones, roadSegments: ctx.roadSegments, elements: ctx.elements, network: ctx.oldNetwork, osmLines: osmGround.osm.lines, layers: roadLayers(ctx.layers) });
  log(`roads: ${ctx.roads.edges.length} edges, ${ctx.roads.polygons.length} road/lot polygons`);
  return ctx;
}

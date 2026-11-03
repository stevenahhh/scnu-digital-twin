// Shared TM footprint boundary for wall anchors. C1 splits use the same nodeFootprints as the mesh stage.
import { readFileSync } from "node:fs";
import { nodeFootprints } from "../stages/buildings.mjs";
import { ringCentroid } from "./geometry.mjs";
import { sceneToTm, tmToScene, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";

export function tmFootprints({ nodes, records, nodeMap }) {
  const standing = records.filter(r => r.status !== "demolished" && r.status !== "removed");
  const parts = standing.flatMap(r => r.polygonsTm.map(polygon => {
    const [outer, ...holes] = polygon.map(ring => ring.map(p => tmToScene(...p)));
    return { outer, holes, centroid: ringCentroid(outer), footprintSource: r.footprintSource, footprintEstimated: r.estimated === true };
  }));
  const selected = nodeFootprints({ bldNodes: nodes, footprintParts: parts, nodeMap });
  const consumed = new Set([...selected.values()].map(f => f.footprintSource));
  const footprints = Object.fromEntries([...selected].map(([id, fp]) => {
    const shapes = fp.parts.length ? fp.parts : [nodes.find(n => n.rawName === id).footprint];
    return [id, {
      polygons: shapes.map(p => [p.outer, ...p.holes].map(r => r.map(q => sceneToTm(...q)))),
      estimated: fp.footprintEstimated, footprintSource: fp.footprintSource,
      walls: nodeMap.entries.find(e => e.nodeId === id).walls,
    }];
  }));
  for (const r of standing) {
    const source = r.footprintSource.replace(/^OSM way\/(\d+).*$/, "osm:way/$1");
    if (!r.nodeId || consumed.has(source)) continue;
    footprints[r.nodeId] = { polygons: r.polygonsTm, estimated: r.estimated === true,
      footprintSource: source, walls: nodeMap.additionalWalls?.[r.nodeId] };
  }
  return footprints;
}

export async function loadTmFootprints(nodeMap = JSON.parse(readFileSync(new URL("../data/bld-node-map.json", import.meta.url), "utf8"))) {
  const { loadSourceModel, meshFootprint } = await import("../stages/sources.mjs");
  const source = await loadSourceModel();
  const nodes = source.scene.children.flatMap((object, i) => object.isMesh && source.rawNames[i].startsWith("BLD_")
    ? [{ rawName: source.rawNames[i], footprint: meshFootprint(object) }] : []);
  const records = ["gis-buildings", "vr-buildings"].flatMap(name =>
    JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8")).buildings)
    .map(r => ({ ...r, polygonsTm: r.polygons.map(p => p.map(ring => ring.map(q => wgs84ToTm(...q)))) }));
  return tmFootprints({ nodes, records, nodeMap });
}

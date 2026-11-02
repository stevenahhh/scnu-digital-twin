// Writes data/bld-node-map.json once (design §3, §11): each uni.glb BLD_* node -> the GIS 건물통합정보 record whose
// footprint overlaps its outline with IoU >= 0.5. Nodes without such a match get gis:null and fail
// lib/schemas.mjs validate("bldNodeMap") until they are curated by hand (gis, curated:true, reason). Curated entries
// already in the file are kept as they are, so a rerun never overwrites a hand decision.
//   bun scripts/campus-model/fetch/bldNodeMap.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pointInRing, ringCentroid } from "../lib/geometry.mjs";
import { metres } from "../lib/frame.mjs";
import { validate } from "../lib/schemas.mjs";
import { loadSourceModel, meshFootprint, toModelRing } from "../stages/sources.mjs";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const OUTPUT = path.join(DATA, "bld-node-map.json");
const MIN_IOU = 0.5;
const CELL = metres(0.25);

const bboxOf = (rings) => {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of rings.flat()) {
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], z);
    box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], z);
  }
  return box;
};
const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
// A shape is a list of { outer, holes } parts; a point is inside when it is in some outer ring and none of its holes.
const inside = (point, shape) => shape.some(({ outer, holes }) => pointInRing(point, outer) && !holes.some((h) => pointInRing(point, h)));

// Raster IoU on a 0.25 m grid over the union bbox of both shapes.
function iou(a, boxA, b, boxB) {
  const [x0, z0] = [Math.min(boxA[0], boxB[0]), Math.min(boxA[1], boxB[1])];
  const [x1, z1] = [Math.max(boxA[2], boxB[2]), Math.max(boxA[3], boxB[3])];
  let both = 0;
  let either = 0;
  for (let x = x0 + CELL / 2; x < x1; x += CELL) {
    for (let z = z0 + CELL / 2; z < z1; z += CELL) {
      const inA = inside([x, z], a);
      const inB = inside([x, z], b);
      if (inA && inB) both += 1;
      if (inA || inB) either += 1;
    }
  }
  return either ? both / either : 0;
}

const round = (value, digits) => Number(value.toFixed(digits));

const source = await loadSourceModel();
const nodes = source.scene.children.flatMap((object, index) =>
  object.isMesh && source.rawNames[index].startsWith("BLD_") ? [{ nodeId: source.rawNames[index], footprint: meshFootprint(object) }] : []);
const records = JSON.parse(readFileSync(path.join(DATA, "gis-buildings.json"), "utf8")).buildings
  .filter((b) => b.status !== "demolished" && b.status !== "removed")
  .map((b) => {
    const shape = b.polygons.map((polygon) => {
      const [outer, ...holes] = polygon.map(toModelRing);
      return { outer, holes };
    });
    return { record: b, shape, box: bboxOf(shape.map((s) => s.outer)) };
  });
const previous = existsSync(OUTPUT) ? new Map(JSON.parse(readFileSync(OUTPUT, "utf8")).entries.map((e) => [e.nodeId, e])) : new Map();

const entries = nodes.map(({ nodeId, footprint }) => {
  if (previous.get(nodeId)?.curated) return previous.get(nodeId);
  const shape = [{ outer: footprint.outer, holes: footprint.holes }];
  const box = bboxOf([footprint.outer]);
  const [best] = records.filter((r) => overlaps(box, r.box))
    .map((r) => ({ ...r, iou: iou(shape, box, r.shape, r.box) }))
    .sort((p, q) => q.iou - p.iou);
  const uniCentreScene = ringCentroid(footprint.outer).map((v) => round(v, 3));
  const matched = best && best.iou >= MIN_IOU;
  const largest = matched && best.shape.reduce((p, q) => (q.outer.length > p.outer.length ? q : p));
  return {
    nodeId,
    gis: matched ? { footprintSource: best.record.footprintSource, pnu: best.record.pnu ?? null, name: best.record.name || null } : null,
    gisCentreTm: matched ? sceneToTm(...ringCentroid(largest.outer)).map((v) => round(v, 2)) : null,
    uniCentreScene,
    iou: best ? round(best.iou, 3) : null,
    ...(matched ? {} : { bestCandidate: best ? { footprintSource: best.record.footprintSource, name: best.record.name || null } : null }),
    curated: false,
  };
});

writeFileSync(OUTPUT, `${JSON.stringify({
  source: "uni.glb BLD_* nodes matched to data/gis-buildings.json (GIS건물통합정보) by footprint IoU >= 0.5 on a 0.25 m grid; " +
    "gis:null entries are curated by hand (curated:true, reason). Written by fetch/bldNodeMap.mjs.",
  entries,
}, null, 2)}\n`);
for (const e of entries) console.log(`${e.nodeId}\t${e.gis?.footprintSource.replace(/^.* record /, "record ") ?? "null"}\t${e.iou}`);
const { ok, errors } = validate("bldNodeMap", { entries });
console.log(`${entries.length} entries; validate: ${ok ? "ok" : `${errors.length} errors`}`);
for (const error of errors) console.error(error);

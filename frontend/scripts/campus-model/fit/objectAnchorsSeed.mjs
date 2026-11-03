// Preserve the original survey as the seed. Generated anchor records never promote roof centres to T1.
// Run from frontend: bun scripts/campus-model/fit/objectAnchorsSeed.mjs --write
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sceneToTm, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { loadFurniture } from "../stages/furniture.mjs";
import { pointInRing } from "../lib/geometry.mjs";
import { positionObject, anchorObject } from "./objectPlacement.mjs";

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
const parcelList = readJson("../data/ground/parcels.json").parcels;
const parcels = Object.fromEntries(parcelList.map(p => [p.id, p]));
const roots = new Map(readJson("../data/photo/pole-roots.json").poles.map(p => [p.id, p]));
const stations = new Map(readJson("../../perf/vr-stations.json").map(s => [s.scene, s]));
const furniture = loadFurniture();
const records = [];
for (const object of furniture.objects.filter(o => o.source !== "site-detail")) {
  const shape = object.point ? [object.point] : object.footprint ?? object.ring ?? object.line;
  const centre = shape.reduce((sum, p) => sum.map((v, i) => v + p[i] / shape.length), [0, 0]);
  const point = sceneToTm(...centre);
  const containing = parcelList.filter(p => pointInRing(point, p.ring) && !(p.holes ?? []).some(h => pointInRing(point, h)));
  const candidates = containing.length ? containing : parcelList;
  const distance = (p) => Math.min(...p.ring.map(q => Math.hypot(q[0] - point[0], q[1] - point[1])));
  const parcel = [...candidates].sort((a, b) => (containing.length ? b.precedence - a.precedence : 0) ||
    distance(a) - distance(b) || a.id.localeCompare(b.id))[0];
  const seed = { id: object.id, point, parcel: parcel.id };
  const root = roots.get(object.id);
  // Existing base reviews, not roof/head picks. Head-lean and old single-station vr-root remain T4.
  if (root?.root && ["shadow-root", "by-eye-root", "epoch-root"].includes(root.verdict)) {
    seed.photo = { point: wgs84ToTm(...root.root), base: true, occluded: false,
      residualM: root.residualM, ref: `data/photo/pole-roots.json ${root.id} ${root.verdict}; ${root.note}` };
  }
  if (object.p.vr_scene && ["f", "r", "b", "l"].includes(object.p.vr_face) && Array.isArray(object.p.vr_cols)) {
    const col = (object.p.vr_cols[0] + object.p.vr_cols[1]) / 2;
    seed.observations = [{ station: stations.get(object.p.vr_scene), reading: { face: object.p.vr_face, col } }];
  }
  const sourceReading = /VR (scene_[a-z0-9_]+) ([frbl]) col (\d+)/.exec(object.p.source ?? "");
  if (!seed.observations && sourceReading) {
    seed.observations = [{ station: stations.get(sourceReading[1]),
      reading: { face: sourceReading[2], col: Number(sourceReading[3]) } }];
  }
  const placement = positionObject(seed, parcels);
  if (object.p.vr_face === "d") placement.evidence.refs.push(`nadir face ${object.p.vr_scene}/d is not a horizontal column bearing`);
  placement.evidence.refs.push(`source=${object.source}; kind=${object.kind}; method=${object.p.method ?? object.p.position_method ?? "unrecorded"}`);
  if (!containing.length) {
    placement.parcelRelation = "nearest_boundary";
    placement.evidence.refs.push(`outside all curated parcels; nearest parcel vertex ${distance(parcel).toFixed(3)} m`);
  } else placement.parcelRelation = "inside";
  if (root && placement.evidence.tier === "T4") {
    placement.evidence.refs.push(`retained pole verdict=${root.verdict}; root/seed uncertainty=${root.residualM ?? root.seedUncertaintyM ?? "unknown"} m`);
  }
  if (object.kind === "stadium_seating") {
    placement.rows = { count: object.p.seat_rows, estimated: true, ref: object.p.seat_rows_note };
  }
  records.push(anchorObject(object, placement, parcels));
}
const document = {
  frameVersion: 2,
  generator: "scripts/campus-model/fit/objectAnchorsSeed.mjs",
  note: "Proposal only, not connected to the model generator. Visual values are estimated. Existing visible pole-base reviews retain T1; all other unverified positions remain T4. Site-detail is owned by todo 20. Source geometry is checked before applying anchors.",
  records,
};
const output = new URL("../data/free-standing-anchors.json", import.meta.url);
const encoded = JSON.stringify(document, null, 2) + "\n";
if (process.argv.includes("--write")) writeFileSync(output, encoded);
else if (process.argv.includes("--check") && readFileSync(output, "utf8") !== encoded) {
  throw new Error("stale free-standing-anchors.json: review inputs and rerun --write");
}
console.log(JSON.stringify({ output: fileURLToPath(output), records: records.length,
  tiers: Object.fromEntries(["T1", "T2", "T4"].map(t => [t, records.filter(r => r.evidence.tier === t).length])),
  outsideParcels: records.filter(r => r.parcelRelation === "nearest_boundary").length }));

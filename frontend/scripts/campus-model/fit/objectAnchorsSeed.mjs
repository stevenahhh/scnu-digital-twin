// Preserve the original survey as the seed. Generated anchor records never promote roof centres to T1.
// Run from frontend: bun scripts/campus-model/fit/objectAnchorsSeed.mjs --write
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sceneToTm, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { loadFurnitureSurvey } from "../stages/furniture.mjs";
import { pointInRing } from "../lib/geometry.mjs";
import { positionObject, anchorObject } from "./objectPlacement.mjs";
import { objectObservations } from "./vrObjectObservations.mjs";

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
const parcelList = readJson("../data/ground/parcels.json").parcels;
const parcels = Object.fromEntries(parcelList.map(p => [p.id, p]));
const roots = new Map(readJson("../data/photo/pole-roots.json").poles.map(p => [p.id, p]));
const stations = new Map(readJson("../../perf/vr-stations.json").map(s => [s.scene, s]));
const reviewed = new Map(objectObservations(readJson("../data/free-standing-vr.json"), [...stations.values()]).map(r => [r.id, r]));
const furniture = loadFurnitureSurvey();
const finalFile = new URL("../data/free-standing-pole-placements.json", import.meta.url);
const reconcileIndex = process.argv.indexOf("--reconcile-glb");
if (reconcileIndex >= 0) {
  const bytes = readFileSync(process.argv[reconcileIndex + 1]);
  const packed = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  if (packed.asset.extras.frameVersion !== 2) throw new Error("stale packed frame");
  const extras = packed.nodes.find(n => n.name === "Furniture" && n.extras?.poles).extras;
  writeFileSync(finalFile, JSON.stringify({
    frameVersion: 2, estimated: true, method: "Furniture.extras.poles after checkPoles; 0.01 scene-unit serialization",
    poles: extras.poles.map(p => ({ id: p[0], pointScene: p.slice(5, 7) })),
  }, null, 2) + "\n");
}
const finalPoles = readJson("../data/free-standing-pole-placements.json");
const finalized = new Map(finalPoles.poles.map(p => [p.id, p.pointScene]));
const records = [];
for (const object of furniture.objects.filter(o => o.source !== "site-detail")) {
  const shape = object.point ? [object.point] : object.footprint ?? object.ring ?? object.line;
  const centre = shape.reduce((sum, p) => sum.map((v, i) => v + p[i] / shape.length), [0, 0]);
  const point = sceneToTm(...(finalized.get(object.id) ?? centre));
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
  } else if (object.p.method === "vr+photo" && object.p.pole_verdict === "by-eye-root") {
    seed.photo = { point: sceneToTm(...centre), base: true, occluded: false, residualM: object.p.residual_m,
      ref: `data/photo/vr-lamps.geojson ${object.id}; ${object.p.source}; ${object.p.vrFix?.note ?? ""}` };
  }
  const observation = reviewed.get(object.id);
  if (observation?.col !== null && observation?.col !== undefined) {
    seed.observations = [{ station: stations.get(observation.scene), reading: { face: observation.face, col: observation.col } }];
  }
  const sourceReading = /VR (scene_[a-z0-9_]+) ([frbl]) col (\d+)/.exec(object.p.source ?? "");
  if (!seed.observations && sourceReading) {
    seed.observations = [{ station: stations.get(sourceReading[1]),
      reading: { face: sourceReading[2], col: Number(sourceReading[3]) } }];
  }
  const placement = positionObject(seed, parcels);
  placement.vrObservations = observation ? [observation] : [];
  for (const check of placement.bearingChecks) check.diagnosticOnly = true;
  if (observation) placement.evidence.refs.push(`reviewed same-object VR silhouette: data/free-standing-vr.json ${object.id}; ${observation.reason}; estimated`);
  else if (object.p.vr_cols) placement.evidence.refs.push(`legacy visibility range ${object.p.vr_cols.join("..")} is not a same-object observation; no centroid inferred`);
  if (finalized.has(object.id)) placement.evidence.refs.push(
    "final pole placement: data/free-standing-pole-placements.json, reconciled from packed Furniture.extras.poles after checkPoles; photo bases retain priority");
  if (object.p.vr_face === "d") placement.evidence.refs.push(`nadir face ${object.p.vr_scene}/d is not a horizontal column bearing`);
  placement.evidence.refs.push(`source=${object.source}; kind=${object.kind}; method=${object.p.method ?? object.p.position_method ?? "unrecorded"}`);
  if (object.source === "plaza-benches") placement.row = {
    count: object.p.count, pitchM: object.p.spacing_m, estimated: true, ref: object.p.position_method,
  };
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
  note: "Production parcel anchors. Visual values are estimated. Existing visible pole-base reviews retain T1 even if a single VR bearing conflicts; both numbers are recorded, never fitted by moving the base. Site-detail is owned by todo 20. Source geometry is checked before applying anchors.",
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

// Audit the production parcel placement. This is not a GLB-render acceptance check.
// Usage: bun scripts/campus-model/qa/freeStanding.mjs --out <evidence-prefix>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sceneToTm, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { scoreObjects } from "./mapCompare.mjs";
import { resolveAnchor } from "../lib/anchors.mjs";

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
const document = readJson("../data/free-standing-anchors.json");
const parcels = Object.fromEntries(readJson("../data/ground/parcels.json").parcels.map(p => [p.id, p]));
if (document.frameVersion !== 2) throw new Error("stale free-standing anchor frame");
const roots = new Map(readJson("../data/photo/pole-roots.json").poles.map(p => [p.id, p]));
const bytes = readFileSync(new URL("../../../public/campus-v2.glb", import.meta.url));
const packed = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const glbSha256 = createHash("sha256").update(bytes).digest("hex");
const renderedIndex = process.argv.indexOf("--rendered-report");
const rendered = renderedIndex < 0 ? null : JSON.parse(readFileSync(process.argv[renderedIndex + 1], "utf8"));
if (rendered && rendered.inputs.modelSha256 !== glbSha256) throw new Error("stale rendered residual report: model hash differs");
if (packed.asset.extras.frameVersion !== 2) throw new Error("stale packed frame");
const extras = packed.nodes.find(n => n.name === "Furniture" && n.extras?.placementEvidence).extras;
const poles = new Map(extras.poles.map(p => [p[0], p.slice(5, 7)]));
const byId = new Map(extras.placementEvidence.map(p => [p.id, p]));
const ids = new Set();
const rows = document.records.map(record => {
  if (ids.has(record.id)) throw new Error(`${record.id}: duplicate anchor`);
  ids.add(record.id);
  const source = byId.get(record.id);
  if (!source) throw new Error(`${record.id}: unknown anchor source`);
  const point = sceneToTm(...(poles.get(record.id) ?? source.pointScene));
  const anchorPoint = resolveAnchor(record, {}, parcels).origin;
  const finalPoint = sceneToTm(...source.pointScene);
  const anchorDeltaM = Math.hypot(...anchorPoint.map((v, i) => v - finalPoint[i]));
  if (anchorDeltaM > 1e-6) throw new Error(`${record.id}: saved anchor differs from packed final position by ${anchorDeltaM} m; reconcile seed`);
  const root = roots.get(record.id);
  // A separately stored visual base pick can check the shadow detector. Reusing root as the reference
  // would certify the input against itself; do not do that for by-eye/epoch roots.
  const independent = root?.verdict === "shadow-root" && root.byEye ? wgs84ToTm(...root.byEye) : null;
  const [score] = scoreObjects([{ id: record.id, kind: record.id, geometry: { type: "point", coords: point } }],
    { w: 1, h: 1, origin: point, gsdM: 1, points: { [record.id]: independent ? [independent] : [] } });
  const bearings = rendered?.rows.filter(r => r.id === record.id) ?? [];
  return { id: record.id, kind: record.kind, evidenceTier: record.evidence.tier, estimated: true,
    point, finalPoint, anchorPoint, anchorDeltaM,
    pointSource: poles.has(record.id) ? "packed Furniture.extras.poles (0.01 scene-unit rounding)" : "packed Furniture.extras.placementEvidence.pointScene",
    residual_m: score.residual_m, support: score.support,
    reference: independent ? "pole-roots.byEye, separately stored visual pick" : null,
    reason: independent ? null : "no independent ground-base reference; no accuracy pass claimed",
    bearings, bearingStatus: bearings.length ? "rendered_same_object" : "no_rendered_correspondence",
    parcelRelation: record.parcelRelation };
});
for (const id of byId.keys()) if (!ids.has(id)) throw new Error(`${id}: missing anchor`);
const conflicts = rows.flatMap(r => r.bearings.filter(b => b.pass === false).map(b => ({ id: r.id, ...b })));
const report = {
  glbSha256,
  status: conflicts.length ? "CONFLICTS_ESTIMATED" : "UNVERIFIED",
  scope: "packed final placements after checkPoles, including two recorded plaza bench rows",
  renderedModelChanged: true,
  referenceReuseExcluded: true,
  records: rows.length,
  tiers: Object.fromEntries(["T1", "T2", "T4"].map(t => [t, rows.filter(r => r.evidenceTier === t).length])),
  pointReferences: rows.filter(r => r.reference).length,
  outsideParcels: rows.filter(r => r.parcelRelation === "nearest_boundary").length,
  bearingConflicts: conflicts,
  maxAnchorDeltaM: Math.max(...rows.map(r => r.anchorDeltaM)),
  unmeasurableBearings: rows.flatMap(r => r.bearings.filter(b => b.residualDeg === null).map(b => ({ id: r.id, reason: b.reason }))),
  rows,
};
const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0) {
  const prefix = process.argv[outIndex + 1];
  if (!prefix) throw new Error("--out requires an evidence prefix");
  writeFileSync(`${prefix}-objects.json`, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
// Never print success for a partial audit whose VR residuals exceed the design tolerance.
process.exitCode = conflicts.length ? 2 : 0;

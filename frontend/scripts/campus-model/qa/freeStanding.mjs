// Audit the production parcel placement. This is not a GLB-render acceptance check.
// Usage: bun scripts/campus-model/qa/freeStanding.mjs --out <evidence-prefix>
import { readFileSync, writeFileSync } from "node:fs";
import { sceneToTm, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { loadFurniture } from "../stages/furniture.mjs";
import { readBearing } from "../fit/vrWallHit.mjs";
import { scoreObjects } from "./mapCompare.mjs";

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
const document = readJson("../data/free-standing-anchors.json");
if (document.frameVersion !== 2) throw new Error("stale free-standing anchor frame");
const roots = new Map(readJson("../data/photo/pole-roots.json").poles.map(p => [p.id, p]));
const stations = new Map(readJson("../../perf/vr-stations.json").map(s => [s.scene, s]));
const objects = loadFurniture().objects.filter(o => o.source !== "site-detail");
const byId = new Map(objects.map(o => [o.id, o]));
const ids = new Set();
const rows = document.records.map(record => {
  if (ids.has(record.id)) throw new Error(`${record.id}: duplicate anchor`);
  ids.add(record.id);
  const source = byId.get(record.id);
  if (!source) throw new Error(`${record.id}: unknown anchor source`);
  const placed = source;
  const shape = placed.point ? [placed.point] : placed.footprint ?? placed.ring ?? placed.line;
  const centre = shape.reduce((sum, p) => sum.map((v, i) => v + p[i] / shape.length), [0, 0]);
  const point = sceneToTm(...centre);
  const root = roots.get(record.id);
  // A separately stored visual base pick can check the shadow detector. Reusing root as the reference
  // would certify the input against itself; do not do that for by-eye/epoch roots.
  const independent = root?.verdict === "shadow-root" && root.byEye ? wgs84ToTm(...root.byEye) : null;
  const [score] = scoreObjects([{ id: record.id, kind: record.id, geometry: { type: "point", coords: point } }],
    { w: 1, h: 1, origin: point, gsdM: 1, points: { [record.id]: independent ? [independent] : [] } });
  const bearings = record.evidence.refs.filter(ref => /^VR /.test(ref)).map(ref => {
    const match = /^VR (\S+) ([frbl]) col ([\d.]+)$/.exec(ref);
    if (!match) throw new Error(`${record.id}: malformed bearing ref ${ref}`);
    const ray = readBearing(stations.get(match[1]), { face: match[2], col: Number(match[3]) });
    if (ray.tier === "T4") return { ref, residualDeg: null, reason: ray.reason };
    const predicted = (Math.atan2(point[0] - ray.origin[0], point[1] - ray.origin[1]) * 180 / Math.PI + 360) % 360;
    const residualDeg = ((predicted - ray.bearingDeg + 540) % 360) - 180;
    return { ref, residualDeg, pass: Math.abs(residualDeg) <= 1.5, method: "anchor-centre projection, not rendered ID mask" };
  });
  return { id: record.id, kind: record.kind, evidenceTier: record.evidence.tier, estimated: true,
    point, residual_m: score.residual_m, support: score.support,
    reference: independent ? "pole-roots.byEye, separately stored visual pick" : null,
    reason: independent ? null : "no independent ground-base reference; no accuracy pass claimed",
    bearings, parcelRelation: record.parcelRelation };
});
for (const id of byId.keys()) if (!ids.has(id)) throw new Error(`${id}: missing anchor`);
const conflicts = rows.flatMap(r => r.bearings.filter(b => b.pass === false).map(b => ({ id: r.id, ...b })));
const report = {
  status: conflicts.length ? "CONFLICTS_ESTIMATED" : "UNVERIFIED",
  scope: "resolved non-site-detail loader objects, including two recorded plaza bench rows",
  renderedModelChanged: true,
  referenceReuseExcluded: true,
  records: rows.length,
  tiers: Object.fromEntries(["T1", "T2", "T4"].map(t => [t, rows.filter(r => r.evidenceTier === t).length])),
  pointReferences: rows.filter(r => r.reference).length,
  outsideParcels: rows.filter(r => r.parcelRelation === "nearest_boundary").length,
  bearingConflicts: conflicts,
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

import assert from "node:assert/strict";
import fs from "node:fs";
import { mock } from "bun:test";
import { fileURLToPath } from "node:url";
import { buildBuildings } from "./buildings.mjs";
import { loadInputs } from "./sources.mjs";
import { GlbBuilder } from "../lib/glb.mjs";
import { D4_SCENE_ANCHOR, metres } from "../lib/frame.mjs";
import { pointInRing, ringCentroid } from "../lib/geometry.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { addBalconies, addFins } from "../lib/attachments.mjs";

// Substitute input files at the read boundary only; never edit the shared data.
// The reference build disables only the anchor operation, retaining all walls,
// bridge parts and attachments, so a rigid shift cannot pass the position check.
const originalRead = fs.readFileSync;
const formFile = fileURLToPath(new URL("../data/building-forms.json", import.meta.url));
const mapFile = fileURLToPath(new URL("../data/bld-node-map.json", import.meta.url));
let referenceBuild = true;
let regeneratedBytes;
let regeneratedReads = 0;
if (process.argv.includes("--reseed")) {
  const regenerated = JSON.parse(originalRead(formFile, "utf8"));
  const d4 = regenerated.buildings.find(b => b.key === "BLD_D4");
  for (const index of [10, 14]) d4.masses[index].baseMetres = 22.74;
  delete d4.curation.geometry;
  delete d4.roofParts;
  regeneratedBytes = JSON.stringify(regenerated);
}
const fixtureRead = (file, options) => {
  if (String(file) === formFile && regeneratedBytes) {
    regeneratedReads++;
    return options === "utf8" ? regeneratedBytes : Buffer.from(regeneratedBytes);
  }
  if (String(file) === mapFile && referenceBuild) {
    const map = JSON.parse(originalRead(file, "utf8"));
    map.entries.find(e => e.nodeId === "BLD_D4").d4Geometry.anchorMode = "none";
    const bytes = JSON.stringify(map);
    return options === "utf8" ? bytes : Buffer.from(bytes);
  }
  return originalRead(file, options);
};
mock.module("node:fs", () => ({ ...fs, readFileSync: fixtureRead }));

const inputs = await loadInputs();
const referenceGlb = new GlbBuilder();
let referenceParts;
const referenceAddMesh = referenceGlb.addMesh.bind(referenceGlb);
referenceGlb.addMesh = (name, parts) => {
  if (name === "BLD_D4") referenceParts = parts;
  return referenceAddMesh(name, parts);
};
const referenceResult = await buildBuildings({ glb: referenceGlb, inputs });
assert.equal(referenceResult.selectableBuildings.find(b => b.nodeName === "BLD_D4").form.curation.geometry.anchorMode,
  "none", "the reference input must actually disable the anchor operation");
referenceBuild = false;
const glb = new GlbBuilder();
const primitives = new Map();
const addMesh = glb.addMesh.bind(glb);
glb.addMesh = (name, parts) => {
  primitives.set(name, parts);
  return addMesh(name, parts);
};
const result = await buildBuildings({ glb, inputs });
const building = result.selectableBuildings.find(b => b.nodeName === "BLD_D4");
const parts = primitives.get("BLD_D4");
if (process.argv.includes("--reseed")) assert.ok(regeneratedReads >= 2, "both builds must consume the substituted LOD4 file");
if (process.env.G_ANCHOR_ATTACHMENT_AUDIT) {
  const outside = p => !building.parts.some(part => pointInRing(p, part.outer));
  const charts = { open: () => 0, close: () => {} };
  for (const attachment of building.attachments) {
    const mesh = new MeshData({ colors: true });
    mesh.ao = [];
    const options = { colour: [255, 255, 255, 255], slabColour: [255, 255, 255, 255], outside };
    if (attachment.kind === "fins") addFins(mesh, attachment, building.groundScene, charts, options);
    else if (attachment.kind === "balconies") addBalconies(mesh, attachment, building.groundScene, charts, options);
    else throw new Error(`Unreviewed D4 attachment kind ${attachment.kind}`);
    const xs = mesh.positions.filter((_, i) => i % 3 === 0), zs = mesh.positions.filter((_, i) => i % 3 === 2);
    console.log("D4_ATTACHMENT", JSON.stringify({
      id: attachment.id, kind: attachment.kind,
      bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
    }));
  }
}
let maxWallDisplacement = 0, maxVisibleDisplacement = 0;
for (let p = 0; p < referenceParts.length; p++) {
  const before = referenceParts[p].positions, after = parts[p].positions;
  assert.equal(after.length - before.length, 0, "Frame v2 adds no anchor vertices to D4");
  for (let k = 0; k < before.length; k += 3) {
    const displacement = Math.hypot(after[k] - before[k], after[k + 1] - before[k + 1], after[k + 2] - before[k + 2]);
    maxVisibleDisplacement = Math.max(maxVisibleDisplacement, displacement);
    if (p === 0) maxWallDisplacement = Math.max(maxWallDisplacement, displacement);
  }
}
console.log("D4_POSITION", JSON.stringify({ maxWallDisplacement, maxVisibleDisplacement }));
assert.equal(maxWallDisplacement, 0, "D4 wall vertices must not move");
assert.equal(maxVisibleDisplacement, 0, "D4 roofs, bridge and attachments must not move");
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const p of parts) for (let i = 0; i < p.positions.length; i++) {
  min[i % 3] = Math.min(min[i % 3], p.positions[i]);
  max[i % 3] = Math.max(max[i % 3], p.positions[i]);
}
const centre = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2];
// Frame v2 (ffb3c6af): the dashboards recentre on BLD_D4's own bbox (src/simulation/utils/campusTrafficCoordinates.mjs),
// so the centre must stay where the published origin/dev-next 497fb952 raw GLB has it. Moving it to D4_SCENE_ANCHOR
// shifted every overhead QA tile by up to 4 px (lead-build-3, candidate-SZm5X0 versus baseline candidate-dSqGxV).
const FRAME_V2_D4_CENTRE = { x: 46.1857, z: -266.5969 };
const delta = Math.hypot(centre[0] - FRAME_V2_D4_CENTRE.x, centre[1] - FRAME_V2_D4_CENTRE.z);
const anchorPositions = parts[0].positions.slice(referenceParts[0].positions.length);
for (let k = 0; k < anchorPositions.length; k += 3) {
  assert.ok(anchorPositions[k + 1] <= inputs.heightAt(anchorPositions[k], anchorPositions[k + 2]) - metres(1.99),
    "anchor triangles must stay two metres below terrain");
}
const lower = building.parts.find(p => p.bridgeZone === "lower");
const upper = building.parts.find(p => p.bridgeZone === "upper");
const canopy = building.parts.find(p => p.massIndex === 12);
assert.ok(lower && upper, "D4 bridge needs separate lower and upper glazed blocks");
const [cx, cz] = ringCentroid(lower.outer);
// Intersect a vertical ray with the emitted triangles, not the source height.
const heights = [];
for (const p of parts) for (let k = 0; k < p.indices.length; k += 3) {
  const [a, b, c] = p.indices.slice(k, k + 3).map(i => Array.from(p.positions.slice(i * 3, i * 3 + 3)));
  const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(den) < 1e-10) continue;
  const u = ((b[2] - c[2]) * (cx - c[0]) + (c[0] - b[0]) * (cz - c[2])) / den;
  const v = ((c[2] - a[2]) * (cx - c[0]) + (a[0] - c[0]) * (cz - c[2])) / den;
  if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
  const y = u * a[1] + v * b[1] + (1 - u - v) * c[1];
  if (y > building.groundScene) heights.push((y - building.groundScene) / metres(1));
}
const soffit = Math.min(...heights);
console.log("D4_FIXTURE", JSON.stringify({
  reseed: process.argv.includes("--reseed"),
  centre, delta, soffit, ground: building.groundScene, maxWallDisplacement, maxVisibleDisplacement,
  anchorVertices: anchorPositions.length / 3,
  lower: [lower.baseMetres, lower.heightMetres],
  open: [lower.heightMetres, upper.baseMetres],
  upper: [upper.baseMetres, upper.heightMetres],
  skylightVertices: canopy.holes.at(-1).length,
}));
assert.ok(delta <= 0.05, `D4 anchor delta ${delta}`);
assert.ok(soffit >= 7.5 && soffit <= 10.5, `D4 soffit ${soffit}`);
assert.deepEqual([lower.heightMetres, upper.baseMetres], [17, 20.5]);
assert.ok(canopy.holes.at(-1).every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
if (process.env.G_ANCHOR_OUTPUT) {
  glb.json.scenes[0].nodes = [glb.json.nodes.findIndex(n => n.name === "BLD_D4")];
  await Bun.write(process.env.G_ANCHOR_OUTPUT, glb.toBuffer());
}

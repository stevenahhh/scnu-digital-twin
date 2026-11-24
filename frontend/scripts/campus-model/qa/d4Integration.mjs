// Additional D4 integration gate. Run against the candidate, never assume that
// public/campus-v2.glb was replaced by a rejected build.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { resolveAnchor } from "../lib/anchors.mjs";
import { loadTmFootprints } from "../lib/footprints.mjs";
import { D4_SCENE_ANCHOR, metres } from "../lib/frame.mjs";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";

const model = process.argv[2] ?? fileURLToPath(new URL("../../../public/campus-v2.glb", import.meta.url));
const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
const entries = read("buildings/entrances.json").records.filter(r => r.anchor.building === "BLD_D4");
const footprints = await loadTmFootprints();
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(model);
const nodes = doc.getRoot().listNodes();
const building = nodes.find(n => n.getName() === "BLD_D4");
const bounds = node => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const points = [];
  if (!node?.getMesh()) return { min, max, points };
  const m = node.getWorldMatrix();
  for (const primitive of node.getMesh().listPrimitives()) {
    const p = primitive.getAttribute("POSITION");
    for (let i = 0; i < p.getCount(); i++) {
      const [x, y, z] = p.getElement(i, []);
      const q = [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];
      points.push(q);
      q.forEach((v, k) => { min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); });
    }
  }
  return { min, max, points };
};
const b = bounds(building);
const centre = [(b.min[0]+b.max[0])/2, (b.min[2]+b.max[2])/2];
// Frame v2: the dashboards recentre on BLD_D4's bbox (campusTrafficCoordinates.mjs), so it must not move from
// the published origin/dev-next 497fb952 build, measured from its raw GLB: (46.1857, -266.5969) scene units.
const FRAME_V2_D4_CENTRE = { x: 46.1857, z: -266.5969 };
const anchorDelta = Math.hypot(centre[0]-FRAME_V2_D4_CENTRE.x, centre[1]-FRAME_V2_D4_CENTRE.z);
const doors = entries.map(entry => {
  const node = nodes.find(n => n.getName() === `${entry.id}/doors`);
  if (!node) return { id: entry.id, pass: false, error: "missing door mesh" };
  const f = resolveAnchor(entry, footprints);
  const d = bounds(node);
  const local = d.points.map(([x, , z]) => {
    const p = sceneToTm(x, z).map((v, k) => v-f.origin[k]);
    return [p[0]*f.a[0]+p[1]*f.a[1], p[0]*f.n[0]+p[1]*f.n[1]];
  });
  const s = local.map(p => p[0]), t = local.map(p => p[1]);
  const deltaSM = Math.abs((Math.min(...s)+Math.max(...s))/2);
  const widthM = Math.max(...s)-Math.min(...s);
  const heightM = (d.max[1]-d.min[1])/metres(1);
  const planeM = Math.min(...t);
  return { id: entry.id, deltaSM, widthM, heightM, planeM,
    pass: deltaSM <= 0.3 && Math.abs(widthM-entry.widthM) <= 0.05 &&
      Math.abs(heightM-(entry.bankHeightM ?? entry.doors.heightM ?? 2.2)) <= 0.05 &&
      Math.abs(planeM) <= 0.1 };
});
const emitted = nodes.filter(n => /^ENT_D4_.*\/doors$/.test(n.getName())).map(n => n.getName());
const form = read("building-forms.json").buildings.find(f => f.key === "BLD_D4");
const bridge = form.masses[10];
const plaza = read("ground/parcels.json").parcels.find(p => p.id === "PARCEL_PAVING_PAVING_VR_PLAZA_PAVING_PLAZA_PAVING_VR_SCENE_D4_");
const ringArea = ring => {
  const [x, y] = ring[0];
  return Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i+1)%ring.length];
    return sum+(p[0]-x)*(q[1]-y)-(q[0]-x)*(p[1]-y);
  }, 0))/2;
};
const outlines = Object.values(read("ground/junctions.json")).flatMap(j => j.approaches)
  .flatMap(a => a.guideLines ?? []).filter(g => ["RZ-015-outer", "RZ-015-inner"].includes(g.id));
// Same upward-plan coverage contract as check-ground-overlap.mjs, restricted
// to the authorised TM bbox. Ignore zero-area wall projections.
const area = [243422.55, 263767.58, 243591.87, 263991.06];
const bins = new Map(), cell = 1;
for (const node of nodes.filter(n => /^(Topography_\d+|Topography_joined|Ground_(?!Hump_)|Road_Markings_|OuterTerrain$|Context_Far_Ground_)/.test(n.getName()))) {
  if (!node.getMesh()) continue;
  const m = node.getWorldMatrix();
  for (const primitive of node.getMesh().listPrimitives()) {
    const positions = primitive.getAttribute("POSITION"), index = primitive.getIndices();
    const points = Array.from({ length: positions.getCount() }, (_, k) => {
      const [x, y, z] = positions.getElement(k, []);
      return sceneToTm(m[0]*x+m[4]*y+m[8]*z+m[12], m[2]*x+m[6]*y+m[10]*z+m[14]);
    });
    for (let k = 0; k < (index?.getCount() ?? points.length); k += 3) {
      const t = [0, 1, 2].map(i => points[index ? index.getScalar(k+i) : k+i]);
      t.owner = `${node.getName()}/${primitive.getMaterial()?.getName()}`;
      if (ringArea(t) < 1e-10) continue;
      const lo = [0, 1].map(i => Math.max(area[i], Math.min(...t.map(p => p[i]))));
      const hi = [0, 1].map(i => Math.min(area[i+2], Math.max(...t.map(p => p[i]))));
      for (let x = Math.floor(lo[0]/cell); x <= Math.floor(hi[0]/cell); x++) {
        for (let y = Math.floor(lo[1]/cell); y <= Math.floor(hi[1]/cell); y++) {
          const key = `${x},${y}`;
          if (!bins.has(key)) bins.set(key, []);
          bins.get(key).push(t);
        }
      }
    }
  }
}
let samples = 0, overlaps = 0, gaps = 0;
const overlapPairs = {}, overlapExamples = [];
for (let x = area[0]+0.137; x < area[2]; x += 0.4) {
  for (let y = area[1]+0.193; y < area[3]; y += 0.4) {
    const hits = (bins.get(`${Math.floor(x/cell)},${Math.floor(y/cell)}`) ?? []).filter(t => {
      const signs = t.map((a, i) => {
        const b = t[(i+1)%3];
        return (b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
      });
      return !(signs.some(v => v < 0) && signs.some(v => v > 0));
    });
    samples++;
    if (hits.length > 1) {
      overlaps++;
      const pair = hits.map(t => t.owner).sort().join("+");
      overlapPairs[pair] = (overlapPairs[pair] ?? 0) + 1;
      if (overlapExamples.length < 10) overlapExamples.push({ tm: [x, y], pair });
    }
    if (hits.length === 0) gaps++;
  }
}
const report = {
  model, anchor: { centre, expected: FRAME_V2_D4_CENTRE, delta: anchorDelta, pass: anchorDelta <= 0.05 },
  doors, doorCount: { expected: entries.length, actual: emitted.length, pass: entries.length === 4 && emitted.length === 4,
    source: "SYNTHESIS section 3: E5 probably duplicates E1; lane 2 excludes E5 (estimated)" },
  // This is explicitly a source check; it does not pretend to measure the mesh soffit.
  bridgeSeed: { baseMetres: bridge.baseMetres, targetMetres: 9, toleranceMetres: 1.5,
    pass: Math.abs(bridge.baseMetres-9) <= 1.5, source: "SYNTHESIS 2.2 / ISSUES D-37 (estimated)" },
  plazaSeed: { areaM2: ringArea(plaza.ring), targetAreaM2: 888.8,
    pass: Math.abs(ringArea(plaza.ring)-888.8) < 1, source: "l3-ground north extension (estimated)" },
  triangleSeeds: { count: outlines.length, pass: outlines.length === 2 &&
    outlines.every(g => g.points?.length === 4 && g.points[0].every((v, k) => v === g.points[3][k])) },
  groundOverlap: { bboxTM: area, samples, overlaps, gaps, overlapPairs, overlapExamples, pass: overlaps === 0 && gaps === 0 },
};
report.pass = report.anchor.pass && report.doorCount.pass && doors.every(d => d.pass) &&
  report.bridgeSeed.pass && report.plazaSeed.pass && report.triangleSeeds.pass && report.groundOverlap.pass;
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;

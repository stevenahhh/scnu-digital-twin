import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { resolveAnchor } from "../lib/anchors.mjs";
import { metres } from "../lib/frame.mjs";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";

test("the generated GLB exposes the E5 SD-E5-C1 door cell within 0.3 m of its unchanged canopy anchor", () => {
  const run = spawnSync("bun", [fileURLToPath(new URL("./facadeMesh.mjs", import.meta.url))],
    { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(run.error);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.id, "SD-E5-C1");
  assert.equal(report.canopySM, 44.5070997209, "task 19's accepted estimated anchor must not move");
  assert.ok(report.deltaSM <= 0.3, JSON.stringify(report));
});

test("the generated GLB places all four D4 banks at their recorded offsets and yaw, without a west door", async () => {
  const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
  const entries = read("buildings/entrances.json").records.filter(e => e.anchor.building === "BLD_D4");
  const nodeMap = read("bld-node-map.json").entries.find(e => e.nodeId === "BLD_D4");
  const footprints = { BLD_D4: { polygons: [[nodeMap.walls.map(w => w.A)]], walls: nodeMap.walls } };
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(process.env.CAMPUS_MODEL_FILE ??
    fileURLToPath(new URL("../../../public/campus-v2.glb", import.meta.url)));
  const nodes = doc.getRoot().listNodes().filter(n => /^ENT_D4_.*\/doors$/.test(n.getName()));
  assert.deepEqual(nodes.map(n => n.getName()).sort(), [
    "ENT_D4_E1/doors", "ENT_D4_E2/doors", "ENT_D4_E3/doors", "ENT_D4_E4/doors",
  ]);
  for (const entry of entries) {
    const node = nodes.find(n => n.getName() === `${entry.id}/doors`);
    const anchor = resolveAnchor(entry, footprints), m = node.getWorldMatrix();
    const points = node.getMesh().listPrimitives().flatMap(p => {
      const positions = p.getAttribute("POSITION");
      return Array.from({ length: positions.getCount() }, (_, i) => {
        const [x, y, z] = positions.getElement(i, []);
        const tm = sceneToTm(m[0]*x+m[4]*y+m[8]*z+m[12], m[2]*x+m[6]*y+m[10]*z+m[14]);
        const [dx, dy] = tm.map((v, k) => v-anchor.origin[k]);
        return [dx*anchor.a[0]+dy*anchor.a[1], dx*anchor.n[0]+dy*anchor.n[1],
          m[1]*x+m[5]*y+m[9]*z+m[13]];
      });
    });
    const min = [0,1,2].map(k => Math.min(...points.map(p => p[k])));
    const max = [0,1,2].map(k => Math.max(...points.map(p => p[k])));
    assert.ok(Math.abs((min[0]+max[0])/2) <= 0.3, `${entry.id}: centre`);
    assert.ok(Math.abs(max[0]-min[0]-entry.widthM) <= 0.05, `${entry.id}: width/yaw`);
    assert.ok(Math.abs(min[1]) <= 0.1 && max[1] <= 0.2, `${entry.id}: recessed door plane`);
    assert.ok(Math.abs((max[2]-min[2])/metres(1)-(entry.bankHeightM ?? entry.doors.heightM ?? 2.2)) <= 0.05,
      `${entry.id}: bank height`);
  }
});

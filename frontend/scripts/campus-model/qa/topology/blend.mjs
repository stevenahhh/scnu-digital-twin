// Editable Blender copy of the campus model: bun run model:blend [in.glb]
// Writes scripts/campus-model/.build/campus-v2.blend (+ campus-v2.topology.json) from public/campus-v2.glb by default
// and fails when the topology misses qa/topology/limits.json. Blender: $BLENDER or /Applications/Blender.app.
// glTF stores a vertex once per normal/UV seam, so the GLB itself opens as split faces; this file is the one to edit.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeTopology, topologyFailures } from "./report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "../../../..");
const OUT = path.resolve(HERE, "../../.build");
const BLENDER = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const input = path.resolve(process.argv[2] ?? path.join(FRONTEND, "public/campus-v2.glb"));
const [geometry, blend, report] = ["campus-v2.geometry.glb", "campus-v2.blend", "campus-v2.topology.json"].map((f) => path.join(OUT, f));

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.error}):\n${(result.stdout ?? "").slice(-1500)}\n${(result.stderr ?? "").slice(-1500)}`);
};
mkdirSync(OUT, { recursive: true });
run(process.execPath, [path.join(HERE, "strip.mjs"), input, geometry]);
run(BLENDER, ["-b", "--factory-startup", "--python", path.join(HERE, "blender_topology.py"), "--", geometry, report, "--merge", "--editable", blend]);

const limits = JSON.parse(readFileSync(path.join(HERE, "limits.json"), "utf8"));
const summary = summarizeTopology(JSON.parse(readFileSync(report, "utf8")).meshes, { meshes: Object.keys(limits.meshes) });
writeFileSync(report, `${JSON.stringify({ input, blend, summary }, null, 1)}\n`);
const failures = topologyFailures(summary, limits);
console.log(`BLEND ${blend}`);
for (const [root, v] of Object.entries(summary.roots)) console.log(`TOPOLOGY ${root} faces ${v.faces} (quads ${v.quads}, tris ${v.tris}, ngons ${v.ngons}) islands ${v.islands} triFaceShare ${v.triFaceShare} islands/1000 tris ${v.islandsPerThousandTriangles}`);
for (const failure of failures) console.error(`TOPOLOGY FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);

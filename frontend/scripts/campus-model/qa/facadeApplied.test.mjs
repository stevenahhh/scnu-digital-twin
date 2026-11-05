import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { unappliedFacadeWalls } from "./facadeCoverage.mjs";

test("requested grids cannot pass when a built node or a requested wall is absent", () => {
  const rows = [
    { building: "BLD_A", requestedWalls: ["W00", "W01"] },
    { building: "BLD_B", requestedWalls: ["W03"] },
    { building: "BLD_C", requestedWalls: [] },
  ];
  const nodes = [{ name: "BLD_A", extras: { facadeGridAppliedWalls: ["W00"] } }];
  assert.deepEqual(unappliedFacadeWalls(rows, nodes), ["BLD_A/W01", "BLD_B/W03"]);
});

test("a node with every requested wall applied passes, while fallback-only nodes need no grid", () => {
  assert.deepEqual(unappliedFacadeWalls([
    { building: "BLD_A", requestedWalls: ["W00"] }, { building: "BLD_B", requestedWalls: [] },
  ], [{ name: "BLD_A", extras: { facadeGridAppliedWalls: ["W00"] } }]), []);
});

test("one applied part of a wall does not hide a missing reviewed source edge", () => {
  const rows = [{ building: "BLD_A", requestedWalls: ["W00"], requestedSurfaceEdges: ["W00#0", "W00#1"] }];
  const nodes = [{ name: "BLD_A", extras: { facadeGridAppliedWalls: ["W00"], facadeGridAppliedSurfaceEdges: ["W00#0"] } }];
  assert.deepEqual(unappliedFacadeWalls(rows, nodes), ["BLD_A/W00#1"]);
});

test("every curated wall is actually applied in the generated GLB", () => {
  const run = spawnSync("bun", [fileURLToPath(new URL("./facadeCoverage.mjs", import.meta.url)), "--built"],
    { encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(run.error);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.unappliedWalls, []);
  // SYNTHESIS section 3 and l2-facade.md: only E3 lies on an exterior atlas plane.
  assert.deepEqual(report.entrances.filter(e => e.building === "BLD_D4")
    .map(e => [e.id, e.status]).sort(), [
    ["ENT_D4_E1", "ungridded"], ["ENT_D4_E2", "ungridded"],
    ["ENT_D4_E3", "aligned"], ["ENT_D4_E4", "ungridded"],
  ]);
});

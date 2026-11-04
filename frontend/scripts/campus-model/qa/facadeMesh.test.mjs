import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the generated GLB exposes the E3 door cell within 0.3 m of its unchanged canopy anchor", () => {
  const run = spawnSync("bun", [fileURLToPath(new URL("./facadeMesh.mjs", import.meta.url))],
    { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(run.error);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.id, "SD-E5-C1");
  assert.equal(report.canopySM, 44.5070997209, "task 19's accepted estimated anchor must not move");
  assert.ok(report.deltaSM <= 0.3, JSON.stringify(report));
});

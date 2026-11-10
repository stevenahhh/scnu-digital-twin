import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";

test("the point report describes the packed pole after checkPoles, not the loader seed", () => {
  const dir = mkdtempSync(join(tmpdir(), "free-standing-report-"));
  try {
    const prefix = join(dir, "audit");
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("./freeStanding.mjs", import.meta.url)), "--out", prefix], { encoding: "utf8" });
    assert.ok([0, 2].includes(run.status), run.stderr);
    const report = JSON.parse(readFileSync(`${prefix}-objects.json`, "utf8"));
    const bytes = readFileSync(new URL("../../../public/campus-v2.glb", import.meta.url));
    const glb = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    const furniture = glb.nodes.find(n => n.name === "Furniture" && n.extras?.poles).extras;
    const row = report.rows.find(r => r.id === "OC0098");
    const pole = furniture.poles.find(p => p[0] === row.id);
    assert.deepEqual(row.point, sceneToTm(pole[5], pole[6]));
    for (const p of furniture.poles) {
      const r = report.rows.find(q => q.id === p[0]);
      if (r) assert.deepEqual(r.point, sceneToTm(p[5], p[6]), p[0]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

for (const defect of ["stale", "missing"]) test(`model:build rejects a ${defect} saved wall snapshot for the todo-20 F1 LED`, { timeout: 180000 }, () => {
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), "wall-snapshot-"));
  const preload = path.join(directory, `${defect}.mjs`);
  try {
    // Change only the parsed snapshot, not the source bytes or their hash.
    // The real loader, resolver, and model:build command remain in the path.
    writeFileSync(preload, `
const parse = JSON.parse;
JSON.parse = function (...args) {
  const doc = parse(...args);
  const wall = doc?.additionalWalls?.BLD_SCNU_F1?.find(w => w.wall === "W25");
  if (wall) {
    ${defect === "stale" ? "wall.lengthM += 2;" : "delete doc.additionalWalls.BLD_SCNU_F1;"}
    console.error("INJECTED_${defect.toUpperCase()}_F1_W25");
  }
  return doc;
};
`);
    const run = spawnSync("bun", ["run", "model:build"], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, BUN_OPTIONS: `--preload=${preload.replaceAll("\\", "/")}` },
      encoding: "utf8", timeout: 170000, maxBuffer: 32 * 1024 * 1024,
    });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    assert.ifError(run.error);
    assert.ok(output.includes(`INJECTED_${defect.toUpperCase()}_F1_W25`), output);
    assert.equal(run.status, 1, output);
    assert.match(run.stderr, defect === "stale"
      ? /AnchorError: SD-F1-LED1: BLD_SCNU_F1\/W25:.*stale wall/
      : /AnchorError: SD-F1-LED1: BLD_SCNU_F1.*saved wall mapping required/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

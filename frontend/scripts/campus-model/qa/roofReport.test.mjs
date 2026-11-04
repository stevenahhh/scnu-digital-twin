import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("every shipped main and wing is inside its actual footprint's 0.3 m buffer", { timeout: 120_000 }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), "roof-containment-"));
  try {
    const output = path.join(directory, "report.json");
    const run = spawnSync("bun", [fileURLToPath(new URL("./roofReport.mjs", import.meta.url)), output],
      { encoding: "utf8", timeout: 110_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(run.status, 0, `${run.error?.message ?? ""}\n${run.stdout}\n${run.stderr}`);
    const report = JSON.parse(readFileSync(output, "utf8"));
    const forms = JSON.parse(readFileSync(new URL("../data/building-forms.json", import.meta.url), "utf8"));
    assert.ok(forms.buildings.length > 0, "containment requires emitted building records");
    for (const b of forms.buildings) assert.ok(b.masses.length > 0, `${b.key}: empty mass payload`);
    assert.deepEqual(report.buildings.map(b => b.id).sort(), forms.buildings.map(b => b.key).sort());
    assert.deepEqual(report.totals.mainWingOutsideBuffer, [],
      "all emitted main/wing forms, including curated and photo-traced forms, must satisfy containment");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

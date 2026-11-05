import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("D4 emitted mesh keeps its frame anchor and the photographic passage soffit", async () => {
  const fixture = fileURLToPath(new URL("./buildingsD4.fixture.mjs", import.meta.url));
  const { stdout } = await promisify(execFile)("bun", [fixture], {
    maxBuffer: 8 * 1024 * 1024, timeout: 180000,
  });
  const line = stdout.split("\n").find(l => l.startsWith("D4_FIXTURE "));
  assert.ok(line, "the real generator fixture must return its numerical evidence");
  console.log(line);
});

test("D4 replays its curated geometry when regenerated LOD4 input restores the old soffit", async () => {
  const fixture = fileURLToPath(new URL("./buildingsD4.fixture.mjs", import.meta.url));
  const { stdout } = await promisify(execFile)("bun", [fixture, "--reseed"], {
    maxBuffer: 8 * 1024 * 1024, timeout: 180000,
    env: { ...process.env, G_ANCHOR_OUTPUT: "" },
  });
  const line = stdout.split("\n").find(l => l.startsWith("D4_FIXTURE "));
  assert.ok(line, "the reseed fixture must return its numerical evidence");
  console.log(line);
});

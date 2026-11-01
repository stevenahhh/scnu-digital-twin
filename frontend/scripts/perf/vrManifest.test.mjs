import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "vr-manifest.mjs");

// Smallest valid-looking PNG head: signature, IHDR length/type, 4 x 3 px.
const png = () => {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "latin1");
  head.writeUInt32BE(4, 16);
  head.writeUInt32BE(3, 20);
  return head;
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vr-manifest-"));
  const stations = [{ scene: "scene_t1", title: "one" }, { scene: "scene_t2", title: "two" }];
  writeFileSync(join(root, "stations.json"), JSON.stringify(stations));
  for (const { scene } of stations) {
    writeFileSync(join(root, `before-${scene}-strip.png`), png());
    writeFileSync(join(root, `after-${scene}-strip.png`), png());
    for (const face of ["f", "r", "b", "l"]) writeFileSync(join(root, `after-${scene}-${face}-side.png`), png());
  }
  return root;
}

const run = (root) => spawnSync("bun", [SCRIPT, "--before", root, "--after", root, "--out", join(root, "out"), "--stations", join(root, "stations.json")], { encoding: "utf8" });

test("a complete before/after set exits 0 with every scene ok", () => {
  const root = fixture();
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const manifest = JSON.parse(readFileSync(join(root, "out", "MANIFEST.json"), "utf8"));
    assert.equal(manifest.scenes.filter((s) => s.ok).length, 2);
    assert.equal(manifest.missing.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one missing after strip exits 1 and names the scene", () => {
  const root = fixture();
  try {
    unlinkSync(join(root, "after-scene_t2-strip.png"));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /MISSING scene_t2 after-scene_t2-strip\.png/);
    assert.doesNotMatch(result.stdout, /MISSING scene_t1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

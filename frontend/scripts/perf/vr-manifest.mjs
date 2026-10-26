// VR comparison manifest (local QA only; nothing here ships).
//
// Checks that every exterior station of scripts/perf/vr-stations.json has a complete before/after pair from
// compare-vr.mjs: before-<scene>-strip.png in --before, after-<scene>-strip.png and the four
// after-<scene>-<face>-side.png (f, r, b, l) in --after, each a non-empty PNG (8-byte signature and an IHDR
// chunk with a non-zero size). Writes MANIFEST.json ({ scenes: [{ scene, title, before, after, sides, ok }],
// missing: [...] }) and MANIFEST.md (one table row per scene) into --out and exits 1, printing
// `MISSING <scene> <file>` per gap, when any scene lacks anything.
//
// Usage: bun scripts/perf/vr-manifest.mjs --before <dir> --after <dir> --out <dir> [--stations <file>]
import { existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SIDES = ["f", "r", "b", "l"];
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// { ok, reason, width, height } for one file: present, non-empty, PNG signature, IHDR first with width and height > 0.
export function checkPng(file) {
  if (!existsSync(file)) return { ok: false, reason: "missing" };
  if (statSync(file).size === 0) return { ok: false, reason: "empty" };
  const head = Buffer.alloc(24);
  const fd = openSync(file, "r");
  const read = readSync(fd, head, 0, 24, 0);
  closeSync(fd);
  if (read < 24 || !head.subarray(0, 8).equals(SIGNATURE)) return { ok: false, reason: "not a PNG" };
  if (head.toString("latin1", 12, 16) !== "IHDR") return { ok: false, reason: "no IHDR" };
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  if (!width || !height) return { ok: false, reason: "zero IHDR size" };
  return { ok: true, width, height };
}

export function buildManifest({ stations, before, after }) {
  const missing = [];
  const scenes = stations.map(({ scene, title }) => {
    const files = {
      before: join(before, `before-${scene}-strip.png`),
      after: join(after, `after-${scene}-strip.png`),
      sides: SIDES.map((face) => join(after, `after-${scene}-${face}-side.png`)),
    };
    let ok = true;
    for (const file of [files.before, files.after, ...files.sides]) {
      const check = checkPng(file);
      if (!check.ok) {
        ok = false;
        missing.push({ scene, file, reason: check.reason });
      }
    }
    return { scene, title: title ?? null, ...files, ok };
  });
  return { stations: stations.length, complete: scenes.filter((s) => s.ok).length, scenes, missing };
}

function markdown(manifest) {
  const name = (file) => file.split("/").at(-1);
  const rows = manifest.scenes.map((s) => `| ${s.scene} | ${s.title ?? ""} | ${name(s.before)} | ${name(s.after)} | ${s.sides.map(name).join(", ")} | ${s.ok ? "ok" : "MISSING"} |`);
  const gaps = manifest.missing.map((m) => `- ${m.scene}: ${m.file} (${m.reason})`);
  return [
    "# VR comparison manifest",
    "",
    `${manifest.complete}/${manifest.stations} exterior scenes have a before strip, an after strip and four after side images.`,
    "Images stay under .omo (VR faces are reference only and are never committed or shipped).",
    "",
    "| scene | title | before | after | after sides | ok |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Missing",
    "",
    ...(gaps.length ? gaps : ["none"]),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const before = option("before");
  const after = option("after");
  const out = option("out");
  if (!before || !after || !out) {
    console.error("usage: bun scripts/perf/vr-manifest.mjs --before <dir> --after <dir> --out <dir> [--stations <file>]");
    process.exit(2);
  }
  const stations = JSON.parse(readFileSync(resolve(option("stations", join(HERE, "vr-stations.json"))), "utf8"));
  const manifest = buildManifest({ stations, before: resolve(before), after: resolve(after) });
  mkdirSync(resolve(out), { recursive: true });
  writeFileSync(join(resolve(out), "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(resolve(out), "MANIFEST.md"), markdown(manifest));
  for (const m of manifest.missing) console.log(`MISSING ${m.scene} ${m.file.split("/").at(-1)}`);
  console.log(`MANIFEST ${manifest.complete}/${manifest.stations} complete, ${manifest.missing.length} missing files -> ${join(resolve(out), "MANIFEST.json")}`);
  process.exit(manifest.missing.length ? 1 : 0);
}

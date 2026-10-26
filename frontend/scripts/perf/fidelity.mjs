// Q of docs/OPTIMIZATION-FORMULA.md from an overhead-blend.mjs run (local QA only, nothing here ships).
// Reads <dir>/<prefix>overhead-blend.json and its <prefix>tile-<E0>-<N0>-side.png pairs (render | photo), picks the 12
// tiles whose photo has the most edges (fidelityCore.pickTiles: the photo alone decides, so every candidate is scored on
// the same tiles) and reports the mean SSIM of render against photo. With --ref <dir> [--ref-prefix p] it also reports
// the mean SSIM of this render against the reference run's render on the same tiles (Qself: 1 means pixel-identical).
//
//   bun scripts/perf/fidelity.mjs --dir <blendDir> [--prefix before-] [--ref <blendDir>] [--ref-prefix p]
//       [--tiles 12] [--json <path>]
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodePng } from "../campus-model/lib/png.mjs";
import { edgeShare, luminance, sobel } from "./overheadBlendCore.mjs";
import { pickTiles, splitSide, ssim } from "./fidelityCore.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const dir = resolve(option("dir", "."));
const prefix = option("prefix", "");
const refDir = option("ref", null);
const refPrefix = option("ref-prefix", "");
const count = Number(option("tiles", "12"));
const jsonPath = resolve(option("json", join(dir, `${prefix}fidelity.json`)));

function readSide(base, pre, name) {
  const png = decodePng(readFileSync(join(base, `${pre}${name}-side.png`)));
  const { left, right, width } = splitSide(png.pixels, png.width, png.height, png.channels);
  return {
    width, height: png.height,
    render: luminance(left, width, png.height, png.channels),
    photo: luminance(right, width, png.height, png.channels),
  };
}

const report = JSON.parse(readFileSync(join(dir, `${prefix}overhead-blend.json`), "utf8"));
const all = report.tiles.map((t) => {
  const name = `tile-${t.E0}-${t.N0}`;
  const side = readSide(dir, prefix, name);
  return { name, side, photoEdgeShare: edgeShare(sobel(side.photo, side.width, side.height)) };
});
const tiles = pickTiles(all, count).map(({ name, side, photoEdgeShare }) => {
  const q = ssim(side.render, side.photo, side.width, side.height);
  let qSelf = null;
  if (refDir) {
    const ref = readSide(resolve(refDir), refPrefix, name);
    qSelf = ssim(side.render, ref.render, side.width, side.height);
  }
  return { name, photoEdgeShare: +photoEdgeShare.toFixed(4), ssim: +q.toFixed(4), ssimVsRef: qSelf == null ? null : +qSelf.toFixed(4) };
});
const mean = (key) => tiles.reduce((s, t) => s + t[key], 0) / tiles.length;
const out = {
  generatedAt: new Date().toISOString(),
  source: dir, prefix, tileSelection: `${count} of ${all.length} tiles with the largest photo edge share`,
  metric: "mean SSIM of Rec.601 luma, 8 x 8 windows every 4 px, render vs NGII photo",
  Q: +mean("ssim").toFixed(4),
  Qself: refDir ? +mean("ssimVsRef").toFixed(4) : null,
  reference: refDir ? resolve(refDir) : null,
  tiles,
};
writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`FIDELITY Q=${out.Q}${refDir ? ` Qself=${out.Qself}` : ""} over ${tiles.length} tiles; json ${jsonPath}`);

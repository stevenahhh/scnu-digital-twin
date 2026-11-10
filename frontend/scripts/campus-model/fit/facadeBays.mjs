// Unrolled LOD4 wall patterns only; positions always come from GIS wall frames.
export class FacadeFitError extends Error {
  constructor(detail) { super(`facade fit: ${detail}`); this.name = "FacadeFitError"; }
}

export function estimateFacadeBays({ pixels, width, height, metresPerPixel = 0.25, storeys, minPitchM = 2, maxPitchM = 6 }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 3) throw new FacadeFitError("invalid pixels");
  if (!(metresPerPixel > 0) || !Number.isInteger(storeys) || storeys < 1 || !(maxPitchM > minPitchM && minPitchM > 0)) throw new FacadeFitError("invalid scale, storeys or pitch interval");
  const columns = Array(width).fill(0), rows = Array(height).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    const luma = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    columns[x] += luma / height; rows[y] += luma / width;
  }
  const mean = columns.reduce((s, v) => s + v, 0) / width;
  const centred = columns.map(v => v - mean);
  if (Math.max(...columns) - Math.min(...columns) < 5) throw new FacadeFitError("no column contrast");
  const scores = [];
  for (let lag = Math.ceil(minPitchM / metresPerPixel); lag <= Math.min(Math.floor(maxPitchM / metresPerPixel), Math.floor(width / 2)); lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let x = 0; x + lag < width; x++) { xy += centred[x] * centred[x + lag]; xx += centred[x] ** 2; yy += centred[x + lag] ** 2; }
    scores.push({ lag, correlation: xy / Math.sqrt(xx * yy) });
  }
  const best = scores.filter((s, i) => s.correlation > 0.35 && (i === 0 || s.correlation >= scores[i - 1].correlation) &&
    (i === scores.length - 1 || s.correlation >= scores[i + 1].correlation))
    .sort((a, b) => b.correlation - a.correlation || a.lag - b.lag)[0];
  if (!best) throw new FacadeFitError("no repeatable column rhythm");
  // Fold the entire profile by its structural period. A bright reflected pane can split one
  // window into several dark runs; counting those runs would count panes instead of bays.
  const phase = Array(best.lag).fill(0), samples = Array(best.lag).fill(0);
  columns.forEach((v, x) => { phase[x % best.lag] += v; samples[x % best.lag]++; });
  phase.forEach((v, i) => { phase[i] = v / samples[i]; });
  const bright = Math.max(...phase);
  let cx = 0, cy = 0;
  phase.forEach((v, x) => {
    const angle = (x + 0.5) * 2 * Math.PI / best.lag;
    cx += (bright - v) * Math.cos(angle); cy += (bright - v) * Math.sin(angle);
  });
  if (Math.hypot(cx, cy) < 1e-6) throw new FacadeFitError("ambiguous opening phase");
  const centre = ((Math.atan2(cy, cx) / (2 * Math.PI) + 1) % 1) * best.lag;
  const first = centre < best.lag / 2 - 1e-8 ? centre + best.lag : centre;
  const count = Math.floor((width - best.lag / 2 - first) / best.lag + 1e-8) + 1;
  const offsetPx = first - best.lag / 2;
  if (count < 2) throw new FacadeFitError("too few complete bays");
  const phaseMean = phase.reduce((s, v) => s + v, 0) / phase.length;
  for (let bay = 0; bay < count; bay++) {
    const start = Math.round(offsetPx + bay * best.lag);
    const strip = columns.slice(start, start + best.lag);
    if (strip.length !== best.lag || Math.max(...strip) - Math.min(...strip) < 5) throw new FacadeFitError("missing bay contrast");
    const average = strip.reduce((s, v) => s + v, 0) / strip.length;
    let xy = 0, xx = 0, yy = 0;
    strip.forEach((v, x) => {
      const a = v - average, b = phase[(start + x) % best.lag] - phaseMean;
      xy += a * b; xx += a * a; yy += b * b;
    });
    if (xy / Math.sqrt(xx * yy) < 0.35) throw new FacadeFitError("ambiguous opening rhythm");
  }
  return {
    bays: { pitchM: best.lag * metresPerPixel, count, offsetM: Number((offsetPx * metresPerPixel).toFixed(9)) },
    storeys: Array.from({ length: storeys }, (_, i) => ({ hM: height * metresPerPixel / storeys, ...(i === 0 ? { kind: "ground" } : {}) })),
    columnProfile: columns, rowProfile: rows, correlation: best.correlation, estimated: true,
  };
}

// A proposal is never installed automatically. Keep the image, proposal and overlay local for review.
// bun fit/facadeBays.mjs --image wall.png --building BLD_E5 --wall W25 --storeys 4 --out /private/tmp/proposal
// Optional --crop x,y,width,height selects one wall in the perimeter debug image.
if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { decodePng, encodePng } = await import("../lib/png.mjs");
  const args = process.argv.slice(2);
  const option = key => { const i = args.indexOf(`--${key}`); return i < 0 ? null : args[i + 1]; };
  const image = option("image"), building = option("building"), wall = option("wall"), out = option("out");
  if (!image || !building || !wall || !out) throw new FacadeFitError("requires --image, --building, --wall and --out");
  const source = decodePng(readFileSync(image));
  const crop = option("crop")?.split(",").map(Number) ?? [0, 0, source.width, source.height];
  const [left, top, width, height] = crop;
  if (crop.length !== 4 || crop.some(n => !Number.isInteger(n)) || left < 0 || top < 0 || width < 1 || height < 1 ||
      left + width > source.width || top + height > source.height) throw new FacadeFitError("crop outside image");
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = ((top + y) * source.width + left + x) * source.channels;
    pixels.set(source.pixels.subarray(at, at + 3), (y * width + x) * 3);
  }
  const metresPerPixel = Number(option("metres-per-pixel") ?? 0.25);
  const fit = estimateFacadeBays({ pixels, width, height, metresPerPixel, storeys: Number(option("storeys")) });
  const vrCount = option("vr-count") === null ? null : Number(option("vr-count"));
  const proposal = { building, wall, image, crop, metresPerPixel, ...fit,
    vrCount, countMatchesVr: vrCount === null ? null : vrCount === fit.bays.count,
    status: "proposal", evidence: { tier: "T2", refs: [`LOD4 unrolled ${wall}; ${metresPerPixel} m/px; crop ${crop.join(",")}`] } };
  writeFileSync(`${out}.json`, `${JSON.stringify(proposal, null, 2)}\n`);
  for (let i = 0; i <= fit.bays.count; i++) {
    const x = Math.round((fit.bays.offsetM + i * fit.bays.pitchM) / metresPerPixel);
    if (x < width) for (let y = 0; y < height; y++) pixels.set([255, 90, 0], (y * width + x) * 3);
  }
  let h = 0;
  for (const storey of fit.storeys) {
    h += storey.hM;
    const y = height - Math.round(h / metresPerPixel);
    if (y >= 0 && y < height) for (let x = 0; x < width; x++) pixels.set([0, 240, 255], (y * width + x) * 3);
  }
  writeFileSync(`${out}.png`, encodePng(width, height, 3, pixels));
  console.log(JSON.stringify({ building, wall, bays: fit.bays, countMatchesVr: proposal.countMatchesVr, estimated: true }));
  if (vrCount !== null && !proposal.countMatchesVr) process.exitCode = 1;
}

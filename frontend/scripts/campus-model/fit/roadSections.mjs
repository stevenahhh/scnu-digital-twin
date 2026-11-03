#!/usr/bin/env bun
// Proposal-only estimator, design section 8.3. Samples signed transverse
// profiles along each directed road path, excluding roof/crown/shadow pixels.
// It never writes curated road-sections.json or junctions.json.
const round = (n) => Number(n.toFixed(3));
const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[a.length >> 1] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

export function proposeRoad(road, window, blobs = []) {
  const profiles = [];
  let length = 0;
  for (let i = 1; i < road.line.length; i += 1) {
    const p = road.line[i - 1], q = road.line[i];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!d) continue;
    const normal = [-(q[1] - p[1]) / d, (q[0] - p[0]) / d];
    for (let s = 0.25; s < d; s += 0.5) {
      const centre = [p[0] + (q[0] - p[0]) * s / d, p[1] + (q[1] - p[1]) * s / d];
      const runs = [];
      let run = [], visible = 0, count = 0;
      // Only the central half of the carriageway: yellow kerb paint is not
      // evidence of a centre line.
      for (let t = -road.widthM / 4; t <= road.widthM / 4; t += window.gsdM) {
        const x = Math.floor((centre[0] + normal[0] * t - window.origin[0]) / window.gsdM);
        const y = Math.floor((window.origin[1] - centre[1] - normal[1] * t) / window.gsdM);
        const index = y * window.w + x;
        count += 1;
        const readable = x >= 0 && x < window.w && y >= 0 && y < window.h && !window.mask?.[index];
        if (readable) visible += 1;
        const [r, g, b] = readable ? window.rgb.subarray(index * 3, index * 3 + 3) : [0, 0, 0];
        const yellow = readable && r > 110 && g > 100 && Math.min(r, g) - b > 45 && r / g < 1.65;
        if (yellow) run.push(t);
        else if (run.length) { runs.push(run); run = []; }
      }
      if (run.length) runs.push(run);
      const peaks = runs.filter((r) => r.length * window.gsdM >= 0.05 && r.length * window.gsdM <= 0.4).map(median);
      profiles.push({ atM: length + s, visible: visible / count >= 0.8, peaks });
    }
    length += d;
  }
  const visible = profiles.filter((p) => p.visible);
  // Dominant 0.1 m lateral bin rejects scattered yellow objects. The selected
  // profile is one metre wide, permitting the two peaks of a double line.
  const bins = new Map();
  for (const p of visible) for (const t of p.peaks) {
    const bin = Math.round(t * 10);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const best = [...bins].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0]?.[0];
  const near = visible.map((p) => ({ ...p, peaks: p.peaks.filter((t) => Math.abs(t - best / 10) <= 0.5) }));
  const supported = near.filter((p) => p.peaks.length);
  const support = visible.length ? supported.length / visible.length : null;
  const present = support !== null && support >= 0.6;
  const doubles = supported.filter((p) => p.peaks.length === 2 && Math.abs(p.peaks[1] - p.peaks[0]) >= 0.15);
  const double = present && doubles.length / supported.length >= 0.6;
  const offset = present ? median((double ? doubles : supported).map((p) => median(p.peaks))) : 0;
  const laneCount = present ? Math.max(2, road.lanes) : road.lanes;
  const markingCandidates = [];
  for (const blob of blobs) {
    if (!["arrow", "text"].includes(blob.kind)) continue;
    const ring = blob.ring;
    const points = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
    const c = points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length], [0, 0]);
    let start = 0, best = null;
    for (let i = 1; i < road.line.length; i += 1) {
      const a = road.line[i - 1], b = road.line[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
      if (!d) continue;
      const s = Math.max(0, Math.min(d, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / d));
      const distance = Math.hypot(c[0] - a[0] - dx * s / d, c[1] - a[1] - dy * s / d);
      if (!best || distance < best.distance) best = { distance, atM: start + s, lateralOffsetM: (dx * (c[1] - a[1]) - dy * (c[0] - a[0])) / d };
      start += d;
    }
    if (best && best.distance <= road.widthM / 2) markingCandidates.push({
      id: blob.id, kind: blob.kind, atM: round(best.atM), lateralOffsetM: round(best.lateralOffsetM), estimated: true,
    });
  }
  return { markingCandidates, sections: [{
    pathIndex: road.pathIndex ?? 0, fromM: 0, toM: round(length),
    lanes: Array.from({ length: laneCount }, (_, i) => ({ dir: i < Math.ceil(laneCount / 2) ? "fwd" : "bwd", widthM: round(road.widthM / laneCount) })),
    centre: { type: !present ? "none" : double ? "yellow_double" : support >= 0.9 ? "yellow_solid" : "yellow_dashed", widthM: 0.15 },
    edges: { left: "none", right: "none" }, lateralOffsetM: round(offset),
    kerbOffsetsM: { left: round(road.widthM / 2), right: round(road.widthM / 2) },
    kerbNoParking: { left: false, right: false }, humps: [],
    evidence: { tier: visible.length ? "T1" : "T4", refs: [`road_segments ${road.id}; NGII visible transverse profiles`], photoSupport: support === null ? null : round(support) },
    estimated: true,
    reason: visible.length ? "Proposal only: widths and kerbs use the estimated road-zone prior; edges, humps and junction marks require review." : "No unoccluded profile; road-zone prior only, no paint inferred.",
    diagnostics: { profiles: profiles.length, visible: visible.length, supported: supported.length, doubleProfiles: doubles.length },
  }] };
}

if (import.meta.main) {
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { roadContext } = await import("../lib/roadSections.mjs");
  const { validate } = await import("../lib/schemas.mjs");
  const { openSheet, sheetWindowForTm } = await import("../lib/ngiiSheet.mjs");
  const { occlusionMask } = await import("../lib/occlusion.mjs");
  const { wgs84ToTm } = await import("../../../src/geo/epsg5186.mjs");
  const { encodePng } = await import("../lib/png.mjs");
  const args = process.argv.slice(2);
  const opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const data = new URL("../data/", import.meta.url);
  const read = (name) => JSON.parse(readFileSync(new URL(name, data), "utf8"));
  const out = resolve(opt("--out", fileURLToPath(new URL("ground/road-sections.proposals.json", data))));
  if (["road-sections.json", "junctions.json"].some((f) => out === fileURLToPath(new URL(`ground/${f}`, data)))) throw new Error("estimator cannot overwrite curated road or junction records");
  const context = roadContext();
  const ids = opt("--segment", "RD_093").split(",");
  for (const id of ids) if (!context.segments.some((s) => s.id === id)) throw new Error(`${id}: segment is not in road_segments`);
  const roads = JSON.parse(readFileSync(new URL("../../../../backend/simulation/data/road_segments.geojson", import.meta.url), "utf8"));
  const leans = new Map(read("photo/building-lean.json").buildings.map((b) => [b.id, b.lean]));
  const buildings = read("building-forms.json").buildings.flatMap((b) => b.masses.map((m) => ({
    rings: [m.outer, ...(m.holes ?? [])].map((r) => r.map(([lon, lat]) => wgs84ToTm(lon, lat))),
    heightM: m.topMetres, lean: leans.get(b.key) ?? b.leanPrior,
  })));
  const trees = read("trees.json").trees.map(([east, north, crownDiameterM, heightM]) => ({ east, north, crownDiameterM, heightM }));
  const blobs = ["photo/evidence/markings.geojson", "photo/evidence/markings-extra.geojson"].flatMap((f) => read(f).features)
    .filter((f) => ["arrow", "text"].includes(f.properties.kind) && f.geometry.type === "Polygon")
    .map((f) => ({ id: f.properties.id, kind: f.properties.kind, ring: f.geometry.coordinates[0].map(([lon, lat]) => wgs84ToTm(lon, lat)) }));
  const sheet = openSheet();
  const proposals = {};
  try {
    for (const id of ids) {
      const p = roads.features.find((f) => f.properties.id === id).properties;
      const sections = [];
      const markingCandidates = [];
      for (let pathIndex = 0; pathIndex < p.epsg5186.length; pathIndex += 1) {
        const line = p.epsg5186[pathIndex];
        const pad = p.width_m;
        const E0 = Math.min(...line.map((q) => q[0])) - pad, N0 = Math.max(...line.map((q) => q[1])) + pad;
        const wM = Math.max(...line.map((q) => q[0])) + pad - E0, hM = N0 - Math.min(...line.map((q) => q[1])) + pad;
        const raw = sheetWindowForTm(sheet, E0, N0, wM, hM);
        const gsdM = Math.abs(sheet.tfw.a);
        const window = { w: raw.w, h: raw.h, origin: [sheet.tfw.c - gsdM / 2 + raw.col0 * gsdM, sheet.tfw.f + gsdM / 2 - raw.row0 * gsdM], gsdM, rgb: raw.rgb };
        const near = ([e, n], margin) => e > E0 - margin && e < E0 + wM + margin && n < N0 + margin && n > N0 - hM - margin;
        window.mask = occlusionMask(window, { buildings: buildings.filter((b) => b.rings[0].some((q) => near(q, 60))), trees: trees.filter((t) => near([t.east, t.north], 30)) }).any;
        const result = proposeRoad({ id, line, pathIndex, widthM: p.width_m, lanes: p.lanes }, window, blobs);
        sections.push(...result.sections);
        markingCandidates.push(...result.markingCandidates.map((r) => ({ ...r, pathIndex })));
        const chips = opt("--chips", null);
        if (chips) {
          mkdirSync(chips, { recursive: true });
          // Raster chip: photo and masked photo with proposed centre on the right.
          const rgb = new Uint8Array(window.w * 2 * window.h * 3);
          for (let y = 0; y < window.h; y += 1) for (let x = 0; x < window.w; x += 1) {
            const k = y * window.w + x, target = (y * window.w * 2 + x) * 3;
            rgb.set(raw.rgb.subarray(k * 3, k * 3 + 3), target);
            rgb.set(window.mask[k] ? [150, raw.rgb[k * 3 + 1] / 2, raw.rgb[k * 3 + 2] / 2] : raw.rgb.subarray(k * 3, k * 3 + 3), target + window.w * 3);
          }
          for (let i = 1; i < line.length; i += 1) {
            const a = line[i - 1], b = line[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const offset = result.sections[0].lateralOffsetM;
            for (let s = 0; s <= d; s += gsdM / 2) {
              const e = a[0] + (b[0] - a[0]) * s / d - (b[1] - a[1]) / d * offset;
              const n = a[1] + (b[1] - a[1]) * s / d + (b[0] - a[0]) / d * offset;
              const x = Math.floor((e - window.origin[0]) / gsdM), y = Math.floor((window.origin[1] - n) / gsdM);
              if (x >= 0 && x < window.w && y >= 0 && y < window.h) rgb.set([0, 255, 255], (y * window.w * 2 + window.w + x) * 3);
            }
          }
          writeFileSync(resolve(chips, `${id}-${pathIndex}.png`), encodePng(window.w * 2, window.h, 3, rgb));
        }
      }
      proposals[id] = { sections, markingCandidates };
      console.log(`${id}: ${JSON.stringify(sections.map((s) => ({ centre: s.centre.type, offsetM: s.lateralOffsetM, support: s.evidence.photoSupport, ...s.diagnostics })))}`);
    }
  } finally { sheet.close(); }
  const checked = validate("roadSections", proposals, context);
  if (!checked.ok) throw new Error(checked.errors.join("\n"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(proposals, null, 2)}\n`);
  console.log(`PROPOSALS ${out}`);
}

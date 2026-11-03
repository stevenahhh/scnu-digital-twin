// Ground migration owned by todo 22. Old paint hulls locate evidence, never
// supply rendered geometry. Photo boundaries or dimensioned section priors do.
import { isAsphalt, proposeRings } from "../qa/asphaltScan.mjs";
import { pointInRing, ringArea, segmentDistance } from "../lib/geometry.mjs";
import { ShapeUtils, Vector2 } from "three";
import { subtractConvex } from "../lib/partition.mjs";

const round = n => Number(n.toFixed(3));
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
const centre = ring => ring.reduce((a, p) => a.map((v, i) => v + p[i] / ring.length), [0, 0]);
const distance = (p, ring) => Math.min(...ring.map((q, i) => segmentDistance(p, q, ring[(i + 1) % ring.length])));
export const ESTIMATE_RULE = "설계 §2: T4 추정: 위 어느 것도 없을 때. 반드시 estimated: true와 이유. §21: 승인 없는 제안은 estimated: true로 빌드에 들어간다.";

export function roadParts(record, blocked) {
  if (record.precedence < 5 || !blocked.length) return [{ ring: record.rings[0], holes: record.rings.slice(1) }];
  const triangles = rings => {
    const contour = rings[0].map(p => new Vector2(...p));
    const holes = rings.slice(1).map(r => r.map(p => new Vector2(...p)));
    const all = [...contour, ...holes.flat()];
    return ShapeUtils.triangulateShape(contour, holes).map(f => f.map(i => [all[i].x, all[i].y]));
  };
  let parts = triangles(record.rings);
  for (const b of blocked) for (const cut of triangles([b.ring, ...b.holes])) {
    const xs = cut.map(p => p[0]), ys = cut.map(p => p[1]);
    const lo = [Math.min(...xs), Math.min(...ys)], hi = [Math.max(...xs), Math.max(...ys)];
    parts = parts.flatMap(p => p.every(q => q[0] < lo[0]) || p.every(q => q[0] > hi[0]) ||
      p.every(q => q[1] < lo[1]) || p.every(q => q[1] > hi[1]) ? [p] : subtractConvex(p, cut));
  }
  return parts.map(ring => ({ ring, holes: [] }));
}

export function groundProposal(seed, window, blocked) {
  const grid = { w: window.w, h: window.h, origin: window.origin, cellM: window.gsdM,
    visible: new Uint8Array(window.w * window.h), asphalt: new Uint8Array(window.w * window.h) };
  for (let i = 0; i < grid.visible.length; i += 1) {
    grid.visible[i] = window.mask[i] ? 0 : 1;
    grid.asphalt[i] = grid.visible[i] && isAsphalt(...window.rgb.subarray(i * 3, i * 3 + 3)) ? 1 : 0;
  }
  const hard = new Uint8Array(grid.w * grid.h);
  const soft = new Uint8Array(hard.length);
  let visible = 0, asphalt = 0;
  for (let y = 0; y < grid.h; y += 1) for (let x = 0; x < grid.w; x += 1) {
    const k = y * grid.w + x;
    const p = [grid.origin[0] + (x + 0.5) * grid.cellM, grid.origin[1] - (y + 0.5) * grid.cellM];
    hard[k] = blocked.some(b => pointInRing(p, b.ring) && !b.holes.some(h => pointInRing(p, h))) ? 1 : 0;
    soft[k] = grid.visible[k] ? 0 : 1;
    visible += grid.visible[k];
    asphalt += grid.asphalt[k];
  }
  const candidates = proposeRings(grid, { hard, soft, covered: new Uint8Array(hard.length), minAreaM2: 3 });
  const ranked = candidates.map(c => ({ ...c, distanceM: pointInRing(seed.point, c.ring) ? 0 : distance(seed.point, c.ring) }))
    .sort((a, b) => a.distanceM - b.distanceM || a.areaM2 - b.areaM2);
  const photo = ranked.find(c => (seed.samples ?? [seed.point]).every(p => pointInRing(p, c.ring)));
  const a = seed.axis, n = [-a[1], a[0]];
  const at = (s, t) => [round(seed.point[0] + a[0] * s + n[0] * t), round(seed.point[1] + a[1] * s + n[1] * t)];
  const profiles = [];
  for (let s = -seed.lengthM / 2; s <= seed.lengthM / 2; s += 1) {
    const runs = [];
    let run = [];
    for (let t = -seed.widthM; t <= seed.widthM; t += window.gsdM) {
      const p = at(s, t);
      const x = Math.floor((p[0] - window.origin[0]) / window.gsdM), y = Math.floor((window.origin[1] - p[1]) / window.gsdM);
      const k = y * grid.w + x;
      const hit = x >= 0 && x < grid.w && y >= 0 && y < grid.h && grid.asphalt[k] && !hard[k];
      if (hit) run.push(t);
      else if (run.length && t - run.at(-1) > 0.75) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    const nearRuns = runs.filter(r => r.at(-1) - r[0] >= 2.5 && r[0] <= 2 && r.at(-1) >= -2)
      .sort((r, q) => Math.min(Math.abs(r[0]), Math.abs(r.at(-1))) - Math.min(Math.abs(q[0]), Math.abs(q.at(-1))));
    if (nearRuns.length) profiles.push([nearRuns[0][0], nearRuns[0].at(-1)]);
  }
  const fitted = profiles.length >= Math.max(3, seed.lengthM / 2);
  const lateral = (seed.samples ?? [seed.point]).map(p => (p[0] - seed.point[0]) * n[0] + (p[1] - seed.point[1]) * n[1]);
  const left = fitted ? Math.min(median(profiles.map(p => p[0])), Math.min(...lateral) - window.gsdM) : -seed.widthM / 2;
  const right = fitted ? Math.max(median(profiles.map(p => p[1])), Math.max(...lateral) + window.gsdM) : seed.widthM / 2;
  const fittedRing = [at(-seed.lengthM / 2, left), at(seed.lengthM / 2, left), at(seed.lengthM / 2, right), at(-seed.lengthM / 2, right)];
  const prior = [at(-seed.lengthM / 2, -seed.widthM / 2), at(seed.lengthM / 2, -seed.widthM / 2), at(seed.lengthM / 2, seed.widthM / 2), at(-seed.lengthM / 2, seed.widthM / 2)];
  const metrics = {
    visibleShare: round(visible / hard.length), asphaltShare: round(asphalt / hard.length),
    nearestBoundaryM: ranked.length ? round(ranked[0].distanceM) : null,
    blockedCells: hard.reduce((s, v) => s + v, 0), cells: hard.length,
    profileCount: profiles.length, lateralBoundsM: fitted ? [round(left), round(right)] : null,
  };
  return {
    id: seed.id, parcelId: seed.parcelId, class: seed.class, road: seed.road,
    paint: seed.paint, method: fitted || photo ? "photo-boundary" : "section-prior",
    section: { origin: seed.point, axis: a, fromM: -seed.lengthM / 2, toM: seed.lengthM / 2, widthM: fitted ? round(right - left) : seed.widthM, lateralOffsetM: fitted ? round((right + left) / 2) : 0 },
    rings: [fitted ? fittedRing : photo?.ring ?? prior], precedence: seed.precedence ?? 3,
    evidence: { tier: fitted || photo ? "T1" : "T4", refs: ["NGII 2025 masked asphalt boundary/transverse profiles", `road_segments ${seed.road}; ${seed.lengthM} m section, ${seed.widthM} m width prior`, ...(fitted || photo ? [] : [ESTIMATE_RULE])] },
    estimated: true, metrics,
    reason: `${fitted || photo ? "Photo boundary/section proposal" : "Photo boundaries/profiles do not constrain the complete requested section; dimensioned prior, not an absence inference"}; visible=${metrics.visibleShare}, asphalt=${metrics.asphaltShare}, profiles=${profiles.length}, lateralBoundsM=${metrics.lateralBoundsM}, nearestBoundaryM=${metrics.nearestBoundaryM}, lengthM=${seed.lengthM}, widthPriorM=${seed.widthM}.`,
  };
}

export function groundParcels(doc) {
  return doc.records.filter(r => r.rings?.length).flatMap(r => (r.parts ?? [{ ring: r.rings[0], holes: r.rings.slice(1) }]).map((part, i) => ({
    id: i ? `${r.parcelId}_PART_${i}` : r.parcelId, cls: r.class === "lot" ? "LOT" : "ASPHALT", class: r.class,
    ...part, precedence: r.precedence ?? 3,
    mesh: r.class === "lot" ? "Ground_Lot" : "Ground_Asphalt", label: null,
    source: "road-section", source_ref: `${r.id}; ${r.reason}`, roadRecord: r.id,
    evidence: r.evidence, estimated: true, paintAllowed: true, curated: "todo 22",
  })));
}

export function migrationErrors(doc, parcels, excluded) {
  const errors = [];
  const records = new Map(doc.records.map(r => [r.id, r]));
  const owners = new Set(doc.records.flatMap(r => r.replaces ?? []));
  for (const id of doc.targets) if (!owners.has(id)) errors.push(`${id}: no road section/junction or quantified decision`);
  for (const r of doc.records) {
    if (!(Number.isFinite(r.section?.widthM) && r.section.widthM > 0)) errors.push(`${r.id}: widthM must be positive`);
    if (!r.reason || !r.evidence?.refs?.length || !Number.isFinite(r.metrics?.visibleShare)) errors.push(`${r.id}: missing quantified evidence`);
    if (r.rings?.length && !parcels.some(p => p.roadRecord === r.id)) errors.push(`${r.id}: generated parcel missing`);
  }
  for (const p of parcels) if (p.source === "photo-paint-support") errors.push(`${p.id}: legacy hull still rendered`);
  for (const d of excluded) if (!records.has(d.record) || !d.reason || !Number.isFinite(d.metrics?.outsideSamples)) errors.push(`${d.piece}: unowned paint exclusion`);
  return errors;
}

if (import.meta.main) {
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { currentPaint } = await import("./parcelsSeed.mjs");
  const { pieceKey, topParcelAt, paintViolations, paintSamples } = await import("../lib/parcels.mjs");
  const { sceneToTm, wgs84ToTm } = await import("../../../src/geo/epsg5186.mjs");
  const { openSheet, sheetWindowForTm } = await import("../lib/ngiiSheet.mjs");
  const { occlusionMask } = await import("../lib/occlusion.mjs");
  const { proposeRoad } = await import("./roadSections.mjs");
  const { encodePng } = await import("../lib/png.mjs");
  const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
  const historical = read("ground/road-support-evidence.json");
  const base = read("ground/parcels.json").parcels.filter(p => p.source !== "photo-paint-support" && p.source !== "road-section");
  const at = topParcelAt(base);
  const { paint, parking } = await currentPaint();
  const pieces = [...paint, ...parking].map(p => ({ ...p, key: pieceKey(p, q => sceneToTm(...q)), rings: p.rings.map(r => r.map(q => sceneToTm(...q))) }));
  const roads = JSON.parse(readFileSync(new URL("../../../../backend/simulation/data/road_segments.geojson", import.meta.url), "utf8")).features.map(f => f.properties);
  const knownWidths = roads.map(r => r.width_m).filter(w => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
  const medianWidthM = knownWidths[knownWidths.length >> 1];
  const leans = new Map(read("photo/building-lean.json").buildings.map(b => [b.id, b.lean]));
  const buildings = read("building-forms.json").buildings.flatMap(b => b.masses.map(m => ({
    rings: [m.outer, ...(m.holes ?? [])].map(r => r.map(p => wgs84ToTm(...p))), heightM: m.topMetres, lean: leans.get(b.key) ?? b.leanPrior,
  })));
  const trees = read("trees.json").trees.map(([east, north, crownDiameterM, heightM]) => ({ east, north, crownDiameterM, heightM }));
  const args = process.argv.slice(2);
  const chips = args.includes("--chips") ? args[args.indexOf("--chips") + 1] : null;
  if (chips) mkdirSync(chips, { recursive: true });
  const groups = historical.supports.map(s => ({
    id: `GROUND_${s.id.replace("PARCEL_SUPPORT_", "")}`, parcelId: s.id, class: s.class,
    replaces: [s.id], points: s.ring, precedence: s.precedence,
    pieces: pieces.filter(p => s.paint.includes(p.key) || pointInRing(centre(p.rings[0]), s.ring)),
  }));
  for (const e of historical.excluded) {
    const p = pieces.find(p => p.key === e.piece);
    if (!p) throw new Error(`${e.piece}: source piece disappeared`);
    groups.push({ id: `JUNCTION_${groups.length}`, parcelId: `PARCEL_JUNCTION_${groups.length}`, class: p.kind === "parking_line" ? "lot" : "road", replaces: [e.piece], points: p.rings[0], precedence: 3, pieces: [p] });
  }
  const ownedPaint = new Set(groups.flatMap(g => g.pieces.map(p => p.key)));
  for (const violation of paintViolations(pieces, base, p => p)) {
    if (ownedPaint.has(violation.piece)) continue;
    const p = pieces.find(p => p.key === violation.piece);
    groups.push({ id: `JUNCTION_${groups.length}`, parcelId: `PARCEL_JUNCTION_${groups.length}`, class: p.kind === "parking_line" ? "lot" : "road", replaces: [p.key], points: p.rings[0], precedence: 3, pieces: [p] });
  }
  const sheet = openSheet(), records = [];
  try {
    for (const group of groups) {
      const point = centre(group.points);
      let nearest = null;
      for (const road of roads) for (let pathIndex = 0; pathIndex < road.epsg5186.length; pathIndex += 1) {
        const line = road.epsg5186[pathIndex];
        for (let i = 1; i < line.length; i += 1) {
          const d = segmentDistance(point, line[i - 1], line[i]);
          if (!nearest || d < nearest.distanceM) nearest = { road, line, pathIndex, a: line[i - 1], b: line[i], distanceM: d };
        }
      }
      if (!nearest) throw new Error(`${group.id}: no road geometry`);
      const d = Math.hypot(nearest.b[0] - nearest.a[0], nearest.b[1] - nearest.a[1]);
      const axis = [(nearest.b[0] - nearest.a[0]) / d, (nearest.b[1] - nearest.a[1]) / d];
      const span = group.points.map(p => (p[0] - point[0]) * axis[0] + (p[1] - point[1]) * axis[1]);
      const lengthM = round(Math.max(4, Math.max(...span.map(Math.abs)) * 2 + 2));
      const widthPriorM = Number.isFinite(nearest.road.width_m) && nearest.road.width_m > 0 ? nearest.road.width_m : medianWidthM;
      const across = group.points.map(p => -(p[0] - point[0]) * axis[1] + (p[1] - point[1]) * axis[0]);
      const widthM = round(Math.max(widthPriorM, Math.max(...across.map(Math.abs)) * 2 + 0.5));
      const pad = Math.max(10, widthM);
      const e0 = Math.min(...group.points.map(p => p[0])) - pad, n0 = Math.max(...group.points.map(p => p[1])) + pad;
      const wM = Math.max(...group.points.map(p => p[0])) + pad - e0, hM = n0 - Math.min(...group.points.map(p => p[1])) + pad;
      const raw = sheetWindowForTm(sheet, e0, n0, wM, hM);
      const gsdM = Math.abs(sheet.tfw.a);
      const window = { w: raw.w, h: raw.h, origin: [sheet.tfw.c - gsdM / 2 + raw.col0 * gsdM, sheet.tfw.f + gsdM / 2 - raw.row0 * gsdM], gsdM, rgb: raw.rgb };
      const near = ([e, n], margin) => e > e0 - margin && e < e0 + wM + margin && n < n0 + margin && n > n0 - hM - margin;
      window.mask = occlusionMask(window, { buildings: buildings.filter(b => b.rings[0].some(p => near(p, 60))), trees: trees.filter(t => near([t.east, t.north], 30)) }).any;
      const blocked = base.filter(p => !p.paintAllowed && !p.estimated && p.ring.some(q => near(q, 10)));
      const owner = at(point);
      const seed = { ...group, point, axis, lengthM, widthM, road: nearest.road.id, precedence: owner?.estimated && !owner.paintAllowed ? 6.2 : group.precedence,
        paint: group.pieces.map(p => p.key), samples: group.pieces.flatMap(p => paintSamples(p, q => q)) };
      const record = groundProposal(seed, window, blocked);
      record.replaces = group.replaces;
      record.metrics.roadDistanceM = round(nearest.distanceM);
      record.metrics.widthPriorM = widthPriorM;
      record.metrics.widthSource = nearest.road.width_m === widthPriorM ? "road_segments" : `median of ${knownWidths.length} finite campus widths`;
      record.roadSection = proposeRoad({ id: nearest.road.id, pathIndex: nearest.pathIndex, line: nearest.line, widthM, lanes: nearest.road.lanes }, window);
      const curvedKerb = group.pieces.length === 1 && group.pieces.find(p => p.kind === "kerb_no_parking" && !pointInRing(centre(p.rings[0]), p.rings[0]));
      if (curvedKerb) {
        record.method = "junction-kerb";
        record.rings = curvedKerb.rings;
        record.precedence = 6.2;
        record.junction = { kind: "kerb_no_parking", contour: curvedKerb.rings, road: nearest.road.id };
        record.metrics.kerbAreaM2 = round(Math.abs(ringArea(curvedKerb.rings[0])));
        record.evidence = { tier: "T1", refs: [curvedKerb.key, "regularized photo kerb contour; the kerb strip is road boundary, never its convex interior"] };
        record.reason = `Curved kerb footprint ${record.metrics.kerbAreaM2} m2; vertex mean lies outside the painted band. Preserve the junction kerb contour, not a convex hull or centre-point road patch. Width remains estimated.`;
      }
      if (!curvedKerb && owner?.paintAllowed && group.replaces[0].startsWith("PARCEL_") &&
          seed.samples.every(p => pointInRing(p, owner.ring) && !owner.holes.some(h => pointInRing(p, h)))) {
        record.rings = [owner.ring, ...owner.holes];
        record.precedence = owner.precedence;
        record.method = "existing-road-lot";
        record.owner = owner.id;
        record.evidence.refs.push(`${owner.id}; ${owner.source_ref}`);
        record.reason = `Existing reviewed road/lot ${owner.id} contains the old hull sample; area=${round(Math.abs(ringArea(owner.ring)))} m2. ${record.reason}`;
      }
      record.parts = roadParts(record, blocked);
      record.metrics.surfaceAreaM2 = round(record.parts.reduce((s, p) => s + Math.abs(ringArea(p.ring)), 0));
      record.metrics.surveyClippedM2 = round(Math.max(0, Math.abs(ringArea(record.rings[0])) - record.metrics.surfaceAreaM2));
      records.push(record);
      if (chips) {
        const rgb = new Uint8Array(raw.rgb);
        for (const ring of record.rings) for (let i = 0; i < ring.length; i += 1) {
          const a = ring[i], b = ring[(i + 1) % ring.length], steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / gsdM * 2);
          for (let k = 0; k <= steps; k += 1) {
            const x = Math.floor((a[0] + (b[0] - a[0]) * k / steps - window.origin[0]) / gsdM);
            const y = Math.floor((window.origin[1] - a[1] - (b[1] - a[1]) * k / steps) / gsdM);
            if (x >= 0 && x < raw.w && y >= 0 && y < raw.h) rgb.set([255, 220, 0], (y * raw.w + x) * 3);
          }
        }
        writeFileSync(resolve(chips, `${group.id}.png`), encodePng(raw.w, raw.h, 3, rgb));
      }
      console.log(`${record.id} ${record.method} visible=${record.metrics.visibleShare} asphalt=${record.metrics.asphaltShare} roadDistance=${record.metrics.roadDistanceM}`);
    }
  } finally { sheet.close(); }
  const doc = { generator: "fit/roadGround.mjs", estimateRule: ESTIMATE_RULE, targets: [...historical.supports.map(s => s.id), ...historical.excluded.map(e => e.piece)], records };
  const out = new URL("../data/ground/road-ground.json", import.meta.url);
  writeFileSync(out, JSON.stringify(doc, null, 1) + "\n");
  console.log(`ROAD_GROUND ${records.length} records`);
}

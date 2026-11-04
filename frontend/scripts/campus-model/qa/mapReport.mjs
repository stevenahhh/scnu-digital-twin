// Build/CLI map comparison. Importing this module performs no I/O or process work.
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT, modelToGeo } from "../lib/frame.mjs";
import { DEFAULT_SHEET, openSheet } from "../lib/ngiiSheet.mjs";
import { tmToPixel, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { paintMasks } from "../lib/paintMasks.mjs";
import { occlusionMask } from "../lib/occlusion.mjs";
import { roadMarkingPlan } from "../stages/roadMarkings.mjs";
import { TOLERANCES, compareRoadInventory, lotSummary, missingDividers, parkingObjects, physicalRoadCrossings, roadAcceptance, roadMapObjects, roadObjectInventory, rowSummary, scoreObjects } from "./mapCompare.mjs";

export function createMapComparison({ sheet, masks = {}, pieces, meshReport, rawGlbSha256, roadSourceHashes,
  bindings, reference, parkingDoc, nodes = [], identity = null, sheetName = null, maskSources = {}, optionalAerial }) {
  if (!sheet) throw new TypeError("mandatory sheet unavailable");
  if (!rawGlbSha256 || meshReport.rawGlbSha256 !== rawGlbSha256) throw new RangeError("stale mesh report: raw GLB hash mismatch; rebuild the GLB");
  if (identity && identity.rawGlbSha256 !== rawGlbSha256) throw new RangeError("map identity mismatch: rawGlbSha256");
  for (const name of ["road-sections", "junctions", "parcels"]) {
    if (!roadSourceHashes?.[name] || meshReport.symbols.roadSourceHashes?.[name] !== roadSourceHashes[name]) throw new RangeError(`stale mesh report: ${name}; rebuild the GLB`);
  }
  const emittedIds = new Set(meshReport.emission.parts.map(p => p.partId));
  const inventory = roadObjectInventory(pieces.filter(p => emittedIds.has(p.partId)), bindings);
  const existence = reference ? compareRoadInventory(reference, {
    ...inventory,
    // Presence labels name logical paint segments, not the fraction of RD
    // containers which happen to have a marking.
    segmentIds: inventory.objects.filter(o => o.pieces.some(p => /^(centre_line|lane_line|edge_line|guide_|kerb)/.test(p.kind))).map(o => o.id),
  }) : null;
  const objects = roadMapObjects(pieces, meshReport.emission);
  const parkingScored = parkingObjects(parkingDoc);
  objects.push(...parkingScored.map((o) => (o.geometry.type === "line" ? { ...o, geometry: { type: "line", parts: [o.geometry.coords] } } : o)));
  const scored = scoreObjects(objects, sheet, masks);
  const physicalObjects = physicalRoadCrossings(objects, reference?.physicalCrossings ?? []);
  const physicalScores = scoreObjects(physicalObjects, sheet, masks).map((score, i) => ({
    ...score, missingMemberIds: physicalObjects[i].missingMemberIds,
  }));
  const centreOf = (o) => {
    const pts = o.geometry.type === "line" ? o.geometry.parts.flat() : (o.geometry.polygons ?? [o.geometry.rings]).flat(2);
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  };
  scored.forEach((r, i) => {
    const c = centreOf(objects[i]);
    let best = null;
    for (const n of nodes) {
      const d = Math.hypot(n.gisCentreTm[0] - c[0], n.gisCentreTm[1] - c[1]);
      if (!best || d < best.d) best = { id: n.nodeId, d };
    }
    r.centreTm = c.map((v) => Math.round(v * 100) / 100);
    r.near = best && best.d <= 80 ? best.id : null;
    r.objectId = objects[i].objectId ?? null;
    r.ownerId = objects[i].ownerId ?? null;
    r.evidence = objects[i].evidence ?? null;
  });
  if (existence) for (const r of [...existence.segments.rows, ...existence.crossings.rows]) {
    const existing = scored.find(s => s.id === r.id);
    if (existing) {
      existing.referenceStatus = r.status;
      if (r.over) existing.over = true;
    } else if (r.over) scored.push({
      id: r.id, kind: r.id.endsWith("/crossing") ? "crossing" : "road_segment",
      tier: r.id.endsWith("/crossing") ? "crossing" : "lane",
      residual_m: null, iou: null, support: 0, occluded: false, over: true,
      missing: r.status === "missing" || r.status === "fn", referenceStatus: r.status,
    });
  }
  const missing = missingDividers(parkingDoc, parkingScored, sheet, masks);
  scored.push(...missing);
  const rows = rowSummary(parkingDoc, scored);
  const lots = lotSummary(parkingDoc, scored);
  const overList = scored.filter((r) => r.over);
  const byTier = {};
  for (const r of scored) {
    const t = (byTier[r.tier] ??= { objects: 0, occluded: 0, unmeasurable: 0, over: 0, residuals: [] });
    t.objects += 1;
    if (r.occluded) t.occluded += 1;
    if (r.unmeasurable) t.unmeasurable += 1;
    if (r.over) t.over += 1;
    if (r.residual_m !== null && r.residual_m !== undefined) t.residuals.push(r.residual_m);
  }
  for (const t of Object.values(byTier)) {
    const s = t.residuals.sort((a, b) => a - b);
    t.medianResidualM = s.length ? s[s.length >> 1] : null;
    delete t.residuals;
  }
  const report = {
    schemaVersion: 1, identity, sheet: sheetName, metresPerPixel: sheet.gsdM,
    source: "Road_Markings emitted triangle union and triangle cross-section centrelines, EPSG:5186",
    roadSourceHashes: meshReport.symbols.roadSourceHashes, roadExistence: existence,
    rawGlbSha256: meshReport.rawGlbSha256,
    referenceEvidenceAvailable: Boolean(reference), roadOwnership: { assignedSegments: inventory.segmentIds, unassignedOwners: inventory.unassignedOwners },
    referenceComplete: reference?.complete === true, physicalCrossings: physicalScores,
    crossingGridUnit: "canonical grid; a physical crossing may contain multiple grids",
    emission: meshReport.emission.summary, masks: maskSources,
    tolerances: TOLERANCES, byTier, overTolerance: overList.length,
    overToleranceList: [...overList, ...physicalScores.filter(r => r.over)],
    parkingLots: lots, parkingRows: rows, objects: scored,
  };
  report.optionalAerial = optionalAerial ?? { status: "unavailable", reason: "optional aerial not supplied" };
  report.notRun = physicalScores.length ? [] : [{ id: "physicalCrossings", reason: "physical crossing references missing" }];
  report.roadAcceptance = roadAcceptance(report);
  return report;
}

// Reads only the requested window; the caller owns and closes the sheet.
export function readMapWindow(sheet, cornersTm) {
  const gsd = sheet.tfw.a;
  const E0 = Math.min(...cornersTm.map((p) => p[0])) - 10;
  const N1 = Math.max(...cornersTm.map((p) => p[1])) + 10;
  const [colF, rowF] = tmToPixel(E0, N1, sheet.tfw);
  const col0 = Math.max(0, Math.round(colF));
  const row0 = Math.max(0, Math.round(rowF));
  const w = Math.min(sheet.width - col0, Math.ceil((Math.max(...cornersTm.map((p) => p[0])) + 10 - E0) / gsd));
  const h = Math.min(sheet.height - row0, Math.ceil((N1 - Math.min(...cornersTm.map((p) => p[1])) + 10) / gsd));
  if (w <= 0 || h <= 0) throw new RangeError("mandatory sheet does not cover the map window");
  const rgb = sheet.readWindow(col0, row0, w, h);
  const origin = [sheet.tfw.c + col0 * gsd - gsd / 2, sheet.tfw.f + row0 * sheet.tfw.d - sheet.tfw.d / 2];
  const paint = paintMasks({ rgb, width: w, height: h, metresPerPixel: gsd });
  return { w, h, origin, gsdM: gsd, paint };
}

// File adapter: paths for the raw candidate and its emission receipt travel together.
export async function runMapComparison({ sheetPath = DEFAULT_SHEET,
  dataDir = join(dirname(fileURLToPath(import.meta.url)), "../data"),
  rawGlbPath = join(dataDir, "../.build/campus-v2.raw.glb"),
  meshReportPath = join(dataDir, "../.build/markings.report.json"),
  parkingPath = join(dataDir, "ground/parking.json"),
  referencePath = join(dataDir, "photo/evidence/road-reference.json"),
  identity = null, optionalAerial } = {}) {
  if (!existsSync(sheetPath)) throw new TypeError(`mandatory sheet unavailable: ${sheetPath}`);
  const opened = openSheet(sheetPath);
  let sheet;
  try {
    const corners = [[EXTENT.minX, EXTENT.minZ], [EXTENT.maxX, EXTENT.minZ], [EXTENT.minX, EXTENT.maxZ], [EXTENT.maxX, EXTENT.maxZ]];
    sheet = readMapWindow(opened, corners.map(([x, z]) => wgs84ToTm(...modelToGeo(x, z))));
  } finally { opened.close(); }
  const json = file => JSON.parse(readFileSync(file, "utf8"));
  const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
  const meshReport = json(meshReportPath);
  const roadSourceHashes = Object.fromEntries(["road-sections", "junctions", "parcels"].map(name => [name, hash(join(dataDir, "ground", name + ".json"))]));
  const rawGlbSha256 = hash(rawGlbPath);
  const sections = json(join(dataDir, "ground/road-sections.json"));
  const junctions = json(join(dataDir, "ground/junctions.json"));
  const bindings = [];
  for (const [segmentId, road] of Object.entries(sections)) for (const section of road.sections) {
    const association = road.alignments[section.alignment].association;
    bindings.push({ ownerId: section.id, segmentId, verified: association.verified, refs: association.refs ?? [] });
  }
  for (const junction of Object.values(junctions)) for (const approach of junction.approaches) {
    const association = sections[approach.segment].alignments[approach.alignment].association;
    bindings.push({ ownerId: approach.id, segmentId: approach.segment, verified: association.verified && approach.curation?.verified === true, refs: association.refs ?? [] });
  }

  const forms = json(join(dataDir, "building-forms.json"));
  const leanPath = join(dataDir, "photo/building-lean.json");
  const leans = existsSync(leanPath) ? new Map(json(leanPath).buildings.map(b => [b.id, b.lean])) : new Map();
  const buildings = forms.buildings.flatMap(b => b.masses.map(m => ({
    rings: [m.outer, ...(m.holes ?? [])].map(r => r.map(([lon, lat]) => wgs84ToTm(lon, lat))),
    heightM: m.topMetres, lean: leans.get(b.key) ?? b.leanPrior ?? [0, 0],
  })));
  const trees = json(join(dataDir, "trees.json")).trees.map(([east, north, crownDiameterM, heightM]) => ({ east, north, crownDiameterM, heightM }));
  return createMapComparison({ sheet, masks: occlusionMask(sheet, { buildings, trees }),
    pieces: roadMarkingPlan({ sections, junctions }).pieces, meshReport, rawGlbSha256, roadSourceHashes, bindings,
    reference: existsSync(referencePath) ? json(referencePath) : null, parkingDoc: json(parkingPath),
    nodes: json(join(dataDir, "bld-node-map.json")).entries.filter(e => e.gisCentreTm), identity, sheetName: basename(sheetPath), optionalAerial,
    maskSources: { leans: existsSync(leanPath) ? "data/photo/building-lean.json" : "building-forms.json leanPrior (data/photo/building-lean.json missing)", trees: "data/trees.json", shadows: "lib/poleShadow.mjs SUN" },
  });
}

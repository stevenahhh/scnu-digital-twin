// Reviewed ownership is additive to the evidence-fit seed. Geometry and
// dimensions stay estimated unless a separate, supported control edit is made.
import { topParcelAt } from "../lib/parcels.mjs";

export function roadOwnershipCandidates(points, zones) {
  if (!points.length) return [];
  return zones.map(zone => {
    const contains = topParcelAt(zone.polygons);
    return { segmentId: zone.id, share: points.filter(p => contains(p)).length / points.length };
  }).filter(r => r.share > 0).sort((a, b) => b.share - a.share || a.segmentId.localeCompare(b.segmentId));
}

export function applyRoadCuration(docs, curation, context) {
  const result = structuredClone(docs);
  const sections = Object.entries(result.sections).flatMap(([segment, road]) => road.sections.map(section => ({ segment, road, section })));
  const approaches = Object.entries(result.junctions).flatMap(([node, junction]) => junction.approaches.map(approach => ({ node, junction, approach })));
  const owners = new Set([...sections.map(r => r.section.id), ...approaches.map(r => r.approach.id)]);
  const reviews = new Map();
  for (const r of curation.owners) {
    if (!owners.has(r.id)) throw new Error(`unknown owner review ${r.id}`);
    if (reviews.has(r.id)) throw new Error(`duplicate owner review ${r.id}`);
    if (typeof r.verified !== "boolean" || !r.reason?.trim()) throw new Error(`owner review ${r.id} needs status and reason`);
    if (r.verified && !r.refs?.some(ref => typeof ref === "string" && ref.trim())) throw new Error(`${r.id}: verified review needs refs`);
    if (r.geometry && (!r.geometry.refs?.length || !r.geometry.reason?.trim())) throw new Error(`${r.id}: geometry edit needs evidence`);
    reviews.set(r.id, r);
  }
  for (const id of owners) if (!reviews.has(id)) throw new Error(`missing owner review ${id}`);
  const roadIds = new Set(context.segments.map(s => s.id)), nodeIds = new Set(context.nodes);
  const location = new Map();
  for (const { segment, road, section } of sections) {
    const review = reviews.get(section.id);
    const alignment = road.alignments[section.alignment];
    const target = review.verified ? review.segmentId : segment;
    if (!roadIds.has(target)) throw new Error(`${section.id}: unknown segment ${target}`);
    alignment.association = { ...alignment.association, verified: review.verified, refs: review.refs ?? [],
      method: review.method ?? "reviewed evidence", candidates: review.candidates ?? [] };
    section.curation = { verified: review.verified, refs: review.refs ?? [], reason: review.reason, dimensionsVerified: false };
    if (review.geometry) {
      const { line, lateralOffsetM, lanes, fromM, toM } = review.geometry;
      if (line) alignment.line = structuredClone(line);
      if (fromM !== undefined) section.fromM = fromM;
      if (toM !== undefined) section.toM = toM;
      if (lateralOffsetM !== undefined) section.lateralOffsetM = lateralOffsetM;
      if (lanes) section.lanes = structuredClone(lanes);
      section.curation.geometry = structuredClone(review.geometry);
    }
    if (target !== segment) {
      result.sections[target] ??= { alignments: {}, sections: [] };
      if (result.sections[target].alignments[section.alignment]) throw new Error(`duplicate alignment ${section.alignment}`);
      result.sections[target].alignments[section.alignment] = alignment;
      result.sections[target].sections.push(section);
      section.pathIndex = 0;
      road.sections = road.sections.filter(s => s.id !== section.id);
      if (!road.sections.some(s => s.alignment === section.alignment)) delete road.alignments[section.alignment];
      if (!road.sections.length) delete result.sections[segment];
    }
    location.set(section.id, { segment: target, verified: review.verified, pathIndex: section.pathIndex });
  }
  for (const { node, junction, approach } of approaches) {
    const review = reviews.get(approach.id), section = location.get(approach.section);
    if (!section) throw new Error(`${approach.id}: unknown section owner`);
    if (review.verified && !section.verified) throw new Error(`${approach.id}: verified junction needs verified road ownership`);
    const target = review.verified ? review.nodeId : node;
    if (!nodeIds.has(target)) throw new Error(`${approach.id}: unknown junction ${target}`);
    approach.segment = section.segment;
    approach.pathIndex = section.pathIndex;
    approach.curation = { verified: review.verified, refs: review.refs ?? [], reason: review.reason, dimensionsVerified: false };
    if (review.geometry) {
      for (const key of ["crossing", "guideLines"]) {
        if (key in review.geometry) approach[key] = structuredClone(review.geometry[key]);
      }
      approach.curation.geometry = structuredClone(review.geometry);
    }
    if (review.suppressCrossing) {
      const proof = review.suppressCrossing;
      const retained = approaches.find(r => r.approach.id === proof.duplicateOf)?.approach;
      if (!proof.refs?.length || !proof.reason?.trim() || !retained?.crossing || retained.id === approach.id || reviews.get(retained.id)?.suppressCrossing) {
        throw new Error(`${approach.id}: invalid crossing suppression evidence or retained target`);
      }
      approach.crossing = null;
      approach.curation.suppressedCrossing = proof;
    }
    if (target !== node) {
      result.junctions[target] ??= { approaches: [] };
      result.junctions[target].approaches.push(approach);
      junction.approaches = junction.approaches.filter(a => a.id !== approach.id);
      if (!junction.approaches.length) delete result.junctions[node];
    }
  }
  // A visible crossing no evidence fit seeded gets its own station owner. Its
  // road and junction identity stay unverified until separately reviewed.
  for (const add of curation.addedCrossings ?? []) {
    const where = `added crossing ${add.approachId}`;
    if (!add.refs?.some(ref => typeof ref === "string" && ref.trim()) || !add.reason?.trim()) throw new Error(`${where}: needs refs and reason`);
    if (!roadIds.has(add.segmentId) || !nodeIds.has(add.nodeId)) throw new Error(`${where}: unknown segment or junction`);
    if (owners.has(add.sectionId) || owners.has(add.approachId) || !/^RS_/.test(add.sectionId) || !/^JA_/.test(add.approachId)) throw new Error(`${where}: owner ids must be new RS_/JA_ ids`);
    owners.add(add.sectionId); owners.add(add.approachId);
    const alignment = "RA_" + add.sectionId.slice(3), lengthM = add.line.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - add.line[i][0], p[1] - add.line[i][1]), 0);
    const curated = { verified: false, refs: add.refs, reason: add.reason, dimensionsVerified: false };
    const evidence = { tier: "T1", refs: add.refs };
    result.sections[add.segmentId] ??= { alignments: {}, sections: [] };
    result.sections[add.segmentId].alignments[alignment] = { line: structuredClone(add.line), evidence, estimated: true, reason: add.reason,
      role: "curated-crossing-station", association: { verified: false, refs: add.refs, method: "added crossing", candidates: [] } };
    result.sections[add.segmentId].sections.push({ id: add.sectionId, alignment, pathIndex: 0, fromM: 0, toM: lengthM,
      lanes: [{ dir: "fwd", widthM: add.widthM / 2 }, { dir: "bwd", widthM: add.widthM / 2 }], centre: { type: "none", widthM: 0.15 },
      edges: { left: "none", right: "none" }, lateralOffsetM: 0, kerbOffsetsM: { left: add.widthM / 2, right: add.widthM / 2 },
      kerbNoParking: { left: false, right: false }, humps: [], evidence, estimated: true, reason: add.reason, curation: curated });
    result.junctions[add.nodeId] ??= { approaches: [] };
    result.junctions[add.nodeId].approaches.push({ id: add.approachId, segment: add.segmentId, section: add.sectionId, alignment, pathIndex: 0, end: "to",
      stopLineSetbackM: null, crossing: structuredClone(add.crossing), arrows: [], text: [], humps: [], signalArms: [], yieldTriangles: [], guideLines: [],
      symbols: [], areas: [], evidence, estimated: true, reason: add.reason, curation: structuredClone(curated) });
  }
  return result;
}

// Reviews amend the frozen candidate corpus; they never declare it exhaustive
// or derive presence from the current output. The same reviews reapply at seed.
export function applyRoadReferenceReviews(reference, reviews) {
  const result = structuredClone(reference);
  for (const kind of ["segments", "crossings", "physicalCrossings"]) {
    for (const review of reviews[kind] ?? []) {
      const row = result[kind]?.find(r => r.id === review.id);
      if (!row || !review.refs?.length || !review.reason?.trim()) throw new Error(`${review.id}: reference review needs an existing id and evidence`);
      Object.assign(row, structuredClone(review));
    }
  }
  return result;
}

export function applyRoadSurfaceReviews(parcels, reviews) {
  const ids = new Set(parcels.map(p => p.id)), byId = new Map();
  for (const r of reviews) {
    if (!ids.has(r.parcelId) || byId.has(r.parcelId)) throw new Error(`unknown or duplicate surface review ${r.parcelId}`);
    if (!r.reason?.trim() || !r.refs?.length) throw new Error(`${r.parcelId}: surface review needs refs and reason`);
    byId.set(r.parcelId, r);
  }
  return parcels.map(p => {
    const r = byId.get(p.id);
    if (!r) return p;
    if (p.class !== "road") throw new Error(`${p.id}: road surface review cannot change another ground class`);
    return { ...p, mesh: r.mesh ?? p.mesh, source: "photo-curated", estimated: true, evidence: { tier: "T1", refs: r.refs },
      curated: "todo 24", source_ref: `${p.source_ref}; ${r.reason}`,
      surfaceReview: { observedSurface: r.observedSurface, use: r.use, reason: r.reason, refs: r.refs } };
  });
}

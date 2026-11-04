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

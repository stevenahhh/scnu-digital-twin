import assert from "node:assert/strict";
import test from "node:test";
import * as curation from "./roadCuration.mjs";

const RS = "RS_1111111111111111", RA = "RA_1111111111111111", JA = "JA_1111111111111111";
const original = {
  sections: { RD_001: { alignments: { [RA]: { line: [[10, 20], [30, 20]], association: { verified: false }, seedIdentity: { refs: ["photo"] } } },
    sections: [{ id: RS, alignment: RA, pathIndex: 1, lanes: [{ widthM: 6, dir: "fwd" }] }] } },
  junctions: { ND_001: { approaches: [{ id: JA, segment: "RD_001", section: RS, alignment: RA, pathIndex: 1 }] } },
};
const context = { segments: [{ id: "RD_001" }, { id: "RD_074" }], nodes: ["ND_001", "ND_058"] };
const reviews = [
  { id: RS, verified: true, segmentId: "RD_074", refs: ["reviewed zone polygon + photo"], reason: "grounded road association" },
  { id: JA, verified: true, nodeId: "ND_058", refs: ["named junction polygon + photo"], reason: "grounded junction" },
];

test("curated ownership moves records without changing identity, alignment geometry or estimated width", () => {
  const result = curation.applyRoadCuration(original, { owners: reviews }, context);
  assert.deepEqual(Object.keys(result.sections), ["RD_074"]);
  assert.deepEqual(result.sections.RD_074.alignments[RA].line, [[10, 20], [30, 20]]);
  assert.equal(result.sections.RD_074.sections[0].id, RS);
  assert.deepEqual(result.sections.RD_074.sections[0].lanes, original.sections.RD_001.sections[0].lanes);
  assert.equal(result.sections.RD_074.alignments[RA].association.verified, true);
  assert.equal(result.junctions.ND_058.approaches[0].segment, "RD_074");
  assert.equal(result.junctions.ND_058.approaches[0].id, JA);
  assert.equal(original.sections.RD_001.alignments[RA].association.verified, false);
});

test("unresolved reviews preserve original containers and remain explicitly unverified", () => {
  const result = curation.applyRoadCuration(original, {
    owners: reviews.map(r => ({ ...r, verified: false, reason: "ambiguous photo association" })),
  }, context);
  assert.deepEqual(Object.keys(result.sections), ["RD_001"]);
  assert.deepEqual(Object.keys(result.junctions), ["ND_001"]);
  assert.equal(result.sections.RD_001.alignments[RA].association.verified, false);
  assert.equal(result.sections.RD_001.sections[0].curation.dimensionsVerified, false);
});

test("photo control edits survive reseeding without approving ownership or mutating inputs", () => {
  const owners = reviews.map(r => ({ ...r, verified: false }));
  owners[0].geometry = { refs: ["independent photo profiles"], reason: "signed ridge offset",
    lateralOffsetM: -0.4, line: [[11, 21], [31, 21]] };
  owners[1].geometry = { refs: ["visible stripe slots"], reason: "partial detection missed visible bars",
    crossing: { offsetM: 10, widthM: 4, barWidthM: 0.5, zebraPeriodM: 0.9, omittedBars: [0, 7] } };
  const result = curation.applyRoadCuration(original, { owners }, context);
  assert.equal(result.sections.RD_001.sections[0].lateralOffsetM, -0.4);
  assert.deepEqual(result.sections.RD_001.alignments[RA].line, [[11, 21], [31, 21]]);
  assert.deepEqual(result.junctions.ND_001.approaches[0].crossing.omittedBars, [0, 7]);
  assert.equal(result.sections.RD_001.sections[0].curation.verified, false);
  assert.equal(original.sections.RD_001.sections[0].lateralOffsetM, undefined);
  assert.deepEqual(original.sections.RD_001.alignments[RA].line, [[10, 20], [30, 20]]);
});

test("geometry edits cannot bypass their independent evidence requirement", () => {
  assert.throws(() => curation.applyRoadCuration(original, { owners: [
    { ...reviews[0], geometry: { lateralOffsetM: 0.4, refs: [], reason: "unsupported" } }, reviews[1],
  ] }, context), /geometry.*evidence/);
});

test("reference review repairs membership but preserves the frozen universe and unknown labels", () => {
  const reference = { complete: false, segments: [{ id: "line", expected: null }],
    physicalCrossings: [{ id: "CW", expected: true, objectIds: [], boundsTm: [1, 2, 3, 4] }] };
  const result = curation.applyRoadReferenceReviews(reference, { physicalCrossings: [
    { id: "CW", objectIds: [JA + "/crossing"], refs: ["photo + emitted catalogue"], reason: "same crossing" },
  ] });
  assert.deepEqual(result.physicalCrossings[0].objectIds, [JA + "/crossing"]);
  assert.deepEqual(result.physicalCrossings[0].boundsTm, [1, 2, 3, 4]);
  assert.deepEqual(result.segments, reference.segments);
  assert.equal(result.complete, false);
  assert.deepEqual(reference.physicalCrossings[0].objectIds, []);
});

test("reference review rejects invented ids and unsupported positive or negative labels", () => {
  const reference = { segments: [{ id: "line", expected: null }] };
  for (const row of [
    { id: "absent", expected: true, refs: ["photo"], reason: "visible" },
    { id: "line", expected: false, refs: [], reason: "unsupported absence" },
  ]) assert.throws(() => curation.applyRoadReferenceReviews(reference, { segments: [row] }), /reference/);
});

test("missing, unknown and duplicate owner reviews fail by id", () => {
  for (const owners of [reviews.slice(1), [...reviews, { ...reviews[0], id: "RS_unknown" }], [...reviews, reviews[0]]]) {
    assert.throws(() => curation.applyRoadCuration(original, { owners }, context), /owner|review/);
  }
});

test("an approved junction cannot bypass an unresolved road association", () => {
  assert.throws(() => curation.applyRoadCuration(original, {
    owners: [{ ...reviews[0], verified: false }, reviews[1]],
  }, context), /junction.*road/);
});

test("verified ownership needs independent references and authoritative target ids", () => {
  for (const patch of [{ refs: [] }, { segmentId: "RD_999" }]) {
    assert.throws(() => curation.applyRoadCuration(original, { owners: [{ ...reviews[0], ...patch }, reviews[1]] }, context), /refs|segment/);
  }
});

test("surface review retains genuine paving geometry and keeps uncertain use separate from observed colour", () => {
  const parcel = { id: "ZONE17", ring: [[0, 0], [4, 0], [4, 3]], holes: [], class: "road", paintAllowed: true, mesh: "Ground_Asphalt", estimated: false };
  const [result] = curation.applyRoadSurfaceReviews([parcel], [{
    parcelId: "ZONE17", mesh: "Ground_RedRoad", observedSurface: "red coating", use: "unknown",
    refs: ["2025 aerial tile"], reason: "visible red surface, substrate and use unknown",
  }]);
  assert.deepEqual(result.ring, parcel.ring);
  assert.equal(result.mesh, "Ground_RedRoad");
  assert.equal(result.class, "road");
  assert.equal(result.paintAllowed, true);
  assert.equal(result.estimated, true);
  assert.equal(result.surfaceReview.use, "unknown");
  assert.equal(parcel.mesh, "Ground_Asphalt");
});

test("road ownership candidates use polygon containment, not nearest centreline or copied widths", () => {
  const zones = [
    { id: "RD_001", polygons: [{ ring: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] }] },
    { id: "RD_074", polygons: [{ ring: [[20, 0], [30, 0], [30, 10], [20, 10]], holes: [] }] },
  ];
  assert.deepEqual(curation.roadOwnershipCandidates([[21, 2], [22, 3]], zones), [{ segmentId: "RD_074", share: 1 }]);
  assert.deepEqual(curation.roadOwnershipCandidates([[15, 2]], zones), []);
  assert.deepEqual(curation.roadOwnershipCandidates([], zones), []);
});

test("overlapping road polygons remain multiple candidates rather than silently picking one", () => {
  const polygon = { ring: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [[[4, 4], [6, 4], [6, 6], [4, 6]]] };
  const zones = [{ id: "RD_001", polygons: [polygon] }, { id: "RD_074", polygons: [polygon] }];
  assert.deepEqual(curation.roadOwnershipCandidates([[1, 1]], zones), [{ segmentId: "RD_001", share: 1 }, { segmentId: "RD_074", share: 1 }]);
  assert.deepEqual(curation.roadOwnershipCandidates([[5, 5]], zones), []);
});

const JA2 = "JA_2222222222222222";
const duplicateDocs = {
  ...original,
  junctions: { ND_001: { approaches: [
    { ...original.junctions.ND_001.approaches[0], crossing: { widthM: 4 }, text: ["kept"] },
    { ...original.junctions.ND_001.approaches[0], id: JA2, crossing: { widthM: 4 }, text: ["kept"] },
  ] } },
};
const duplicateReviews = [
  ...reviews.map(r => ({ ...r, verified: false })),
  { id: JA2, verified: false, refs: [], reason: "road ownership unknown",
    suppressCrossing: { duplicateOf: JA, refs: ["two photo envelopes identify the same crossing"], reason: "duplicate grid" } },
];

test("a documented duplicate crossing is suppressed at the seed while the retained crossing and other controls survive", () => {
  const result = curation.applyRoadCuration(duplicateDocs, { owners: duplicateReviews }, context);
  const approaches = result.junctions.ND_001.approaches;
  assert.deepEqual(approaches.find(a => a.id === JA).crossing, { widthM: 4 });
  assert.equal(approaches.find(a => a.id === JA2).crossing, null);
  assert.deepEqual(approaches.find(a => a.id === JA2).text, ["kept"]);
  assert.deepEqual(duplicateDocs.junctions.ND_001.approaches[1].crossing, { widthM: 4 });
});

test("crossing suppression cannot use absent evidence or another suppressed crossing", () => {
  for (const patch of [{ refs: [] }, { duplicateOf: JA2 }]) {
    const last = duplicateReviews.at(-1);
    assert.throws(() => curation.applyRoadCuration(duplicateDocs, {
      owners: [...duplicateReviews.slice(0, -1), { ...last, suppressCrossing: { ...last.suppressCrossing, ...patch } }],
    }, context), /suppression/);
  }
});

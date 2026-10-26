// Checks for data/photo/rest-spaces.geojson (VR-located rest spaces) against the catalogue, the survey and the
// reconciliation table. REST_SPACES_FILE checks another file with the same rules (stages/furniture.mjs reads it too).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { B, REST_SPACES, duplicatesOf, loadFurniture, restDims } from "../../stages/furniture.mjs";

const rest = JSON.parse(readFileSync(REST_SPACES, "utf8"));
const catalogue = JSON.parse(readFileSync(new URL("../rest-space-catalogue.json", import.meta.url), "utf8")).types;
const reconciliation = JSON.parse(readFileSync(new URL("./rest-spaces-reconciliation.json", import.meta.url), "utf8"));
const furniture = loadFurniture();
const placed = furniture.objects.filter((o) => o.source === "rest-spaces");

test("every rest space carries its provenance and an estimated flag", () => {
  assert.ok(rest.features.length > 0);
  for (const { properties: p, geometry: g } of rest.features) {
    assert.match(p.id, /^RS(\d{4}[A-Z]?|-GATE-[A-Z0-9]+)$/, `${p.id}: id`);
    assert.equal(p.estimated, true, `${p.id}: estimated`);
    assert.ok(catalogue[p.kind] || B[p.kind], `${p.id}: kind ${p.kind} is neither a catalogue type nor a builder`);
    assert.match(p.vr_scene, /^scene_[a-z0-9_]+$/, `${p.id}: vr_scene`);
    assert.ok(["f", "r", "b", "l", "u", "d"].includes(p.vr_face), `${p.id}: vr_face`);
    assert.ok(Array.isArray(p.vr_cols) && p.vr_cols.length === 2, `${p.id}: vr_cols`);
    const support = p.photo_support ?? "none"; // the gate sign (todo 14) is VR-only and carries no photo_support
    assert.ok(["roof", "wall", "none"].includes(support), `${p.id}: photo_support ${p.photo_support}`);
    assert.ok(p.confidence > 0 && p.confidence <= 1, `${p.id}: confidence`);
    if (support === "none") assert.ok(p.confidence <= 0.4, `${p.id}: a VR-only position keeps confidence <= 0.4`);
    assert.ok(p.height_source?.endsWith("(estimated)"), `${p.id}: height_source must end in (estimated)`);
    assert.ok((p.position_method ?? p.method)?.length > 10, `${p.id}: position_method`);
    assert.ok(["Point", "LineString", "Polygon"].includes(g.type), `${p.id}: geometry`);
  }
});

test("dimensions stay inside the catalogue ranges", () => {
  for (const { properties: p } of rest.features) if (catalogue[p.kind] && p.dims) restDims(p.kind, p.dims, p.id);
});

test("no rest space draws an existing object twice (3 m, same class)", () => {
  const survey = furniture.objects.filter((o) => o.source === "survey");
  const againstSurvey = duplicatesOf(placed, survey);
  assert.deepEqual(againstSurvey, [], `duplicates survey object: ${JSON.stringify(againstSurvey)}`);
  const amongThemselves = duplicatesOf(placed, placed).filter(({ id, other }) => id < other);
  assert.deepEqual(amongThemselves, [], `duplicate rest spaces: ${JSON.stringify(amongThemselves)}`);
});

test("one feature group per sighting decided missing, none for the others", () => {
  const missing = reconciliation.sightings.filter((s) => s.decision === "missing").map((s) => s.instanceId);
  const groups = new Set(rest.features.map((f) => f.properties.id).filter((id) => /^RS\d{4}/.test(id)).map((id) => id.replace(/[A-Z]$/, "")));
  assert.deepEqual([...groups].sort(), [...missing].sort());
  for (const s of reconciliation.sightings) {
    assert.ok(["match", "retype", "missing", "not_rest_space", "deferred"].includes(s.decision), `${s.scene}: decision ${s.decision}`);
    if (s.decision !== "missing") assert.ok(!s.instanceId, `${s.scene} ${s.decision}: no instance id`);
  }
});

test("the whole-set audit reports a planted duplicate gazebo, and only that pair", async () => {
  const { auditDuplicates } = await import("../../stages/furniture.mjs");
  assert.deepEqual(auditDuplicates(furniture.objects), [], "the committed set has no duplicate pair");
  const gazebo = furniture.objects.find((o) => o.kind === "gazebo");
  const [x, z] = gazebo.footprint.reduce((a, p, _, r) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]);
  const planted = { id: "RS9999", kind: "gazebo", point: [x + 0.6242171526, z], p: {} };
  const pairs = auditDuplicates([...furniture.objects, planted]);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].id, pairs[0].other].sort(), [gazebo.id, "RS9999"].sort());
});

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
    assert.match(p.id, /^RS(\d{4}[A-Z]?|-GATE-[A-Z0-9]+|-LS-[A-Z0-9]+)$/, `${p.id}: id`);
    assert.equal(p.estimated, true, `${p.id}: estimated`);
    assert.ok(catalogue[p.kind] || B[p.kind], `${p.id}: kind ${p.kind} is neither a catalogue type nor a builder`);
    assert.match(p.vr_scene, /^scene_[a-z0-9_]+$/, `${p.id}: vr_scene`);
    assert.ok(["f", "r", "b", "l", "u", "d"].includes(p.vr_face), `${p.id}: vr_face`);
    assert.ok(Array.isArray(p.vr_cols) && p.vr_cols.length === 2, `${p.id}: vr_cols`);
    const support = p.photo_support ?? "none"; // the gate sign (todo 14) is VR-only and carries no photo_support
    assert.ok(["roof", "wall", "outline", "none"].includes(support), `${p.id}: photo_support ${p.photo_support}`);
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

// Landscape rows of the reconciliation decided missing (steps, ponds, paths, surfaces): each carries the verdict it was
// applied with, and every feature or surface supplement it names exists.
test("every landscape row decided missing is applied to a built feature, an existing node or an off-campus verdict", () => {
  const ground = JSON.parse(readFileSync(new URL("../osm-ground.json", import.meta.url), "utf8"));
  const ids = new Set(rest.features.map((f) => f.properties.id));
  const built = new Set(placed.map((o) => o.id));
  const missing = reconciliation.landscape.filter((l) => l.decision === "missing");
  assert.ok(missing.length > 0);
  for (const row of missing) {
    const applied = row.applied;
    assert.ok(applied, `${row.scene} ${row.note}: no applied verdict`);
    assert.ok(["built", "mapped", "not_on_campus"].includes(applied.verdict), `${row.scene}: verdict ${applied.verdict}`);
    assert.ok(applied.evidence?.length > 20, `${row.scene}: evidence`);
    for (const id of applied.features ?? []) {
      assert.ok(ids.has(id), `${row.scene}: ${id} is not in rest-spaces.geojson`);
      assert.ok(built.has(id), `${row.scene}: ${id} is not loaded by the furniture stage`);
    }
    for (const prefix of applied.supplements ?? []) assert.ok(ground.supplements.features.some((f) => f.note?.startsWith(prefix)), `${row.scene}: no osm-ground supplement "${prefix}"`);
    if (applied.verdict === "built") assert.ok((applied.features ?? []).length + (applied.supplements ?? []).length > 0, `${row.scene}: built names nothing`);
    if (applied.verdict !== "not_on_campus") assert.ok(applied.nodes?.length > 0, `${row.scene}: model nodes`);
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

// The failure this guards against: a small structure (hut, kiosk, booth) drawn both as a building and as a rest space,
// as the scene_f3 tennis hut was (BLD_SCNU_R138317, 46 m2). Large records are left out: their raw footprints can wrap
// courtyards and gardens their drawn forms keep open (the a5 walled garden inside the A1 OSM outline).
const SMALL_BUILDING_M2 = 200;
test("no roofed rest space stands inside a small building footprint (it would be drawn twice)", async () => {
  const { geoToModel } = await import("../../lib/frame.mjs");
  const { pointInRing } = await import("../../lib/geometry.mjs");
  const records = [
    ...JSON.parse(readFileSync(new URL("../gis-buildings.json", import.meta.url), "utf8")).buildings,
    ...JSON.parse(readFileSync(new URL("../vr-buildings.json", import.meta.url), "utf8")).buildings,
  ].filter((r) => r.status !== "demolished" && (r.areaMetres ?? 0) < SMALL_BUILDING_M2);
  // a polygon is [outer, ...holes]
  const toModel = (ring) => ring.map(([lon, lat]) => geoToModel(lon, lat));
  const shapes = records.flatMap((r) => (r.polygons ?? []).map((poly) => {
    const rings = Array.isArray(poly[0][0]) ? poly : [poly];
    return { id: r.nodeId ?? r.name, outer: toModel(rings[0]), holes: rings.slice(1).map(toModel) };
  }));
  const ROOFED = new Set(["pavilion_hip", "pavilion_octagon", "terminal_shelter", "canopy_shelter_row", "hut", "awning", "bus_stop_shelter", "pergola", "gazebo"]);
  const inside = [];
  for (const o of furniture.objects.filter((x) => ROOFED.has(x.kind) && (x.source === "rest-spaces" || x.surveyKind !== x.kind))) {
    const pts = o.footprint ?? o.ring ?? o.axis ?? o.line ?? [o.point];
    const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
    for (const { id, outer, holes } of shapes) if (pointInRing(c, outer) && !holes.some((h) => pointInRing(c, h))) inside.push(`${o.id} ${o.kind} in ${id}`);
  }
  assert.deepEqual(inside, []);
});

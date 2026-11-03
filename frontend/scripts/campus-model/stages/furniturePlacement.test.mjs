import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadFurniture, B, makeContext, buildFurniture } from "./furniture.mjs";
import { checkPoles } from "./lights.mjs";
import { GlbBuilder } from "../lib/glb.mjs";
import { resolveAnchor } from "../lib/anchors.mjs";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { metres } from "../lib/frame.mjs";

test("the furniture loader applies every free-standing record before downstream geometry", () => {
  const document = JSON.parse(readFileSync(new URL("../data/free-standing-anchors.json", import.meta.url), "utf8"));
  const parcels = Object.fromEntries(JSON.parse(readFileSync(new URL("../data/ground/parcels.json", import.meta.url), "utf8")).parcels.map(p => [p.id, p]));
  const furniture = loadFurniture();
  const objects = furniture.objects.filter(o => o.source !== "site-detail");
  assert.deepEqual(objects.map(o => o.id).sort(), document.records.map(r => r.id).sort());
  for (const o of objects) {
    assert.ok(o.anchor, `${o.id} has no applied anchor`);
    const record = document.records.find(r => r.id === o.id);
    assert.deepEqual(o.evidence, record.evidence);
    assert.equal(o.estimated, true);
    const shape = o.point ? [o.point] : o.footprint ?? o.ring ?? o.line;
    const centre = sceneToTm(...shape.reduce((s, p) => s.map((v, i) => v + p[i] / shape.length), [0, 0]));
    const expected = resolveAnchor(record, {}, parcels).origin;
    assert.ok(Math.hypot(...centre.map((v, i) => v - expected[i])) < 1e-6, o.id);
  }
});

test("plaza benches are two recorded four-member rows with catalogue geometry", () => {
  const rows = loadFurniture().objects.filter(o => o.source === "plaza-benches");
  assert.equal(rows.length, 2);
  const sites = { inArea: () => false, labelAt: () => null, classes: { PAVING: 1, ASPHALT: 2 } };
  const context = () => makeContext({ groundAt: () => 0, objects: [], roads: { arterials: [], connectors: [], zoneRings: [] }, sites, fieldCentre: null });
  for (const row of rows) {
    assert.equal(row.evidence.tier, "T4");
    assert.equal(row.p.count, 4);
    assert.equal(row.p.spacing_m, 7);
    const ctx = context();
    B.bench(ctx, row);
    const one = context();
    // A 4 m line with 7 m pitch contains one bench. Removing spacing invokes the legacy
    // round(length / 2.4) rule and would create two, so it is not a one-bench control.
    B.bench(one, { ...row, line: [[0, 0], [metres(4), 0]], p: { ...row.p, count: 1 } });
    assert.equal(ctx.solid.triangleCount, 4 * one.solid.triangleCount);
  }
});

test("a VR-discovered lamp keeps its separately reviewed photo root over a conflicting ray", () => {
  const source = JSON.parse(readFileSync(new URL("../data/photo/vr-lamps.geojson", import.meta.url), "utf8")).features[0];
  const lamp = loadFurniture().objects.find(o => o.id === source.properties.id);
  // vr-lamps.geojson explicitly records a visible by-eye shadow root, residual 0.25 m.
  assert.equal(lamp.evidence.tier, "T1");
  assert.equal(lamp.bearingChecks[0].photoResidualM, source.properties.residual_m);
  assert.equal(lamp.bearingChecks[0].decision, "retain_photo_base");
  assert.equal(lamp.bearingChecks[0].pass, false);
});

test("the real furniture build records the anchor at the post-checkPoles position", () => {
  const furniture = loadFurniture();
  const pole = furniture.objects.find(o => o.id === "OC0098");
  const before = [...pole.point];
  const constraints = { onCarriageway: ([x]) => x < before[0] + metres(4), inBuilding: () => false };
  const result = checkPoles([pole], constraints);
  assert.equal(result.moved.length, 1);
  assert.deepEqual(result.offenders, []);
  const glb = new GlbBuilder();
  buildFurniture({ glb, furniture: { ...furniture, objects: [pole] },
    lamps: [{ id: pole.id, type: "path", at: pole.point, dir: [1, 0], heightM: 4 }],
    lampStats: {}, inputs: { roadZones: [] }, groundAt: () => 0,
    sites: { inArea: () => false, labelAt: () => null, classes: { PAVING: 1, ASPHALT: 2 } } });
  const extras = glb.json.nodes.find(n => n.name === "Furniture").extras;
  const record = extras.placementEvidence.find(r => r.id === pole.id);
  const parcels = Object.fromEntries(JSON.parse(readFileSync(new URL("../data/ground/parcels.json", import.meta.url), "utf8")).parcels.map(p => [p.id, p]));
  const resolved = resolveAnchor(record, {}, parcels).origin;
  const final = sceneToTm(...pole.point);
  assert.ok(Math.hypot(...resolved.map((v, i) => v - final[i])) < 1e-6, `${resolved} != ${final}`);
  assert.deepEqual(record.pointScene, pole.point);
});

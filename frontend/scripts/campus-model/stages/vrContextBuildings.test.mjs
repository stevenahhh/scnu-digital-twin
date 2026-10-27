// Checks for data/vr-context-buildings.json (off-campus VR context buildings, see README "VR context buildings").
// VR_CONTEXT_FILE checks another file with the same rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = process.env.VR_CONTEXT_FILE ?? path.join(SCRIPT, "data", "vr-context-buildings.json");
const context = JSON.parse(readFileSync(FILE, "utf8"));
const gis = JSON.parse(readFileSync(path.join(SCRIPT, "data", "gis-buildings.json"), "utf8")).buildings;
const matches = (key) => gis.filter((r) => r.footprintSource === key || r.footprintSource.startsWith(`${key} `));
const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

test("every floors entry names exactly one footprint record that has no storey count of its own", () => {
  assert.ok(context.floors.length > 0);
  for (const entry of context.floors) {
    const hits = matches(entry.footprintSource);
    assert.equal(hits.length, 1, `${entry.footprintSource} matches ${hits.length} records`);
    assert.equal(hits[0].floors, 0, `${entry.footprintSource} already has floors in gis-buildings.json`);
    assert.doesNotMatch(hits[0].name ?? "", /순천대/, `${entry.footprintSource} is a campus record`);
  }
});

test("storeys, use class and sources are whole, estimated and VR-referenced", () => {
  for (const entry of [...context.floors, ...context.buildings]) {
    const at = entry.footprintSource;
    assert.ok(Number.isInteger(entry.floors) && entry.floors >= 1, `${at}: floors`);
    assert.match(entry.usability, /\(추정\)$/, `${at}: usability must end in (추정)`);
    assert.match(entry.floorsSource, /\(estimated\)/, `${at}: floorsSource must say (estimated)`);
    assert.ok(Array.isArray(entry.vrScenes) && entry.vrScenes.every((s) => /^scene_[a-z0-9]+$/.test(s)), `${at}: vrScenes`);
  }
  // An explicit height must say where it comes from and stay inside the 2.5-5 m storey band stages/buildings.mjs accepts.
  for (const entry of context.floors.filter((e) => e.heightMetres)) {
    assert.match(entry.heightNote ?? "", /\(estimated\)/, `${entry.footprintSource}: heightNote`);
    const storey = entry.heightMetres / entry.floors;
    assert.ok(storey >= 2.5 && storey <= 5, `${entry.footprintSource}: ${storey.toFixed(2)} m per storey`);
  }
});

test("traced buildings are off-campus, estimated, closed rings with a height from floors", () => {
  for (const b of context.buildings) {
    assert.doesNotMatch(b.name, /순천대/);
    assert.equal(b.estimated, true);
    assert.equal(b.heightMetres, 0);
    assert.match(b.footprintSource, /\(estimated\)/);
    assert.ok(!("areaMetres" in b), "areaMetres is computed by the loader");
    for (const ring of b.polygons.flat()) {
      assert.ok(ring.length >= 4 && ring.every(isPoint));
      assert.deepEqual(ring[0], ring.at(-1));
    }
  }
});

test("every look names exactly one footprint record and sets a known section and a #rrggbb tone", () => {
  const looks = [...(context.looks ?? []).map((e) => ({ at: e.footprintSource, ...e })), ...context.buildings.filter((b) => b.contextLook).map((b) => ({ at: b.footprintSource, ...b.contextLook }))];
  assert.ok(looks.length > 0);
  for (const look of looks) {
    if (context.looks?.some((e) => e.footprintSource === look.at)) assert.equal(matches(look.at).length, 1, `${look.at} matches ${matches(look.at).length} records`);
    assert.ok(["residential", "commercial"].includes(look.section), `${look.at}: section`);
    assert.match(look.tone, /^#[0-9a-f]{6}$/i, `${look.at}: tone`);
    assert.match(look.source, /\(estimated\)/, `${look.at}: source`);
  }
});

// node --test scripts/campus-model/fit/parcelsSeed.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { validate } from "../lib/schemas.mjs";
import { CURATION_FILE, PARCELS_FILE, applyParcelCuration, compareToLayers, parkingRowParcels, registrationRefs, seedParcels } from "./parcelsSeed.mjs";

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const layer = (over) => ({ cls: "PAVING", mesh: "Ground_Pavers", label: 2, precedence: 2, source: "OSM-derived", source_ref: "way/1", rings: [square(0, 0, 10)], ...over });

test("seedParcels keeps every ring, gives unique ids and maps sources to evidence tiers", () => {
  const parcels = seedParcels([
    layer({}),
    layer({ rings: [square(100, 0, 4), square(101, 1, 1)] }),
    layer({ cls: "PAVING", source: "NGII-A003", source_ref: "UFID_A", precedence: 5 }),
    layer({ cls: "ASPHALT", source: "road-zone-measured", source_ref: "road zone 3", precedence: 3, rings: [square(50, 0, 5)] }),
    layer({ cls: "LOT", source: "project-estimated", source_ref: "off-campus lot 1", precedence: 4, estimated: true, rings: [square(70, 0, 5)] }),
  ]);
  assert.equal(new Set(parcels.map((p) => p.id)).size, 5);
  assert.deepEqual(parcels.map((p) => p.evidence.tier), ["T4", "T4", "T0", "T0", "T4"]);
  assert.deepEqual(parcels[1].ring, square(100, 0, 4));
  assert.deepEqual(parcels[1].holes, [square(101, 1, 1)]);
  assert.deepEqual(parcels.map((p) => p.paintAllowed), [false, false, false, true, true]);
  // T4 (OSM geometry, project estimates) is always estimated (design §2)
  assert.deepEqual(parcels.map((p) => p.estimated), [true, true, false, false, true]);
  assert.ok(validate("parcels", { parcels }).ok);
});

test("seedParcels keeps the drawing props in render and gives the design class", () => {
  const [p, q] = seedParcels([
    layer({ walkway: true, surface: "blockPaver", source: "NGII-A003", source_ref: "UFID_A", precedence: 5 }),
    layer({ cls: "LOT", mesh: "Ground_Lot", source_ref: "way/9", precedence: 4, rings: [square(40, 0, 5)] }),
  ]);
  assert.deepEqual(p.render, { walkway: true, surface: "blockPaver" });
  assert.equal(p.class, "sidewalk");
  assert.equal(q.class, "lot");
  assert.equal(q.render, undefined);
});

test("registration corrections are recorded once in the parcel they moved, as T1", () => {
  const refs = registrationRefs(
    { corrections: [{ id: "GR_1", target: "facility", index: 22 }, { id: "GR_2", target: "facility", index: 22 }] },
    { corrections: [{ id: "REG001", ufid: "UFID_A" }] },
  );
  const parcels = seedParcels([
    layer({ cls: "SPORTS", source: "project-estimated", source_ref: "MCEE class-141 facility 22", estimated: true }),
    layer({ cls: "PAVING", source: "project-estimated", source_ref: "MCEE class-141 facility 22 rim", estimated: true, rings: [square(30, 0, 3)] }),
    layer({ source: "NGII-A003", source_ref: "UFID_A", precedence: 5, rings: [square(60, 0, 3)] }),
  ], refs);
  assert.equal(parcels[0].source_ref, "MCEE class-141 facility 22; registration GR_1, GR_2");
  assert.equal(parcels[0].evidence.tier, "T1");
  assert.equal(parcels[1].source_ref, "MCEE class-141 facility 22 rim");
  assert.equal(parcels[2].source_ref, "UFID_A; registration REG001");
  assert.equal(parcels.filter((p) => p.source_ref.includes("GR_1")).length, 1);
});

test("same-precedence overlaps are ordered with over, so a later parcel lists the one it covers", () => {
  const parcels = seedParcels([layer({}), layer({ source_ref: "way/2", rings: [square(5, 5, 10)] }), layer({ source_ref: "way/3", precedence: 3, rings: [square(5, 5, 10)] })]);
  assert.deepEqual(parcels[1].over, [parcels[0].id]);
  assert.equal(parcels[0].over, undefined);
  assert.equal(parcels[2].over, undefined);
  assert.ok(validate("parcels", { parcels }).ok);
});

test("validator names both ids of two overlapping parcels with the same precedence", () => {
  const parcels = seedParcels([layer({}), layer({ source_ref: "way/2", rings: [square(5, 5, 10)] })]);
  delete parcels[1].over;
  const { ok, errors } = validate("parcels", { parcels });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes(parcels[0].id) && e.includes(parcels[1].id) && /overlap/.test(e)), errors.join("\n"));
});

test("validator rejects repeated ids, bad tiers, bad rings and an over naming no parcel", () => {
  const [a] = seedParcels([layer({})]);
  const cases = [
    [{ parcels: [a, { ...a }] }, /repeats/],
    [{ parcels: [{ ...a, evidence: { tier: "T9", refs: [] } }] }, /tier/],
    [{ parcels: [{ ...a, ring: [[0, 0], [1, 1]] }] }, /ring/],
    [{ parcels: [{ ...a, over: ["PARCEL_NONE"] }] }, /over/],
    [{ parcels: [{ ...a, estimated: false }] }, /estimated/],
  ];
  for (const [doc, pattern] of cases) {
    const { ok, errors } = validate("parcels", doc);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => pattern.test(e)), `${pattern}: ${errors.join("; ")}`);
  }
});

test("compareToLayers names a parcel whose ring moved", () => {
  const parcels = seedParcels([layer({}), layer({ source_ref: "way/2", rings: [square(20, 0, 4)] })]);
  const layers = [layer({}), layer({ source_ref: "way/2", rings: [square(20, 0, 4.1)] })];
  assert.deepEqual(compareToLayers(parcels, [layer({}), layer({ source_ref: "way/2", rings: [square(20, 0, 4)] })]).errors, []);
  const { errors } = compareToLayers(parcels, layers);
  assert.equal(errors.length, 1);
  assert.match(errors[0], new RegExp(parcels[1].id));
});

test("data/ground/parcels.json is valid", () => {
  const { ok, errors } = validate("parcels", JSON.parse(readFileSync(PARCELS_FILE, "utf8")));
  assert.ok(ok, errors.slice(0, 10).join("\n"));
});

// The full ground pipeline runs under Bun (stages/sources.mjs reads uni.glb with Bun.file), so the no-op proof runs the
// CLI: parcels.json equals today's buildSurfaces layers, every ring within 0.1 m2 (W1 is a visual no-op).
const noBun = spawnSync("bun", ["--version"]).error ? "bun is not installed" : false;
test("data/ground/parcels.json equals today's ground layers ring for ring", { skip: noBun, timeout: 600_000 }, () => {
  const run = spawnSync("bun", [fileURLToPath(new URL("./parcelsSeed.mjs", import.meta.url)), "--check"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const line = run.stdout.split("\n").find((l) => l.startsWith("PARCELS CHECK")) ?? "";
  assert.equal(run.status, 0, `${line}\n${run.stderr.slice(-2000)}`);
  const check = JSON.parse(line.slice("PARCELS CHECK ".length));
  assert.equal(check.valid, true);
  assert.equal(check.layerDiffs, 0);
  assert.ok(check.worstAreaDiffM2 <= 0.1, line);
});

const emptyCuration = { note: "n", replace: [], remove: [], add: [], notAsphalt: [], unreachable: [] };

test("parcel curation replaces a ring in place, removes a parcel and adds new ones after the rest", () => {
  const seeded = seedParcels([layer({}), layer({ source_ref: "way/2", rings: [square(20, 0, 4)] }), layer({ cls: "ASPHALT", source: "road-zone-measured", source_ref: "road zone 3", precedence: 3, rings: [square(50, 0, 5)] })]);
  const curation = {
    ...emptyCuration,
    remove: [{ id: seeded[1].id, reason: "no path on the photo" }],
    replace: [{ id: seeded[2].id, ring: square(50, 0, 4), evidence: { tier: "T1", refs: ["photo kerb"] }, estimated: true, reason: "edge on the photo kerb" }],
    add: [{ id: "PARCEL_ROAD_NEW", class: "road", ring: square(70, 0, 5), evidence: { tier: "T1", refs: ["asphalt scan"] }, estimated: false, reason: "access road" }, { id: "PARCEL_LOT_NEW", class: "lot", ring: square(80, 0, 5), evidence: { tier: "T1", refs: ["asphalt scan"] }, estimated: true, reason: "lot apron" }],
  };
  const { kept, added } = applyParcelCuration(seeded, curation);
  assert.deepEqual(kept.map((p) => p.id), [seeded[0].id, seeded[2].id]);
  assert.deepEqual(kept[1].ring, square(50, 0, 4));
  assert.equal(kept[1].evidence.tier, "T1");
  assert.equal(kept[1].estimated, true);
  assert.equal(kept[1].curated, "todo 13a");
  assert.equal(kept[1].source, "road-zone-measured", "replacing a ring keeps where the parcel came from");
  assert.deepEqual(added.map((p) => [p.id, p.cls, p.class, p.mesh, p.precedence, p.paintAllowed, p.label]), [
    ["PARCEL_ROAD_NEW", "ASPHALT", "road", "Ground_Asphalt", 3, true, null],
    ["PARCEL_LOT_NEW", "LOT", "lot", "Ground_Lot", 4, true, null],
  ]);
  assert.equal(added[0].source, "photo-curated");
  assert.ok(validate("parcels", { parcels: [...kept, ...added] }).ok);
});

test("parcel curation naming a parcel the seed does not have fails by name", () => {
  const seeded = seedParcels([layer({})]);
  assert.throws(() => applyParcelCuration(seeded, { ...emptyCuration, remove: [{ id: "PARCEL_GONE", reason: "x" }] }), /PARCEL_GONE/);
  assert.throws(() => applyParcelCuration(seeded, { ...emptyCuration, replace: [{ id: "PARCEL_GONE2", ring: square(0, 0, 1), evidence: { tier: "T1", refs: [] }, estimated: false, reason: "x" }] }), /PARCEL_GONE2/);
  assert.throws(() => applyParcelCuration(seeded, { ...emptyCuration, add: [{ id: seeded[0].id, class: "road", ring: square(0, 0, 1), evidence: { tier: "T1", refs: [] }, estimated: false, reason: "x" }] }), new RegExp(seeded[0].id));
});

test("validator rejects malformed parcel curation records, each by id", () => {
  const good = { id: "PARCEL_ROAD_NEW", class: "road", ring: square(0, 0, 5), evidence: { tier: "T1", refs: ["r"] }, estimated: false, reason: "why" };
  const cases = [
    [null, /parcelCuration/],
    [{ ...emptyCuration, add: "x" }, /add must be an array/],
    [{ ...emptyCuration, add: [{ ...good, id: "road" }] }, /PARCEL_/],
    [{ ...emptyCuration, add: [{ ...good, class: "lawn" }] }, /PARCEL_ROAD_NEW: class/],
    [{ ...emptyCuration, add: [{ ...good, ring: [[0, 0]] }] }, /PARCEL_ROAD_NEW: ring/],
    [{ ...emptyCuration, add: [{ ...good, reason: "" }] }, /PARCEL_ROAD_NEW: reason/],
    [{ ...emptyCuration, add: [{ ...good, evidence: { tier: "T9", refs: [] } }] }, /PARCEL_ROAD_NEW: evidence/],
    [{ ...emptyCuration, add: [{ ...good, evidence: { tier: "T4", refs: [] } }] }, /PARCEL_ROAD_NEW: estimated/],
    [{ ...emptyCuration, remove: [{ id: "PARCEL_X" }] }, /PARCEL_X: reason/],
    [{ ...emptyCuration, notAsphalt: [{ id: "ROOF", ring: square(0, 0, 1) }] }, /ROOF: reason/],
    [{ ...emptyCuration, unreachable: [{ row: "LOT/R1" }] }, /LOT\/R1: reason/],
  ];
  for (const [doc, pattern] of cases) {
    const { ok, errors } = validate("parcelCuration", doc);
    assert.equal(ok, false, String(pattern));
    assert.ok(errors.some((e) => pattern.test(e)), `${pattern}: ${errors.join("; ")}`);
  }
  assert.ok(validate("parcelCuration", { ...emptyCuration, add: [good] }).ok);
});

test("data/ground/parcel-curation.json is valid and every record it names is in parcels.json as curated", () => {
  const curation = JSON.parse(readFileSync(CURATION_FILE, "utf8"));
  const { ok, errors } = validate("parcelCuration", curation);
  assert.ok(ok, errors.join("\n"));
  const parcels = new Map(JSON.parse(readFileSync(PARCELS_FILE, "utf8")).parcels.map((p) => [p.id, p]));
  for (const { id } of curation.remove) assert.equal(parcels.has(id), false, `${id} is removed by the curation but still in parcels.json`);
  for (const { id, ring } of [...curation.replace, ...curation.add]) assert.deepEqual(parcels.get(id)?.ring, ring, `${id}: parcels.json differs from the curation; run parcelsSeed --write`);
});

test("a parking row off road and lot ground gets its footprint as a lot parcel; a row on a lot gets none", () => {
  const lotParcel = { id: "PARCEL_LOT_A", cls: "LOT", class: "lot", ring: square(0, 0, 20), holes: [], precedence: 4, paintAllowed: true };
  const row = (id, E) => ({ id, backLine: { abs: [[E, 10], [E + 5, 10]] }, side: -1, depthM: 5, evidence: { tier: "T1", refs: [] }, estimated: false });
  const parking = { lots: [{ id: "LOT_A", rows: [row("LOT_A/R1", 5), row("LOT_A/R2", 100)] }] };
  const divider = (id, E) => ({ id, kind: "parking_line", rings: [[[E, 10], [E + 0.1, 10], [E + 0.1, 5], [E, 5]]] });
  const out = parkingRowParcels(parking, [divider("LOT_A/R1/D0", 5), divider("LOT_A/R2/D0", 100)], [lotParcel], (p) => p);
  assert.deepEqual(out.map((p) => p.id), ["PARCEL_LOT_A_R2"]);
  assert.deepEqual(out[0].evidence.refs, ["LOT_A/R2"]);
  assert.deepEqual(out[0].ring, [[99.7, 10.3], [105.3, 10.3], [105.3, 4.7], [99.7, 4.7]]);
  assert.equal(out[0].paintAllowed, true);
  assert.equal(out[0].label, null);
});

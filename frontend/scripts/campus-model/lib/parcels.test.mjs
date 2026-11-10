// node --test scripts/campus-model/lib/parcels.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { assertPaintOnParcels, designClass, paintViolations, parcelOutlines, parcelLayers, pieceKey, supportParcels } from "./parcels.mjs";

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const parcel = (over) => ({
  id: "PARCEL_ASPHALT_A", cls: "ASPHALT", class: "road", ring: square(0, 0, 10), holes: [], precedence: 3, mesh: "Ground_Asphalt", label: 2,
  source: "road-zone-measured", source_ref: "road zone 0", evidence: { tier: "T0", refs: ["road zone 0"] }, paintAllowed: true, estimated: false, ...over,
});
// pieces in EPSG:5186 here (toTm = identity), as the stage passes them after sceneToTm
const stripe = (x, y, over = {}) => ({ kind: "parking_line", id: "MX1", rings: [[[x, y], [x + 0.1, y], [x + 0.1, y + 5], [x, y + 5]]], ...over });
const same = (p) => p;

test("designClass maps the seeded layer classes to the design §5 vocabulary", () => {
  assert.equal(designClass({ cls: "ASPHALT", mesh: "Ground_Asphalt" }), "road");
  assert.equal(designClass({ cls: "LOT", mesh: "Ground_Lot" }), "lot");
  assert.equal(designClass({ cls: "PAVING", mesh: "Ground_Pavers", render: { walkway: true } }), "sidewalk");
  assert.equal(designClass({ cls: "PAVING", mesh: "Ground_Walkway" }), "sidewalk");
  assert.equal(designClass({ cls: "PAVING", mesh: "Ground_Pavers" }), "plaza");
  assert.equal(designClass({ cls: "PAVING", mesh: "Ground_Apron" }), "plaza");
  assert.equal(designClass({ cls: "BICYCLE", mesh: "Ground_Bicycle" }), "sidewalk");
  assert.equal(designClass({ cls: "ASPHALT", mesh: "Ground_Bicycle" }), "road");
  assert.equal(designClass({ cls: "SPORTS", mesh: "Ground_Sports", render: { paint: { kind: "track" } } }), "track");
  assert.equal(designClass({ cls: "SPORTS", mesh: "Ground_Sports", render: { paint: { kind: "water" } } }), "water");
  assert.equal(designClass({ cls: "SPORTS", mesh: "Ground_Sports", render: { paint: { kind: "pitch" } } }), "court");
  assert.equal(designClass({ cls: "LOT", mesh: "Ground_Sports", render: { paint: { kind: "roundabout" } } }), "road");
  assert.equal(designClass({ cls: "LOT", mesh: "Ground_Sports", render: { paint: { kind: "island" } } }), "lawn");
  assert.equal(designClass({ cls: "LOT", mesh: "Ground_Apron" }), "plaza");
  assert.equal(designClass({ cls: "ASPHALT", mesh: "Ground_Asphalt", render: { walkway: true } }), "sidewalk");
  assert.throws(() => designClass({ id: "PARCEL_X", cls: "GRASS" }), /PARCEL_X/);
});

test("parcelOutlines: walkway parcel rings become closed kerb lines, kerbLines stay open", () => {
  const walk = parcel({ id: "PARCEL_PAVING_U1", cls: "PAVING", source_ref: "U1; registration REG001", holes: [square(2, 2, 1)], render: { walkway: true, surface: "blockPaver" } });
  const out = parcelOutlines([parcel({}), walk], [{ ufid: "U2", surface: "existing", line: [[0, 0], [5, 0]] }]);
  assert.deepEqual(out.map((o) => [o.ufid, o.closed, o.line.length]), [["U1", true, 5], ["U1", true, 5], ["U2", false, 2]]);
  assert.deepEqual(out[0].line.at(-1), out[0].line[0]);
});

test("parcelLayers rebuilds the stage layers: rings = [ring, ...holes], render props restored", () => {
  const p = parcel({ holes: [square(2, 2, 1)], render: { walkway: true, surface: "blockPaver" } });
  const [layer] = parcelLayers([p]);
  assert.deepEqual(layer.rings, [p.ring, p.holes[0]]);
  assert.equal(layer.walkway, true);
  assert.equal(layer.surface, "blockPaver");
  assert.equal(layer.parcel, "PARCEL_ASPHALT_A");
  assert.equal(layer.precedence, 3);
  assert.equal(layer.source_ref, "road zone 0");
});

test("paint on a paintAllowed:false parcel or on no parcel is named by piece id", () => {
  const parcels = [parcel({}), parcel({ id: "PARCEL_LAWN_X", cls: "PAVING", class: "lawn", ring: square(20, 0, 10), paintAllowed: false, precedence: 2 })];
  const ok = paintViolations([stripe(2, 2)], parcels, same);
  assert.deepEqual(ok, []);
  const bad = paintViolations([stripe(22, 2, { id: "MX_LAWN" }), stripe(50, 50, { id: undefined })], parcels, same);
  assert.equal(bad.length, 2);
  assert.equal(bad[0].piece, pieceKey(stripe(22, 2, { id: "MX_LAWN" }), same));
  assert.match(bad[0].piece, /^MX_LAWN@/);
  assert.equal(bad[0].parcel, "PARCEL_LAWN_X");
  assert.equal(bad[1].parcel, null);
  assert.match(bad[1].piece, /^parking_line@50\.05,52\.5/);
});

test("a curved band is checked on its painted area, not its vertex mean in the island", () => {
  const band = [[0, 0], [10, 0], [10, 10], [9, 10], [9, 1], [0, 1]];
  const road = parcel({ ring: band });
  const piece = { id: "CURVED_KERB", kind: "kerb_no_parking", rings: [band] };
  assert.deepEqual(paintViolations([piece], [road], same), []);
});

test("a stall line on a lawn parcel makes the build invariant throw with the piece id; an excluded key passes", () => {
  const parcels = [parcel({ id: "PARCEL_LAWN_F", cls: "PAVING", class: "lawn", paintAllowed: false, estimated: true, evidence: { tier: "T4", refs: ["x"] } })];
  const piece = stripe(2, 2, { id: "MX_STALL_ON_LAWN" });
  assert.throws(() => assertPaintOnParcels([piece], parcels, same), /MX_STALL_ON_LAWN@.* on PARCEL_LAWN_F \(lawn\)/);
  assert.deepEqual(assertPaintOnParcels([piece], parcels, same, [pieceKey(piece, same)]), { checked: 1, excluded: 1 });
});

test("the topmost parcel at the piece decides: a higher-precedence plaza over a road blocks paint", () => {
  const parcels = [parcel({}), parcel({ id: "PARCEL_PLAZA", cls: "PAVING", class: "plaza", ring: square(0, 0, 5), precedence: 6, paintAllowed: false })];
  assert.equal(paintViolations([stripe(2, -2)], parcels, same)[0]?.parcel, "PARCEL_PLAZA");
  assert.deepEqual(paintViolations([stripe(7, 2)], parcels, same), []);
});

test("supportParcels covers paint on natural ground with a lot/road parcel and rejects paint on surveyed paving", () => {
  const parcels = [
    parcel({}),
    parcel({ id: "PARCEL_PAVING_A003", cls: "PAVING", class: "sidewalk", ring: square(100, 0, 10), precedence: 5, paintAllowed: false, source: "NGII-A003", evidence: { tier: "T0", refs: ["UFID"] } }),
    parcel({ id: "PARCEL_PAVING_APRON", cls: "PAVING", class: "plaza", ring: square(200, 0, 10), precedence: 6, paintAllowed: false, source: "project-estimated", evidence: { tier: "T4", refs: ["b"] }, estimated: true }),
  ];
  const row = [0, 2.5, 5, 7.5].map((dx, i) => stripe(50 + dx, 0, { id: `MX_ROW_${i}` }));
  const pieces = [...row, stripe(102, 2, { id: "MX_ON_A003" }), stripe(202, 2, { id: "MX_ON_APRON", kind: "text" }), stripe(300, 0, { id: "EST_ON_GRASS", estimated: true })];
  const { parcels: added, rejected } = supportParcels(pieces, parcels, same);
  // surveyed paving and estimated paint are never covered by a support
  assert.deepEqual(rejected.map((r) => r.piece.split("@")[0]), ["MX_ON_A003", "EST_ON_GRASS"]);
  assert.equal(rejected[0].parcel, "PARCEL_PAVING_A003");
  assert.equal(added.length, 2);
  const [lot, road] = added;
  assert.equal(lot.class, "lot");
  assert.equal(lot.precedence, 4);
  assert.equal(lot.evidence.tier, "T1");
  assert.equal(lot.estimated, true);
  assert.equal(lot.paintAllowed, true);
  assert.equal(lot.label, null, "supports leave the label raster unchanged");
  assert.equal(road.class, "road");
  assert.ok(road.precedence > 6, "a support over an estimated apron outranks it");
  const all = [...parcels, ...added];
  assert.deepEqual(paintViolations(pieces.filter((p) => !/MX_ON_A003|EST_/.test(p.id)), all, same), []);
  // ids are stable: the same input gives the same ids
  assert.deepEqual(supportParcels(pieces, parcels, same).parcels.map((p) => p.id), added.map((p) => p.id));
});

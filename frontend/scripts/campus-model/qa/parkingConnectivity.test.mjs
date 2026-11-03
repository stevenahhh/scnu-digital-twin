// node --test scripts/campus-model/qa/parkingConnectivity.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { connectivity, standingMasses } from "./parkingConnectivity.mjs";

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const parcel = (id, cls, ring, over = {}) => ({ id, class: cls, ring, holes: [], precedence: 3, source: "photo-curated", paintAllowed: cls === "road" || cls === "lot", ...over });
const zone = (id, ring) => parcel(id, "road", ring, { source: "road-zone-measured" });
// A row of depth 5 m running east from (E, N), stalls toward the south, on its own lot parcel.
const row = (id, E, N, length = 10) => ({ id, backLine: { abs: [[E, N], [E + length, N]] }, side: -1, depthM: 5, pitchM: 2.5, count: 5, startOffsetM: 0, divider: { style: "single", widthM: 0.1, colour: "white" }, stalls: [], wheelStops: null, evidence: { tier: "T1", refs: [] }, estimated: false });
const rowParcel = (id, E, N, length = 10) => parcel(`PARCEL_${id}`, "lot", rect(E - 0.3, N - 5.3, E + length + 0.3, N + 0.3), { precedence: 4, source: "parking-record" });
const doc = (...rows) => ({ lots: [{ id: "LOT_A", rows }] });

const ROAD = zone("ZONE", rect(0, 0, 100, 10));
const LINK = parcel("PARCEL_LINK", "road", rect(40, 10, 50, 40));
const ROW_PARCEL = rowParcel("R1", 50, 35);

test("a row reaches the road through an asphalt parcel", () => {
  const { rows, stranded } = connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD, LINK, ROW_PARCEL]);
  assert.deepEqual(rows.map((r) => [r.id, r.connected]), [["LOT_A/R1", true]]);
  assert.deepEqual(stranded, []);
});

test("deleting the link names every row it stranded", () => {
  const parking = doc(row("LOT_A/R1", 50, 35), row("LOT_A/R2", 2, 20));
  const parcels = [ROAD, LINK, ROW_PARCEL, rowParcel("R2", 2, 20), parcel("PARCEL_SHORT", "lot", rect(5, 10, 8, 15))];
  assert.deepEqual(connectivity(parking, parcels).stranded.map((s) => s.id), []);
  assert.deepEqual(connectivity(parking, parcels, { without: ["PARCEL_LINK"] }).stranded.map((s) => s.id), ["LOT_A/R1"]);
  assert.deepEqual(connectivity(parking, parcels, { without: ["PARCEL_LINK", "PARCEL_SHORT"] }).stranded.map((s) => s.id), ["LOT_A/R1", "LOT_A/R2"]);
});

test("a row reached only over a concrete yard connects and says so; the rest say asphalt", () => {
  const yard = parcel("PARCEL_YARD", "lot", rect(40, 10, 50, 40), { surface: "concrete" });
  const out = connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD, yard, ROW_PARCEL]);
  assert.deepEqual(out.rows.map((r) => [r.id, r.connected, r.via]), [["LOT_A/R1", true, "concrete"]]);
  assert.deepEqual(out.overConcrete, ["LOT_A/R1"]);
  const asphalt = connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD, LINK, ROW_PARCEL]);
  assert.equal(asphalt.rows[0].via, "asphalt");
  assert.deepEqual(asphalt.overConcrete, []);
  assert.deepEqual(connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD, yard, ROW_PARCEL], { without: ["PARCEL_YARD"] }).stranded.map((s) => s.id), ["LOT_A/R1"]);
});

test("a row standing on concrete beside the asphalt way still says asphalt", () => {
  const onYard = parcel("PARCEL_YARD", "lot", rect(50, 28, 62, 37), { surface: "concrete" });
  const out = connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD, LINK, onYard]);
  assert.equal(out.rows[0].via, "asphalt");
});

test("a road parcel of unknown source is a link and not a road: a row on it alone is stranded", () => {
  const island = parcel("PARCEL_SUPPORT_ROAD", "road", rect(40, 30, 70, 40), { source: "photo-paint-support" });
  const { stranded } = connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD, island, ROW_PARCEL]);
  assert.deepEqual(stranded.map((s) => s.id), ["LOT_A/R1"]);
});

test("a gap of natural ground or a passage narrower than a car does not connect", () => {
  const gapped = parcel("PARCEL_GAP", "road", rect(40, 13, 50, 40));
  assert.deepEqual(connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD, gapped, ROW_PARCEL]).stranded.map((s) => s.id), ["LOT_A/R1"]);
  const hairline = parcel("PARCEL_HAIR", "road", rect(44, 10, 45, 40));
  const widened = parcel("PARCEL_HEAD", "road", rect(40, 30, 50, 40));
  assert.deepEqual(connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD, hairline, widened, ROW_PARCEL]).stranded.map((s) => s.id), ["LOT_A/R1"]);
});

test("a sidewalk laid over the link, or a building on it, cuts the connection", () => {
  const walk = parcel("PARCEL_WALK", "sidewalk", rect(30, 20, 60, 25), { precedence: 5 });
  assert.deepEqual(connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD, LINK, ROW_PARCEL, walk]).stranded.map((s) => s.id), ["LOT_A/R1"]);
  const blocked = [[rect(30, 20, 60, 25)]];
  assert.deepEqual(connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD, LINK, ROW_PARCEL], { blocked }).stranded.map((s) => s.id), ["LOT_A/R1"]);
});

test("a stranded row keeps its written reason; a reason for a row that connects or does not exist is reported", () => {
  const parking = doc(row("LOT_A/R1", 50, 35));
  const reasons = [{ row: "LOT_A/R1", reason: "no road on the photo" }, { row: "LOT_A/GONE", reason: "x" }];
  const out = connectivity(parking, [ROAD, ROW_PARCEL], { reasons });
  assert.deepEqual(out.stranded, [{ id: "LOT_A/R1", reason: "no road on the photo" }]);
  assert.deepEqual(out.unexplained, []);
  assert.deepEqual(out.staleReasons, ["LOT_A/GONE"]);
  assert.deepEqual(connectivity(parking, [ROAD, ROW_PARCEL]).unexplained, ["LOT_A/R1"]);
  assert.deepEqual(connectivity(parking, [ROAD, LINK, ROW_PARCEL], { reasons: [{ row: "LOT_A/R1", reason: "old" }] }).staleReasons, ["LOT_A/R1"]);
});

test("a mass on legs does not block the lane under it; one standing on the ground does", () => {
  const ring = rect(0, 0, 1, 1);
  const forms = { buildings: [{ masses: [{ outer: ring, baseMetres: 0 }, { outer: rect(5, 5, 6, 6), baseMetres: 3.64 }] }] };
  assert.deepEqual(standingMasses(forms, (E, N) => [E, N]), [[ring]]);
});

test("--without naming no parcel, and a row with no resolvable back line, are errors", () => {
  assert.throws(() => connectivity(doc(row("LOT_A/R1", 50, 35)), [ROAD], { without: ["PARCEL_TYPO"] }), /PARCEL_TYPO/);
  const anchored = { ...row("LOT_A/R1", 50, 35), backLine: { anchor: { building: "BLD_X" } } };
  assert.deepEqual(connectivity(doc(anchored), [ROAD]).unexplained, ["LOT_A/R1"]);
});

test("the committed parking rows all reach a road or carry a written reason", () => {
  const data = (name) => JSON.parse(readFileSync(new URL(`../data/ground/${name}`, import.meta.url), "utf8"));
  const forms = JSON.parse(readFileSync(new URL("../data/building-forms.json", import.meta.url), "utf8"));
  const { unexplained, staleReasons } = connectivity(data("parking.json"), data("parcels.json").parcels, { blocked: standingMasses(forms, wgs84ToTm), reasons: data("parcel-curation.json").unreachable });
  assert.deepEqual(unexplained, []);
  assert.deepEqual(staleReasons, []);
});

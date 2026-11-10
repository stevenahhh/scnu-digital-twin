import assert from "node:assert/strict";
import test from "node:test";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { resolveAnchor } from "../lib/anchors.mjs";
import { positionObject, anchorObject, resolveObject } from "./objectPlacement.mjs";

const origin = [243800, 263700];
const parcel = { ring: [[243780, 263680], [243840, 263680], [243840, 263740], [243780, 263740]] };
const parcels = { PLAZA: parcel };
const seed = { id: "BENCH", point: [243810, 263720], parcel: "PLAZA" };
function observation(scene, offset, bearing) {
  const [x, z] = tmToScene(origin[0] + offset[0], origin[1] + offset[1]);
  return { station: { scene, frame_version: 2, station_refined_x: x, station_refined_z: z, yaw_refined_deg: bearing },
    reading: { face: "f", col: 1024 } };
}

test("visible ground base wins over survey and conflicting VR positions", () => {
  const result = positionObject({ ...seed, photo: { point: origin, base: true, occluded: false, ref: "sheet 34702020 base pick", residualM: 0.25 },
    observations: [observation("a", [0, -10], 45), observation("b", [20, -10], 315)] }, parcels);
  assert.equal(result.evidence.tier, "T1");
  assert.equal(result.estimated, true);
  assert.ok(Math.hypot(...resolveAnchor(result, {}, parcels).origin.map((v, i) => v - origin[i])) < 1e-6);
});

test("a conflicting single bearing is recorded without moving a photo base", () => {
  const result = positionObject({ ...seed,
    photo: { point: origin, base: true, occluded: false, ref: "independent base pick", residualM: 0.25 },
    observations: [observation("a", [0, -10], 45)] }, parcels);
  assert.deepEqual(resolveAnchor(result, {}, parcels).origin, origin);
  assert.equal(result.evidence.tier, "T1");
  assert.equal(result.bearingChecks[0].observedDeg, 45);
  assert.ok(Math.abs(result.bearingChecks[0].residualDeg + 45) < 1e-8);
  assert.equal(result.bearingChecks[0].pass, false);
  assert.equal(result.bearingChecks[0].photoResidualM, 0.25);
  assert.equal(result.bearingChecks[0].photoToleranceM, 0.5);
  assert.equal(result.bearingChecks[0].estimated, true);
});

test("two refined stations with a wide crossing recover the free point", () => {
  const result = positionObject({ ...seed, observations: [observation("a", [-10, -10], 45), observation("b", [10, -10], 315)] }, parcels);
  assert.equal(result.evidence.tier, "T2");
  assert.ok(Math.hypot(...resolveAnchor(result, {}, parcels).origin.map((v, i) => v - origin[i])) < 0.3);
  assert.ok(Math.abs(result.crossingDeg - 90) < 1e-9);
});

test("one station keeps the survey position as an estimated parcel anchor", () => {
  const result = positionObject({ ...seed, observations: [observation("a", [-10, -10], 45)] }, parcels);
  assert.equal(result.evidence.tier, "T4");
  assert.equal(result.estimated, true);
  assert.equal(result.reason, "one_station");
  assert.deepEqual(resolveAnchor(result, {}, parcels).origin, seed.point);
});

test("a shallow intersection cannot claim T2 even when its rays intersect", () => {
  const result = positionObject({ ...seed, observations: [observation("a", [0, -10], 0), observation("b", [-1, -10], 5.7105931375)] }, parcels);
  assert.equal(result.evidence.tier, "T4");
  assert.equal(result.reason, "crossing_below_20_deg");
  assert.ok(Math.abs(result.crossingDeg - 5.7105931375) < 1e-8);
  assert.deepEqual(resolveAnchor(result, {}, parcels).origin, seed.point);
});

test("a hidden base or a roof point cannot claim photo ground evidence", () => {
  for (const photo of [{ point: origin, base: true, occluded: true }, { point: origin, base: false, occluded: false }]) {
    const result = positionObject({ ...seed, photo: { ...photo, ref: "photo pick", residualM: 0.25 } }, parcels);
    assert.equal(result.evidence.tier, "T4");
    assert.deepEqual(resolveAnchor(result, {}, parcels).origin, seed.point);
  }
});

test("parcel translation moves the anchored object by the same metres", () => {
  const result = positionObject(seed, parcels);
  const moved = { PLAZA: { ring: parcel.ring.map(([e, n]) => [e + 7, n - 3]) } };
  assert.deepEqual(resolveAnchor(result, {}, moved).origin, [seed.point[0] + 7, seed.point[1] - 3]);
});

test("malformed coordinates, missing parcels and stale stations fail with record identity", () => {
  assert.throws(() => positionObject({ ...seed, point: [NaN, 0] }, parcels), /BENCH.*finite/);
  assert.throws(() => positionObject({ ...seed, parcel: "MISSING" }, parcels), /BENCH.*MISSING/);
  const stale = observation("old", [0, -10], 0);
  stale.station.frame_version = 1;
  assert.throws(() => positionObject({ ...seed, observations: [stale] }, parcels), /BENCH.*stale/);
});

test("saved local geometry moves with its parcel while preserving the catalogue input", () => {
  const point = tmToScene(...seed.point);
  const edge = tmToScene(seed.point[0] + 4, seed.point[1]);
  const object = { id: seed.id, kind: "bench", point, line: [point, edge], p: { length_m: 4 } };
  const record = anchorObject(object, positionObject(seed, parcels), parcels);
  const moved = { PLAZA: { ring: parcel.ring.map(([e, n]) => [e + 7, n - 3]) } };
  const result = resolveObject(object, record, moved);
  assert.deepEqual(result.p, { length_m: 4 });
  const expected = tmToScene(seed.point[0] + 7, seed.point[1] - 3);
  assert.ok(Math.hypot(...result.point.map((v, i) => v - expected[i])) < 1e-8);
  assert.ok(Math.abs(Math.hypot(...result.line[1].map((v, i) => v - result.line[0][i])) -
    Math.hypot(...edge.map((v, i) => v - point[i]))) < 1e-8);
  assert.deepEqual(object.point, point);
});

test("changed source geometry is rejected rather than silently overwritten by an old anchor", () => {
  const object = { id: seed.id, kind: "bench", point: tmToScene(...seed.point), p: {} };
  const record = anchorObject(object, positionObject(seed, parcels), parcels);
  const changed = { ...object, point: [object.point[0] + 1, object.point[1]] };
  assert.throws(() => resolveObject(changed, record, parcels), /BENCH.*stale/);
});

test("source input changes invalidate the anchor even when projected geometry is unchanged", () => {
  const object = { id: seed.id, kind: "bench", point: tmToScene(...seed.point), sourceInput: "survey-v1", p: {} };
  const record = anchorObject(object, positionObject(seed, parcels), parcels);
  assert.throws(() => resolveObject({ ...object, sourceInput: "survey-v2" }, record, parcels), /BENCH.*stale/);
});

test("malformed station evidence reports the object instead of a TypeError", () => {
  assert.throws(() => positionObject({ ...seed, observations: [{ station: null, reading: { face: "f", col: 1024 } }] }, parcels),
    /BENCH.*station/);
});

test("an anchor record cannot omit geometry or replace its evidence tier", () => {
  const object = { id: seed.id, kind: "bench", point: tmToScene(...seed.point), p: {} };
  const record = anchorObject(object, positionObject(seed, parcels), parcels);
  assert.throws(() => resolveObject(object, { ...record, geometry: {} }, parcels), /BENCH.*geometry/);
  assert.throws(() => resolveObject(object, { ...record, evidence: { tier: "PASS", refs: [] } }, parcels), /BENCH.*evidence/);
});

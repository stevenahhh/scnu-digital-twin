import assert from "node:assert/strict";
import test from "node:test";
import { wallsOf } from "./anchors.mjs";
import { anchorSiteDetail, resolveSiteDetail, seedSiteDetails } from "./siteDetailAnchors.mjs";

const polygon = [[[100, 100], [100, 110], [120, 110], [120, 100]]];
const footprint = { polygons: [polygon] };
footprint.walls = wallsOf("BLD_TEST", footprint);
const context = {
  footprints: { BLD_TEST: footprint },
  parcels: { PARCEL_TEST: { ring: polygon[0] } },
};
const snapshots = { BLD_TEST: wallsOf("BLD_TEST", footprint) };
const record = (anchor = { building: "BLD_TEST", wall: "W01", s0M: 2, s1M: 8, tM: 0.2 }) => ({
  id: "SD-TEST", anchor, estimated: true, evidence: { tier: "T4", refs: ["fixture"] },
  geometry: { type: "LineString", coordinates: [[0, 0], [6, 0]] },
});

test("wall-local geometry resolves in TM and supplied snapshots reject a shifted footprint", () => {
  assert.deepEqual(resolveSiteDetail(record(), context, snapshots).coordinates, [[102, 110.2], [108, 110.2]]);
  const changed = structuredClone(context);
  changed.footprints.BLD_TEST.polygons[0][0][0][0] += 1;
  assert.throws(() => resolveSiteDetail(record(), changed, snapshots), /SD-TEST.*stale wall/);
});

test("wall point, span and shape vertices stay inside the finite wall without clamping", () => {
  for (const a of [{ sM: -0.01 }, { sM: 20.01 }, { s0M: -1, s1M: 4 }, { s0M: 1, s1M: 21 }]) {
    assert.throws(() => resolveSiteDetail(record({ building: "BLD_TEST", wall: "W01", ...a }), context),
      /SD-TEST.*BLD_TEST\/W01.*offset outside \[0, 20\] wall interval/);
  }
  assert.throws(() => resolveSiteDetail({
    ...record(), geometry: { type: "LineString", coordinates: [[0, 0], [19, 0]] },
  }, context), /SD-TEST.*outside wall/);
});

test("unknown wall and incomplete supplied snapshot tables fail with the object id", () => {
  assert.throws(() => resolveSiteDetail(record({ building: "BLD_TEST", wall: "W99", sM: 1 }), context),
    /SD-TEST.*W99/);
  assert.throws(() => resolveSiteDetail(record(), context, {}), /SD-TEST.*saved wall/);
});

test("parcel-local polygon retains holes and moves with its parcel rather than its source geometry", () => {
  const geometry = { type: "Polygon", coordinates: [
    [[101, 101], [105, 101], [105, 106], [101, 101]],
    [[102, 102], [103, 102], [103, 103], [102, 102]],
  ] };
  const before = structuredClone(geometry);
  const anchored = anchorSiteDetail({ id: "SD-TEST", geometry },
    { parcel: "PARCEL_TEST", uM: -8, vM: -3 }, context);
  const moved = structuredClone(context);
  moved.parcels.PARCEL_TEST.ring = polygon[0].map(([e, n]) => [e + 5, n - 2]);
  const actual = resolveSiteDetail(anchored, moved);
  actual.coordinates.forEach((ring, i) => ring.forEach(([e, n], j) => {
    assert.ok(Math.abs(e - geometry.coordinates[i][j][0] - 5) < 1e-8);
    assert.ok(Math.abs(n - geometry.coordinates[i][j][1] + 2) < 1e-8);
  }));
  assert.deepEqual(geometry, before);
  assert.equal(anchored.estimated, true);
});

test("malformed coordinates and unsupported geometry fail with the record id", () => {
  for (const geometry of [
    { type: "Point", coordinates: [NaN, 0] },
    { type: "LineString", coordinates: [[0, 0]] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 0]]] },
    { type: "MultiPoint", coordinates: [[0, 0]] },
  ]) assert.throws(() => resolveSiteDetail({ ...record(), geometry }, context), /SD-TEST.*geometry/);
});

test("seed continues past an unresolved item and records its coordinates instead of losing later items", () => {
  const features = [
    { id: "NO-PARCEL", kind: "hedge", geometry: { type: "Point", coordinates: [90, 90] } },
    { id: "GOOD", kind: "planter", geometry: { type: "Point", coordinates: [105, 105] } },
  ];
  const result = seedSiteDetails(features, context);
  assert.deepEqual(result.records.map(r => r.id), ["GOOD"]);
  assert.deepEqual(result.unresolved.map(r => r.id), ["NO-PARCEL"]);
  assert.deepEqual(result.unresolved[0].centreTM, [90, 90]);
  assert.ok(result.unresolved[0].nearestParcelDistanceM > 14 && result.unresolved[0].nearestParcelDistanceM < 15);
  assert.deepEqual(resolveSiteDetail(result.records[0], context), features[1].geometry);
});

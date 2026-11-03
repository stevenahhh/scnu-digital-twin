import assert from "node:assert/strict";
import test from "node:test";
import { objectObservations } from "./vrObjectObservations.mjs";

const stations = [{ scene: "view", frame_version: 2, station_refined_x: 0, station_refined_z: 0, yaw_refined_deg: 0 }];
const record = { id: "bed", scene: "view", face: "f", estimated: true,
  classification: "correspondence_error", target: "visible brick bed silhouette",
  referencePolygon: [[100, 100], [700, 100], [100, 700]] };
test("a reviewed object's silhouette centroid is not the old visibility-range midpoint", () => {
  const [reading] = objectObservations({ frameVersion: 2, records: [record] }, stations);
  assert.equal(reading.col, 300);
  assert.equal(reading.estimated, true);
});
test("an unresolved correspondence remains unmeasurable, not a guessed column", () => {
  const [reading] = objectObservations({ frameVersion: 2, records: [
    { ...record, referencePolygon: null, reason: "base hidden, identity cannot be verified" },
  ] }, stations);
  assert.equal(reading.col, null);
  assert.equal(reading.reason, "base hidden, identity cannot be verified");
});
test("malformed polygons, missing stations and unlabelled estimates are rejected", () => {
  for (const bad of [
    { ...record, estimated: false }, { ...record, scene: "missing" },
    { ...record, referencePolygon: [[0, 0], [1, 1], [2, 2]] },
    { ...record, referencePolygon: [[0, 0], [2049, 0], [0, 100]] },
    { ...record, referencePolygon: null },
  ]) assert.throws(() => objectObservations({ frameVersion: 2, records: [bad] }, stations), /bed/);
});

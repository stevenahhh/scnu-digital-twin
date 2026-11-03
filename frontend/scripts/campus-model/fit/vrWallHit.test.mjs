import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { bearingObservations, bearingResidual, readBearing, triangulate, wallHit } from "./vrWallHit.mjs";

const E = 244000, N = 263800;
const station = (e = E, n = N, yaw = 0) => {
  const [x, z] = tmToScene(e, n);
  return { scene: "synthetic", frame_version: 2, station_refined_x: x, station_refined_z: z, yaw_refined_deg: yaw };
};
const reading = { face: "f", col: 1024 };
const wall = { id: "BLD_TEST/W00", a: [E + 10, N + 20], b: [E - 10, N + 20] };

test("cube columns recover wall s within 0.05 m in the EPSG frame", () => {
  const hit = wallHit(station(), reading, wall);
  assert.equal(hit.tier, "T2");
  assert.ok(Math.abs(hit.sM - 10) < 0.05);
  assert.deepEqual(hit.point.map(Math.round), [E, N + 20]);
  assert.equal(hit.estimated, true);
});

test("one degree bearing error at 20 m moves s by 0.349101 m", () => {
  const hit = wallHit(station(E, N, 1), reading, wall);
  // Independent analytic expectation: 20 * tan(1 degree) = 0.3491012986 m.
  assert.ok(Math.abs(hit.sM - 9.6508987014) < 1e-6);
});

test("two forward station rays recover a free point", () => {
  const hit = triangulate([
    { station: station(E - 10, N, 45), reading },
    { station: station(E + 10, N, 315), reading },
  ]);
  assert.ok(Math.hypot(hit.point[0] - E, hit.point[1] - N - 10) < 1e-6);
});

test("unrefined station never claims a hit or residual even when yaw is refined", () => {
  const unrefined = { scene: "scene_a8", frame_version: 2, station_x: 1, station_z: 2, yaw_refined_deg: 63 };
  assert.deepEqual(wallHit(unrefined, reading, wall), { tier: "T4", estimated: true, reason: "unrefined_station", residualDeg: null });
  assert.equal(bearingResidual(unrefined, reading, 1024).residualDeg, null);
});

test("invalid columns, faces, stale frames and malformed walls fail explicitly", () => {
  for (const col of [-1, 2049, NaN, "1024"]) assert.throws(() => readBearing(station(), { face: "f", col }), /col/);
  assert.throws(() => readBearing(station(), { face: "d", col: 1024 }), /face/);
  assert.throws(() => readBearing({ ...station(), frame_version: 1 }, reading), /stale.*frame/i);
  assert.throws(() => wallHit(station(), reading, { ...wall, b: wall.a }), /BLD_TEST\/W00/);
});

test("rays parallel to, behind or outside a wall do not invent an anchor", () => {
  for (const yaw of [90, 180, 45]) assert.equal(wallHit(station(E, N, yaw), reading, wall).point, null);
  assert.equal(triangulate([{ station: station(), reading }, { station: station(E + 10), reading }]).point, null);
});

test("residual uses cube projection and wraparound, and fails over 1.5 degrees", () => {
  const result = bearingResidual(station(E, N, 359), { face: "f", col: 1024 }, 1024 + 1024 * Math.tan(2 * Math.PI / 180));
  assert.ok(Math.abs(result.residualDeg - 2) < 1e-6);
  assert.equal(result.pass, false);
  assert.equal(bearingResidual(station(), reading, null).pass, false);
});

test("bearing report reads each independent column reference with its object identity", () => {
  const data = { frameVersion: 2, records: [{
    id: "door", anchor: { building: "BLD_TEST", wall: "W00", sM: 10 }, estimated: true,
    evidence: { refs: ["VR synthetic f col 1200 -> BLD_TEST/W00", "VR synthetic r col 900"] },
  }] };
  const rows = bearingObservations(data, [station()]);
  assert.deepEqual(rows.map(o => [o.id, o.scene, o.face, o.col, o.wall]), [
    ["door", "synthetic", "f", 1200, "BLD_TEST/W00"], ["door", "synthetic", "r", 900, "BLD_TEST/W00"],
  ]);
});

test("malformed, stale or unknown bearing references cannot produce a successful report", () => {
  const make = ref => ({ frameVersion: 2, records: [{ id: "bad", estimated: true, evidence: { refs: [ref] } }] });
  for (const ref of ["VR synthetic d col 12", "VR synthetic f col -1", "VR synthetic f col 2049", "VR missing f col 1024", "no column"]) {
    assert.throws(() => bearingObservations(make(ref), [station()]), /bad/);
  }
  assert.throws(() => bearingObservations({ ...make("VR synthetic f col 12"), frameVersion: 1 }, [station()]), /stale/);
  assert.throws(() => bearingObservations(make("VR synthetic f col 12"), [{ ...station(), frame_version: 1 }]), /stale/);
});

test("E3 canopy anchors use only the accepted e5 view while e3 correspondence is unresolved", () => {
  const stations = JSON.parse(readFileSync(new URL("../../perf/vr-stations.json", import.meta.url), "utf8"));
  const document = JSON.parse(readFileSync(new URL("../data/vr-bearings.json", import.meta.url), "utf8"));
  const observations = bearingObservations(document, stations).filter(row => row.building === "BLD_E3");
  // Task 18c: e3 col700 is an occluded upper-bay proxy, not a certified canopy point.
  // These are the actual observations consumed by compare-vr, not just a metadata count.
  assert.deepEqual(observations.map(row => [row.id, row.scene, row.col]), [
    ["SD-E5-C1", "scene_e5", 610],
    ["SD-E5-C2", "scene_e5", 1810],
  ]);
  const c1 = document.records.find(record => record.id === "SD-E5-C1");
  assert.equal(c1.estimated, true);
  assert.deepEqual([c1.anchor.building, c1.anchor.wall], ["BLD_E3", "W16"]);
  // Independent GIS W16 endpoints, task-18b/18c: a single ray constrained to the wall.
  const hit = wallHit(stations.find(row => row.scene === "scene_e5"), { face: "r", col: 610 }, {
    id: "BLD_E3/W16",
    a: [243718.61595434824, 263791.15560998383],
    b: [243677.80121413054, 263764.7220150316],
  });
  assert.ok(Math.abs(c1.anchor.sM - hit.sM) < 1e-6);
  assert.ok(Math.hypot(hit.point[0] - 243681.259168, hit.point[1] - 263766.961553) < 0.001);
  assert.equal(document.records.find(record => record.id === "SD-E5-C2").estimated, true);
});

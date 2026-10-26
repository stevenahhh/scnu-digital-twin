import assert from "node:assert/strict";
import test from "node:test";

import { tmToWgs84, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { readFileSync } from "node:fs";

import { A003_REGISTRATION, applyRegistration, readA003 } from "./a003.mjs";

const at = (E, N) => tmToWgs84(E, N);
const fc = () => ({ type: "FeatureCollection", features: [
  { type: "Feature", properties: { ufid: "U1" }, geometry: { type: "MultiLineString", coordinates: [[at(1000, 2000), at(1010, 2000), at(1010, 2010), at(1000, 2000)]] } },
  { type: "Feature", properties: { ufid: "U2" }, geometry: { type: "LineString", coordinates: [at(0, 0), at(5, 0)] } },
] });

test("move shifts the named vertices by dE/dN metres and insert adds a vertex after an original index", () => {
  const out = applyRegistration(fc(), { corrections: [
    { id: "R1", op: "move", ufid: "U1", line: 0, vertices: [0, 3], dE: 0.5, dN: -0.25 },
    { id: "R2", op: "insert", ufid: "U1", line: 0, after: 0, E: 1005, N: 2000.4 },
  ] });
  const line = out.features[0].geometry.coordinates[0].map(([lo, la]) => wgs84ToTm(lo, la));
  assert.equal(line.length, 5);
  assert.ok(Math.abs(line[0][0] - 1000.5) < 1e-4 && Math.abs(line[0][1] - 1999.75) < 1e-4);
  assert.ok(Math.abs(line[1][0] - 1005) < 1e-4 && Math.abs(line[1][1] - 2000.4) < 1e-4, "inserted after original vertex 0");
  assert.ok(Math.abs(line[2][0] - 1010) < 1e-4, "untouched vertex keeps its place");
  assert.deepEqual(line[4].map((v) => Math.round(v * 1e4)), line[0].map((v) => Math.round(v * 1e4)), "a closed ring stays closed");
  assert.deepEqual(out.features[0].properties.registration, ["R1", "R2"]);
  assert.equal(out.features[1].properties.registration, undefined, "a feature without corrections is passed through");
});

test("a correction naming no feature or vertex fails loudly", () => {
  assert.throws(() => applyRegistration(fc(), { corrections: [{ id: "R9", op: "move", ufid: "NOPE", line: 0, vertices: [0], dE: 1, dN: 0 }] }), /R9 name no A003 feature/);
  assert.throws(() => applyRegistration(fc(), { corrections: [{ id: "R8", op: "move", ufid: "U2", line: 0, vertices: [7], dE: 1, dN: 0 }] }), /no vertex 7/);
});

test("the committed registration applies to the delivered A003 file (every entry used, all estimated)", () => {
  const { corrections } = JSON.parse(readFileSync(A003_REGISTRATION, "utf8"));
  assert.ok(corrections.every((c) => c.estimated === true && c.reason));
  const applied = readA003().features.flatMap((f) => f.properties.registration ?? []);
  assert.deepEqual([...applied].sort(), corrections.map((c) => c.id).sort());
});

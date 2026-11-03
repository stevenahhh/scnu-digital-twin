import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { tmToWgs84, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { GROUND_REGISTRATION, readGroundRegistration, registerFacilities } from "./groundRegistration.mjs";

const ring = [[1000, 2000], [1010, 2000], [1010, 2010], [1000, 2000]].map(([E, N]) => tmToWgs84(E, N));
const facilities = () => [{ l3Code: 141, rings: [ring.map((p) => [...p])] }];

test("move shifts the named vertices of the named facility by dE/dN metres and leaves the input alone", () => {
  const input = facilities();
  const out = registerFacilities(input, { corrections: [{ id: "G1", target: "facility", index: 0, l3Code: 141, check: ring[0], op: "move", ring: 0, vertices: [1, 2], dE: 0.5, dN: -0.25 }] });
  const [a, b, c] = out[0].rings[0].map(([lo, la]) => wgs84ToTm(lo, la));
  assert.ok(Math.abs(a[0] - 1000) < 1e-4, "vertex 0 untouched");
  assert.ok(Math.abs(b[0] - 1010.5) < 1e-4 && Math.abs(b[1] - 1999.75) < 1e-4);
  assert.ok(Math.abs(c[0] - 1010.5) < 1e-4 && Math.abs(c[1] - 2009.75) < 1e-4);
  assert.deepEqual(out[0].registration, ["G1"]);
  assert.deepEqual(input[0].rings[0][1], ring[1], "the fetched outline is not mutated");
});

test("a correction that no longer matches the fetched facility fails loudly", () => {
  const stale = { id: "G2", target: "facility", index: 0, l3Code: 141, check: [0, 0], op: "move", ring: 0, vertices: [1], dE: 1, dN: 0 };
  assert.throws(() => registerFacilities(facilities(), { corrections: [stale] }), /G2: facility 0 .* does not match/);
  assert.throws(() => registerFacilities(facilities(), { corrections: [{ ...stale, check: ring[0], vertices: [9] }] }), /no vertex 9/);
});

test("the committed registration applies to the committed osm-ground.json facilities, every entry estimated", () => {
  const og = JSON.parse(readFileSync(new URL("../data/osm-ground.json", import.meta.url), "utf8"));
  const registration = readGroundRegistration(GROUND_REGISTRATION);
  assert.ok(registration.corrections.every((c) => c.estimated === true && c.reason));
  const out = registerFacilities(og.facilities.features, registration);
  assert.equal(out.flatMap((f) => f.registration ?? []).length, registration.corrections.length);
});

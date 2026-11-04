import assert from "node:assert/strict";
import test from "node:test";
import { AnchorError, wallsOf, wallCoordinates, resolveAnchor, checkWallMapping } from "./anchors.mjs";
import { validate } from "./schemas.mjs";

// EPSG:5186 metres. The first vertex stays fixed when the ring is made clockwise.
const rectangle = [[243000, 263000], [243000, 263010], [243020, 263010], [243020, 263000]];
const savedRectangle = () => [
  { wall: "W00", A: [243000, 263000], lengthM: 10, bearingDeg: 0 },
  { wall: "W01", A: [243000, 263010], lengthM: 20, bearingDeg: 90 },
  { wall: "W02", A: [243020, 263010], lengthM: 10, bearingDeg: 180 },
  { wall: "W03", A: [243020, 263000], lengthM: 20, bearingDeg: 270 },
];
const footprint = () => ({ polygons: [[rectangle.map((p) => [...p])]], walls: savedRectangle() });
const footprints = () => ({ BLD_TEST: footprint() });
const record = (wall = "W00", extra = {}) => ({
  id: "TEST/ENT1", anchor: { building: "BLD_TEST", wall, sM: 3, tM: 2, hM: 4, ...extra },
});
const near = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6, `${label}[${i}]: ${v} vs ${expected[i]}`));
};

test("all four walls resolve s/t/h in TM with outward normals and round trip within 1e-6 m", () => {
  const expected = [
    { origin: [242998, 263003], a: [0, 1], n: [-1, 0] },
    { origin: [243003, 263012], a: [1, 0], n: [0, 1] },
    { origin: [243022, 263007], a: [0, -1], n: [1, 0] },
    { origin: [243017, 262998], a: [-1, 0], n: [0, -1] },
  ];
  const walls = wallsOf("BLD_TEST", footprint());
  assert.deepEqual(walls.map((w) => w.id), ["BLD_TEST/W00", "BLD_TEST/W01", "BLD_TEST/W02", "BLD_TEST/W03"]);
  expected.forEach((want, i) => {
    const resolved = resolveAnchor(record(`W0${i}`), footprints());
    near(resolved.origin, want.origin, `W0${i} origin`);
    near(resolved.a, want.a, `W0${i} tangent`);
    near(resolved.n, want.n, `W0${i} normal`);
    assert.equal(resolved.hM, 4);
    const local = wallCoordinates(resolved.origin, walls[i]);
    near([local.sM, local.tM], [3, 2], `W0${i} round trip`);
  });
});

test("closed counterclockwise rings keep vertex zero and produce the same wall ids and frames", () => {
  const reversed = [rectangle[0], ...rectangle.slice(1).reverse(), rectangle[0]];
  assert.deepEqual(wallsOf("BLD_TEST", { polygons: [[reversed]] }), wallsOf("BLD_TEST", footprint()));
});

test("courtyard normals point into the hole and additional polygons have distinct wall ids", () => {
  const hole = [[243004, 263003], [243004, 263007], [243008, 263007], [243008, 263003]];
  const second = rectangle.map(([e, n]) => [e + 30, n]);
  const fp = { polygons: [[rectangle, hole], [second]] };
  const walls = wallsOf("BLD_TEST", fp);
  fp.walls = walls;
  assert.equal(walls.length, 12);
  const result = resolveAnchor(record("H0/W00", { sM: 1, tM: 0.5 }), { BLD_TEST: fp });
  near(result.origin, [243004.5, 263004], "courtyard");
  assert.equal(walls[8].id, "BLD_TEST/P1/W00");
  near(resolveAnchor(record("P1/W00"), { BLD_TEST: fp }).origin, [243028, 263003], "second polygon");
});

test("yaw rotates the object axes about its wall-local origin; absent offsets default to zero", () => {
  const r = { id: "TEST/SIGN", anchor: { building: "BLD_TEST", wall: "W01", sM: 5, yawDeg: 90 } };
  const result = resolveAnchor(r, footprints());
  near(result.origin, [243005, 263010], "yaw origin");
  near(result.a, [0, 1], "yaw tangent");
  near(result.n, [-1, 0], "yaw normal");
  assert.equal(result.hM, 0);
});

test("a wall span resolves both endpoints without clamping offsets or rounding TM coordinates", () => {
  const r = { id: "TEST/HEDGE", anchor: { building: "BLD_TEST", wall: "W01", s0M: 0.25, s1M: 19.5, tM: 0.125 } };
  const result = resolveAnchor(r, footprints());
  near(result.origin, [243000.25, 263010.125], "span start");
  near(result.end, [243019.5, 263010.125], "span end");
  assert.equal(result.lengthM, 19.25);
  assert.equal(validate("anchors", { anchors: [r] }).ok, true);
  assert.equal(validate("anchors", { anchors: [{ ...r, anchor: { ...r.anchor, sM: 2 } }] }).ok, false);
  assert.equal(validate("anchors", { anchors: [{ ...r, anchor: { ...r.anchor, s1M: -1 } }] }).ok, false);
});

test("parcel anchors use the oriented box centre and long/short axes in metres", () => {
  const r = { id: "TEST/BENCH", anchor: { parcel: "PARCEL_TEST", uM: 3, vM: -2, hM: 0.4 }, estimated: true };
  const result = resolveAnchor(r, {}, { PARCEL_TEST: { ring: rectangle, estimated: false } });
  near(result.origin, [243013, 263003], "parcel origin");
  near(result.a, [1, 0], "parcel long axis");
  near(result.n, [0, 1], "parcel short axis");
  assert.equal(result.hM, 0.4);
  assert.equal(result.estimated, true);
});

test("a rotated parcel uses its own oriented box, not global east/north offsets", () => {
  const ring = [[0, 0], [8, 6], [5.6, 9.2], [-2.4, 3.2]].map(([e, n]) => [e + 243000, n + 263000]);
  const r = { id: "TEST/LAMP", anchor: { parcel: "PARCEL_ROTATED", uM: 2, vM: 1 } };
  const result = resolveAnchor(r, {}, { PARCEL_ROTATED: { ring } });
  // Exact rectangle axes: (0.8,0.6), (-0.6,0.8), centre=(2.8,4.6).
  near(result.origin, [243003.8, 263006.6], "rotated parcel");
});

test("missing building, wall and parcel resolution errors name the record and its reference", () => {
  for (const [r, fs, parcels, ref] of [
    [record("W99"), footprints(), {}, "BLD_TEST/W99"],
    [record(), {}, {}, "BLD_TEST/W00"],
    [{ id: "TEST/ENT1", anchor: { parcel: "PARCEL_MISSING", uM: 0, vM: 0 } }, {}, {}, "PARCEL_MISSING"],
  ]) {
    assert.throws(() => resolveAnchor(r, fs, parcels), (e) => e.message.startsWith("TEST/ENT1: ") && e.message.includes(ref));
  }
});

test("malformed anchor records are rejected by the shared schema with record-named errors", () => {
  const bad = [
    null,
    { ...record(), anchor: null },
    record("W00", { sM: NaN }),
    record("W00", { tM: "2" }),
    record("W00", { hM: Infinity }),
    record("W00", { yawDeg: "90" }),
    record("bad"),
    record("W00", { parcel: "PARCEL_TEST", uM: 1, vM: 2 }),
    { id: "TEST/BENCH", anchor: { parcel: "PARCEL_TEST", uM: 2 } },
    { ...record(), estimated: false, evidence: { tier: "T4" } },
  ];
  for (const r of bad) {
    const result = validate("anchors", { anchors: [r] });
    assert.equal(result.ok, false, JSON.stringify(r));
    assert.ok(result.errors.every((e) => e.startsWith(`${r?.id ?? "anchors[0]"}: `)), result.errors.join("\n"));
  }
  assert.equal(validate("anchors", null).ok, false);
  assert.equal(validate("anchors", { anchors: [record(), record()] }).ok, false);
  assert.equal(validate("anchors", { anchors: [record()] }).ok, true);
});

test("invalid rings and zero-length walls fail with the building and wall instead of NaN coordinates", () => {
  for (const polygons of [
    [[[[0, 0], [1, 0]]]],
    [[[[0, 0], [1, NaN], [1, 1]]]],
    [[[[0, 0], [0, 0], [1, 1], [1, 0]]]],
    [[[[0, 0], [1, 1], [2, 2]]]],
  ]) {
    const fs = { BLD_TEST: { polygons } };
    assert.throws(() => resolveAnchor(record(), fs), (e) => e.message.startsWith("TEST/ENT1: ") && e.message.includes("BLD_TEST/W00"));
  }
});

test("a footprint refetch that changes wall length, bearing, start or count is flagged as stale", () => {
  const baseline = wallsOf("BLD_TEST", footprint());
  const changes = [
    rectangle.map(([e, n]) => [e, n === 263010 ? n + 0.6 : n]),
    rectangle.map(([e, n]) => [243000 + (e - 243000) * Math.cos(3 * Math.PI / 180) - (n - 263000) * Math.sin(3 * Math.PI / 180),
      263000 + (e - 243000) * Math.sin(3 * Math.PI / 180) + (n - 263000) * Math.cos(3 * Math.PI / 180)]),
    rectangle.map(([e, n]) => [e + 1, n]),
    [rectangle[0], [243000, 263005], ...rectangle.slice(1)],
    [...rectangle.slice(1), rectangle[0]],
  ];
  for (const ring of changes) {
    const fp = { polygons: [[ring]] };
    const errors = checkWallMapping("BLD_TEST", fp, baseline);
    assert.ok(errors.some((e) => e.includes("BLD_TEST/W00") && e.includes("stale wall")), errors.join("\n"));
    const result = validate("anchors", { anchors: [record()] }, {
      footprints: { BLD_TEST: fp },
      nodeMap: { entries: [{ nodeId: "BLD_TEST", walls: baseline }] },
    });
    assert.equal(result.ok, false, "a success message must not hide a changed wall");
    assert.ok(result.errors.some((e) => e.startsWith("TEST/ENT1: ") && e.includes("BLD_TEST/W00") && e.includes("stale wall")));
  }
  assert.deepEqual(checkWallMapping("BLD_TEST", footprint(), baseline), []);
});

test("saved mappings allow exactly the design tolerances and reject malformed or absent snapshots", () => {
  const baseline = wallsOf("BLD_TEST", footprint());
  const within = baseline.map((wall) => ({ ...wall, lengthM: wall.lengthM + 0.5, bearingDeg: (wall.bearingDeg + 2) % 360 }));
  assert.deepEqual(checkWallMapping("BLD_TEST", footprint(), within), []);
  for (const nodeMap of [{}, { entries: "broken" }, { entries: [{ nodeId: "BLD_TEST" }] },
    { entries: [{ nodeId: "BLD_TEST", walls: [null] }] }]) {
    const result = validate("anchors", { anchors: [record()] }, { footprints: footprints(), nodeMap });
    assert.equal(result.ok, false);
    assert.ok(result.errors.every((e) => e.startsWith("TEST/ENT1: ") && e.includes("BLD_TEST/W00")), result.errors.join("\n"));
  }
});

test("resolving anchors does not mutate the footprint, saved wall map or record", () => {
  const fs = footprints();
  fs.BLD_TEST.walls = wallsOf("BLD_TEST", fs.BLD_TEST);
  const r = record();
  const before = JSON.stringify({ fs, r });
  resolveAnchor(r, fs);
  assert.equal(JSON.stringify({ fs, r }), before);
});

test("anchor validation resolves real references and propagates estimated footprints", () => {
  const fs = { BLD_TEST: { ...footprint(), estimated: true } };
  assert.equal(resolveAnchor(record(), fs).estimated, true);
  assert.equal(validate("anchors", { anchors: [record("W99")] }, { footprints: fs }).ok, false);
  assert.equal(validate("anchors", { anchors: [record()] }, { footprints: fs }).ok, true);
});

test("resolveAnchor rejects a saved snapshot after a refetch translates the footprint", () => {
  const fp = footprint();
  fp.polygons = [[rectangle.map(([e, n]) => [e + 0.6, n])]];
  assert.throws(() => resolveAnchor(record(), { BLD_TEST: fp }), (error) =>
    error instanceof AnchorError && error.recordId === "TEST/ENT1" &&
    error.reference === "BLD_TEST/W00" && /stale wall/.test(error.message));
});

test("fresh nodeMap snapshots resolve through both entries and additionalWalls", () => {
  for (const nodeMap of [
    { entries: [{ nodeId: "BLD_TEST", walls: savedRectangle() }] },
    { entries: [], additionalWalls: { BLD_TEST: savedRectangle() } },
  ]) {
    // The persisted node map must replace the stale in-memory snapshot.
    const fp = footprint();
    fp.walls[0].lengthM = 99;
    assert.deepEqual(validate("anchors", { anchors: [record()] }, {
      footprints: { BLD_TEST: fp }, nodeMap,
    }), { ok: true, errors: [] });
  }
});

test("non-rectangular parcels use the bounding box centre rather than the vertex mean", () => {
  // A trapezoid with box [0,20] x [0,8]: centre (10,4), not vertex mean (8.5,4).
  const ring = [[0, 0], [0, 8], [14, 8], [20, 0]].map(([e, n]) => [243000 + e, 263000 + n]);
  const result = resolveAnchor({ id: "TRAPEZOID", anchor: { parcel: "LOT", uM: 3, vM: -2 } },
    {}, { LOT: { ring } });
  near(result.origin, [243013, 263002], "trapezoid origin");
  near(result.a, [1, 0], "trapezoid long axis");
  near(result.n, [0, 1], "trapezoid short axis");
});

test("a flipped parcel starting toward negative E keeps the positive-E long axis", () => {
  // Same 10 x 4 rotated box as above, starting with (-8,-6).
  const ring = [[8, 6], [0, 0], [-2.4, 3.2], [5.6, 9.2]]
    .map(([e, n]) => [e + 243000, n + 263000]);
  const result = resolveAnchor({ id: "FLIPPED", anchor: { parcel: "LOT", uM: 2, vM: 1 } },
    {}, { LOT: { ring } });
  near(result.origin, [243003.8, 263006.6], "flipped parcel origin");
  near(result.a, [0.8, 0.6], "flipped long axis");
  near(result.n, [-0.6, 0.8], "flipped short axis");
});

test("the same wall id resolves against the selected building rather than the first building", () => {
  const fs = footprints();
  fs.BLD_OTHER = {
    polygons: [[[[244000, 264000], [244008, 264000], [244008, 263988], [244000, 263988]]]],
    walls: [
      { wall: "W00", A: [244000, 264000], lengthM: 8, bearingDeg: 90 },
      { wall: "W01", A: [244008, 264000], lengthM: 12, bearingDeg: 180 },
      { wall: "W02", A: [244008, 263988], lengthM: 8, bearingDeg: 270 },
      { wall: "W03", A: [244000, 263988], lengthM: 12, bearingDeg: 0 },
    ],
  };
  near(resolveAnchor(record(), fs).origin, [242998, 263003], "first building");
  const result = resolveAnchor(record("W00", { building: "BLD_OTHER" }), fs);
  near(result.origin, [244003, 264002], "second building");
  near(result.a, [1, 0], "second building tangent");
  near(result.n, [0, 1], "second building normal");
});

test("saved wall bearings accept the 359/1 wrap at two degrees in both directions", () => {
  for (const sign of [-1, 1]) {
    // Unit north wall at +/-1 degree; the remaining three walls use the same rotation.
    const sin = sign * Math.sin(Math.PI / 180), cos = Math.cos(Math.PI / 180);
    const fp = {
      polygons: [[[[0, 0], [sin, cos], [sin + cos, cos - sin], [cos, -sin]]]],
      walls: [
        { wall: "W00", A: [0, 0], lengthM: 1, bearingDeg: sign === 1 ? 359 : 1 },
        { wall: "W01", A: [sin, cos], lengthM: 1, bearingDeg: 90 + sign },
        { wall: "W02", A: [sin + cos, cos - sin], lengthM: 1, bearingDeg: 180 + sign },
        { wall: "W03", A: [cos, -sin], lengthM: 1, bearingDeg: 270 + sign },
      ],
    };
    const result = resolveAnchor(record("W00", { sM: 0.5, tM: 0 }), { BLD_TEST: fp });
    near(result.origin, [sin / 2, cos / 2], "wrapped wall midpoint");
    fp.walls[0].bearingDeg = sign === 1 ? 358.9 : 1.1;
    assert.throws(() => resolveAnchor(record("W00", { sM: 0.5 }), { BLD_TEST: fp }), /stale wall/);
  }
});

test("L-shaped footprints resolve every actual wall including the two reentrant walls", () => {
  // Clockwise L: the notch is bounded by x=4 (W02) and y=4 (W03), not bbox x/y=10.
  const fp = {
    polygons: [[[[0, 0], [0, 10], [4, 10], [4, 4], [10, 4], [10, 0]]]],
    walls: [
      { wall: "W00", A: [0, 0], lengthM: 10, bearingDeg: 0 },
      { wall: "W01", A: [0, 10], lengthM: 4, bearingDeg: 90 },
      { wall: "W02", A: [4, 10], lengthM: 6, bearingDeg: 180 },
      { wall: "W03", A: [4, 4], lengthM: 6, bearingDeg: 90 },
      { wall: "W04", A: [10, 4], lengthM: 4, bearingDeg: 180 },
      { wall: "W05", A: [10, 0], lengthM: 10, bearingDeg: 270 },
    ],
  };
  const expected = [
    { origin: [-0.5, 2], a: [0, 1], n: [-1, 0] },
    { origin: [2, 10.5], a: [1, 0], n: [0, 1] },
    { origin: [4.5, 8], a: [0, -1], n: [1, 0] },
    { origin: [6, 4.5], a: [1, 0], n: [0, 1] },
    { origin: [10.5, 2], a: [0, -1], n: [1, 0] },
    { origin: [8, -0.5], a: [-1, 0], n: [0, -1] },
  ];
  expected.forEach((want, i) => {
    const result = resolveAnchor(record(`W0${i}`, { sM: 2, tM: 0.5 }), { BLD_TEST: fp });
    near(result.origin, want.origin, `L W0${i} origin`);
    near(result.a, want.a, `L W0${i} tangent`);
    near(result.n, want.n, `L W0${i} normal`);
  });
});

test("a missing wall snapshot is an error for direct resolution and geometry validation", () => {
  const fs = { BLD_TEST: { polygons: footprint().polygons } };
  assert.throws(() => resolveAnchor(record(), fs), (error) =>
    error instanceof AnchorError && error.recordId === "TEST/ENT1" &&
    error.reference === "BLD_TEST/W00" && /wall.*(?:snapshot|mapping).*missing/.test(error.message));
  const result = validate("anchors", { anchors: [record()] }, { footprints: fs });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /TEST\/ENT1.*BLD_TEST\/W00.*wall.*(?:snapshot|mapping).*missing/);
});

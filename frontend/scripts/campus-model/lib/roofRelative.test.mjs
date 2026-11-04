import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { encodeRoofGeometry, resolveRoofGeometry } from "./roofRelative.mjs";

const footprint = { polygons: [[[[100, 200], [120, 200], [120, 210], [100, 210]]]] };
const core = {
  kind: "core", outer: [[104, 202], [108, 202], [108, 205], [104, 205]],
  holes: [[[105, 203], [106, 203], [106, 204]]],
  triangles: [[[104, 202, 18], [108, 202, 18], [108, 205, 20]]],
  columns: [[[104, 202], [105, 202], [105, 203]]],
  baseMetres: 15, topMetres: 20,
};
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((p, i) => p.forEach((v, j) => assert.ok(Math.abs(v - expected[i][j]) < 1e-8, `${v} != ${expected[i][j]}`)));
};

test("core rings, holes, roof triangles and columns follow a refetched footprint", () => {
  const relative = encodeRoofGeometry("BLD_test/core", core, footprint);
  const moved = { polygons: footprint.polygons.map(p => p.map(r => r.map(([e, n]) => [e + 7, n - 3]))) };
  const result = resolveRoofGeometry("BLD_test/core", { ...core, roofRelative: relative }, moved);
  close(result.outer, [[111, 199], [115, 199], [115, 202], [111, 202]]);
  close(result.holes[0], [[112, 200], [113, 200], [113, 201]]);
  close(result.triangles[0], [[111, 199, 18], [115, 199, 18], [115, 202, 20]]);
  close(result.columns[0], [[111, 199], [112, 199], [112, 200]]);
  assert.equal(result.topMetres, 20);
  assert.equal(result.estimated, true);
});

test("solar plans rotate with their footprint rather than retaining world coordinates", () => {
  const array = { kind: "solar", plan: core.outer, baseMetres: 15 };
  const roofRelative = encodeRoofGeometry("array", array, footprint);
  const rotate = ([e, n]) => [110 + (e - 110) * 0.8 - (n - 205) * 0.6, 205 + (e - 110) * 0.6 + (n - 205) * 0.8];
  const rotated = { polygons: footprint.polygons.map(p => p.map(r => r.map(rotate))) };
  const result = resolveRoofGeometry("array", { ...array, roofRelative }, rotated);
  close(result.plan, core.outer.map(rotate));
  assert.equal(result.baseMetres, 15);
});

test("a mast uses its own footprint part and survives reversed ring winding", () => {
  const multi = { polygons: [...footprint.polygons, [[[200, 200], [230, 200], [230, 210], [200, 210]]]] };
  const mast = { at: [205, 203], heightMetres: 9 };
  const roofRelative = encodeRoofGeometry("mast", mast, multi);
  assert.equal(roofRelative.polygon, 1);
  const changed = { polygons: [multi.polygons[0], multi.polygons[1].map(r => r.toReversed().map(([e, n]) => [e + 3, n + 2]))] };
  const result = resolveRoofGeometry("mast", { ...mast, roofRelative }, changed);
  close([result.at], [[208, 205]]);
});

test("missing footprint and invalid relative coordinates fail with the object id", () => {
  assert.throws(() => encodeRoofGeometry("missing/core", core, undefined), /missing\/core.*footprint/);
  const roofRelative = encodeRoofGeometry("bad/core", core, footprint);
  roofRelative.outer[0][0] = NaN;
  assert.throws(() => resolveRoofGeometry("bad/core", { ...core, roofRelative }, footprint), /bad\/core.*finite/);
});

test("generated cores and curated roof equipment carry authoritative estimated coordinates", () => {
  const forms = JSON.parse(readFileSync(new URL("../data/building-forms.json", import.meta.url), "utf8"));
  const equipment = JSON.parse(readFileSync(new URL("../data/facade-attachments.json", import.meta.url), "utf8"));
  const records = [
    ...forms.buildings.flatMap(b => b.masses.filter(m => m.kind === "core").map(m => ({ id: b.key, record: m }))),
    ...equipment.buildings.flatMap(b => b.attachments.filter(a => ["mast", "solar", "roof"].includes(a.kind)).map(a => ({ id: a.id, record: a }))),
  ];
  for (const { id, record } of records) {
    assert.equal(record.roofRelative?.version, 1, id);
    assert.equal(record.estimated, true, id);
    for (const key of ["outer", "holes", "columns", "triangles", "at", "plan", "round"]) {
      if (record[key] !== undefined) assert.ok(record.roofRelative[key] !== undefined, `${id}/${key}`);
    }
  }
});

test("generated LOD4 roofs below the photo threshold use footprint prisms", () => {
  const forms = JSON.parse(readFileSync(new URL("../data/building-forms.json", import.meta.url), "utf8"));
  for (const b of forms.buildings.filter(b => b.iou.lod4 !== null && b.iou.lod4 < 0.7)) {
    assert.ok(b.masses.every(m => m.fromFootprint === true), b.key);
    assert.ok(b.flags.some(flag => flag.startsWith("LOD4 masses rejected:")), b.key);
  }
});

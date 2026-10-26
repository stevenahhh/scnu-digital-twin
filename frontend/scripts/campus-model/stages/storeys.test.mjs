import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { heightOf, storeyMedians } from "./buildings.mjs";

const gis = JSON.parse(readFileSync(new URL("../data/gis-buildings.json", import.meta.url), "utf8"));

test("storey medians from the committed GIS records give an education median of 3.9-4.5 m over 20+ records", () => {
  const medians = storeyMedians(gis.buildings);
  assert.ok(medians.education.metres >= 3.9 && medians.education.metres <= 4.5, `education ${medians.education.metres}`);
  assert.ok(medians.education.n >= 20, `education n ${medians.education.n}`);
  assert.equal(medians.education.fallback, null);
});

test("storey medians group by use, keep the 2.5-5 m window and fall back to other below 5 records", () => {
  const record = (usability, floors, heightMetres, name = "") => ({ usability, floors, heightMetres, name });
  const fixture = [
    record("교육연구시설", 2, 8),
    record("교육연구시설", 2, 8.4),
    record("교육연구시설", 2, 8.8),
    record("교육연구시설", 2, 9.2),
    record("교육연구시설", 2, 9.6),
    record("제2종근린생활시설", 2, 7.2),
  ];
  const medians = storeyMedians(fixture);
  assert.deepEqual(medians.education, { metres: 4.4, n: 5, fallback: null });
  assert.deepEqual(medians.dormitory, { metres: 3.6, n: 0, fallback: "other" });
  assert.deepEqual(medians.other, { metres: 3.6, n: 1, fallback: null });
  // 5.2 m per storey lies outside the window, so it neither counts nor lifts the education class.
  assert.deepEqual(storeyMedians([...fixture, record("교육연구시설", 3, 15.6)]).education, { metres: 4.4, n: 5, fallback: null });
  // Four education records are too few: the class takes the other median.
  assert.deepEqual(storeyMedians(fixture.slice(1)).education, { metres: 3.6, n: 4, fallback: "other" });
});

test("heightOf names its lineage: gis-height for a plausible source height, floors x median otherwise", () => {
  const medians = storeyMedians(gis.buildings);
  const fromGis = heightOf({ floors: 4, heightMetres: 16 }, true, medians);
  assert.equal(fromGis.heightLineage, "gis-height");
  assert.equal(fromGis.heightMetres, 16);
  assert.equal(fromGis.storeyMetresUsed, null);
  const fromFloors = heightOf({ floors: 4, heightMetres: 0 }, true, medians);
  assert.equal(fromFloors.heightLineage, "floors x median");
  assert.equal(fromFloors.storeyMetresUsed, medians.education.metres);
  assert.equal(fromFloors.heightMetres, 4 * medians.education.metres);
  assert.equal(heightOf({ floors: 4, heightMetres: 0, heightOverride: "curated" }, true, medians).heightLineage, "curated:scnu-facades");
});

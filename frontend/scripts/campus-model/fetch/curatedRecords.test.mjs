import assert from "node:assert/strict";
import test from "node:test";
import { keepReplacedRecords } from "./curatedRecords.mjs";

test("a building record curated as a whole survives a regeneration, the others are regenerated", () => {
  const previous = [
    { key: "BLD_D4", masses: [{ kind: "main", topMetres: 25.33 }], curation: { mode: "replace-building-record" } },
    { key: "BLD_A10", masses: [{ kind: "wing", topMetres: 15.2 }] },
  ];
  const regenerated = [
    { key: "BLD_A10", masses: [{ kind: "wing", topMetres: 15.2 }, { kind: "main", topMetres: 13.23 }] },
    { key: "BLD_D4", masses: [{ kind: "main", topMetres: 22 }] },
    { key: "BLD_NEW", masses: [] },
  ];
  const { records, kept } = keepReplacedRecords(regenerated, previous);
  assert.deepEqual(kept, ["BLD_D4"]);
  assert.deepEqual(records.map((r) => r.key), ["BLD_A10", "BLD_D4", "BLD_NEW"]);
  assert.equal(records[1], previous[0]);
  assert.equal(records[0], regenerated[0]);
});

test("a whole-record curation of a building that is no longer generated fails the run", () => {
  const previous = [{ key: "BLD_GONE", masses: [], curation: { mode: "replace-building-record" } }];
  assert.throws(() => keepReplacedRecords([{ key: "BLD_A10", masses: [] }], previous), /BLD_GONE/);
});

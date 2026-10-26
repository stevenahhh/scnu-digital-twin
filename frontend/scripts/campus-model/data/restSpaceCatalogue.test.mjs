// Shape checks for data/rest-space-catalogue.json. CATALOGUE_FILE checks another file with the same rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const FILE = process.env.CATALOGUE_FILE ?? new URL("./rest-space-catalogue.json", import.meta.url);
const catalogue = JSON.parse(readFileSync(FILE, "utf8"));
const types = Object.entries(catalogue.types);

test("every type names a builder, carries estimated dims and a dimsSource ending in (estimated)", () => {
  assert.ok(types.length >= 12, `only ${types.length} types`);
  assert.ok(catalogue.lineageNote.includes("추정"));
  for (const [id, type] of types) {
    assert.equal(typeof type.builder, "string", `${id}: builder`);
    assert.equal(type.estimated, true, `${id}: estimated`);
    assert.ok(type.dimsSource?.endsWith("(estimated)"), `${id}: dimsSource must end in (estimated)`);
    assert.ok(type.dims && Object.keys(type.dims).length > 0, `${id}: dims`);
  }
});

test("every default lies inside its own range", () => {
  for (const [id, type] of types) {
    for (const [name, { default: value, range }] of Object.entries(type.dims)) {
      assert.ok(Array.isArray(range) && range.length === 2 && range[0] <= range[1], `${id}.${name}: range`);
      assert.ok(value >= range[0] && value <= range[1], `${id}.${name}: default ${value} outside ${range[0]}-${range[1]}`);
    }
  }
});

test("KDS 34 50 15 ranges: pergola height 2.2-3.0 m, bus shelter eave 2.5-3.0 m", () => {
  assert.deepEqual(catalogue.types.pergola.dims.heightM.range, [2.2, 3.0]);
  assert.deepEqual(catalogue.types.bus_stop_shelter.dims.heightM.range, [2.5, 3.0]);
});

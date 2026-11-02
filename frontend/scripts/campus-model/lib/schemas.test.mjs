import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./schemas.mjs";

const entry = (nodeId, footprintSource, extra = {}) => ({
  nodeId,
  gis: { footprintSource, pnu: "1215010800200010001" },
  gisCentreTm: [207000.5, 278000.25],
  uniCentreScene: [120.5, -88.25],
  iou: 0.91,
  curated: false,
  ...extra,
});
const map = (entries) => ({ source: "test", entries });

test("a valid bldNodeMap is ok", () => {
  const result = validate("bldNodeMap", map([entry("BLD_D4", "rec 1"), entry("BLD_E3", "rec 2")]));
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("a GIS record used by two nodes names both node ids", () => {
  const { ok, errors } = validate("bldNodeMap", map([entry("BLD_D4", "rec 1"), entry("BLD_E3", "rec 1")]));
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^BLD_E3: /);
  assert.match(errors[0], /BLD_D4/);
});

test("gis:null names the node until curated", () => {
  const { ok, errors } = validate("bldNodeMap", map([entry("BLD_D4", "rec 1"), { ...entry("BLD_X1", "x"), gis: null }]));
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^BLD_X1: /);
  const curatedNull = { ...entry("BLD_X1", "x"), gis: null, gisCentreTm: null, curated: true, reason: "no GIS record" };
  assert.equal(validate("bldNodeMap", map([entry("BLD_D4", "rec 1"), curatedNull])).ok, true);
});

test("a curated entry needs a reason", () => {
  const curated = entry("BLD_D4", "rec 1", { curated: true });
  assert.match(validate("bldNodeMap", map([curated])).errors[0], /^BLD_D4: .*reason/);
  assert.equal(validate("bldNodeMap", map([{ ...curated, reason: "name and area agree" }])).ok, true);
});

test("malformed input gives id-named errors instead of throwing", () => {
  assert.match(validate("bldNodeMap", null).errors[0], /^bldNodeMap: /);
  assert.match(validate("bldNodeMap", { entries: "x" }).errors[0], /^bldNodeMap: /);
  const { errors } = validate("bldNodeMap", map([{ nodeId: "BLD_A1" }, 7]));
  assert.ok(errors.length >= 5);
  assert.ok(errors.every((e) => /^(BLD_A1|entries\[1\]): /.test(e)), errors.join("\n"));
  assert.match(validate("nope", {}).errors[0], /^nope: unknown kind/);
});

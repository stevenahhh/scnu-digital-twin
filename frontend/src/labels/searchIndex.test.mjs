import assert from "node:assert/strict";
import test from "node:test";
import { editDistance, groupOf, searchBuildings, suggestBuilding } from "./searchIndex.mjs";

const entry = (elementId, displayName, extra = {}) => ({ elementId, displayName, shortName: null, code: null, tier: 2, aliases: [displayName], ...extra });
const REGISTRY = new Map([
  ["BLD_C1", entry("BLD_C1", "도서관", { code: "C1", tier: 1, aliases: ["도서관", "C1"] })],
  ["BLD_D4", entry("BLD_D4", "공과대학 3호관", { code: "D4", tier: 1, shortName: "공대 3호관", aliases: ["공과대학 3호관", "공대 3호관", "D4", "공대"] })],
  ["BLD_D2", entry("BLD_D2", "공과대학 1호관", { code: "D2", aliases: ["공과대학 1호관", "D2", "공대"] })],
  ["BLD_X", entry("BLD_X", "중앙도서관 별관", { tier: 3 })],
  ["ZONE_library", entry("ZONE_library", "도서관 일대", { tier: 0, shortName: "도서관" })],
  ["BLD_NONAME", { elementId: "BLD_NONAME", displayName: null, tier: 3 }],
]);

test("prefix beats substring, then tier and name; at most 8 results", () => {
  assert.deepEqual(searchBuildings("도서관", REGISTRY).map((e) => e.elementId), ["ZONE_library", "BLD_C1", "BLD_X"]);
  assert.deepEqual(searchBuildings("  d4 ", REGISTRY).map((e) => e.elementId), ["BLD_D4"]);
  assert.equal(searchBuildings("", REGISTRY).length, 0);
  const many = new Map(Array.from({ length: 20 }, (_, i) => [`B${i}`, entry(`B${i}`, `건물${i}`)]));
  assert.equal(searchBuildings("건물", many).length, 8);
});

test("aliases match after names (공대 finds both engineering buildings)", () => {
  assert.deepEqual(searchBuildings("공대", REGISTRY).map((e) => e.elementId), ["BLD_D4", "BLD_D2"]);
});

test("groups follow the tier", () => {
  assert.deepEqual(["BLD_C1", "BLD_D2", "BLD_X", "ZONE_library"].map((id) => groupOf(REGISTRY.get(id))), ["landmark", "building", "annex", "zone"]);
});

test("suggests the closest name within two edits, else nothing", () => {
  assert.equal(editDistance("도서곤", "도서관"), 1);
  assert.equal(suggestBuilding("도서곤", REGISTRY), "도서관");
  assert.equal(suggestBuilding("주차장 북쪽 입구", REGISTRY), null);
});

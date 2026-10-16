import assert from "node:assert/strict";
import test from "node:test";
import commonElements from "../../../common/data/common_elemetns.json" with { type: "json" };
import { resolveBuildingMeta } from "./buildingLabels.mjs";

const elementNames = new Map(
  commonElements.elements.map(({ element_id, name }) => [element_id, name]),
);
const buildingMap = {
  대학본부: "BLD_A1",
  약학대학: "BLD_A2",
  천연물신약연구소: "BLD_A3",
  생활관: "BLD_A4",
  박물관: "BLD_B1",
  "70주년기념관": "BLD_B2",
  생명대: "BLD_B3",
  도서관: "BLD_C1",
  학생회관: "BLD_E1",
  사범대: "BLD_E2",
  창업보육센터: "BLD_D1",
  공과대1호: "BLD_D2",
  공과대2호: "BLD_D3",
  공과대3호: "BLD_D4",
};
const blockedIds = new Set(["BLD_C1001"]);
const options = { elementNames, buildingMap, blockedIds };

const glbNodeNames = [
  "BLD_E5",
  "BLD_E1",
  "BLD_A4",
  "BLD_C1.001",
  "BLD_Training Lab Building",
  "BLD_C1",
  "BLD_Dormitory_Building",
  "BLD_E3",
  "BLD_D2",
  "BLD_D1",
  "BLD_B7",
  "BLD_B1",
  "BLD_A12.001",
  "BLD_A12",
  "BLD_D4",
  "BLD_E8",
  "BLD_D3",
  "BLD_E6",
  "BLD_A10",
  "BLD_E7",
  "BLD_B4",
  "BLD_A1",
  "BLD_B3",
  "BLD_Dormitory_Building.001",
  "BLD_Dormitory_Building.002",
  "BLD_B5_Greenhouse",
  "BLD_Dormitory_Building.003",
  "BLD_B2",
  "BLD_Dormitory_Building.004",
];

test("resolves all Legacy GLB nodes in raw and sanitized forms", () => {
  for (const rawName of glbNodeNames) {
    for (const name of [rawName, rawName.replaceAll(".", "").replaceAll(" ", "_")]) {
      const meta = resolveBuildingMeta(name, options);
      if (rawName === "BLD_C1.001") {
        assert.equal(meta, null, `${name} is blocked`);
        continue;
      }
      assert.ok(meta, `${name} should resolve`);
      assert.equal(meta.elementId.startsWith("BLD_"), true, name);
      assert.ok(meta.label, `${name} should have a Korean label`);
      assert.equal(meta.label.startsWith("BLD_"), false, name);
    }
  }
});

test("resolves node suffixes without truncating real building digits", () => {
  assert.deepEqual(resolveBuildingMeta("BLD_C1.001", options), null);
  assert.deepEqual(resolveBuildingMeta("BLD_C1001", options), null);
  assert.deepEqual(resolveBuildingMeta("BLD_A10", options), {
    elementId: "BLD_A10",
    label: elementNames.get("BLD_A10"),
  });
});

test("provides Korean labels for special GLB node names", () => {
  assert.equal(resolveBuildingMeta("BLD_B5_Greenhouse", options).label, "생명산업과학대학 온실");
  assert.equal(resolveBuildingMeta("BLD_Dormitory_Building.001", options).label, "학생생활관");
  assert.equal(resolveBuildingMeta("BLD_Training Lab Building", options).label, "실습관");
});

test("keeps unknown labels null and rejects non-building names", () => {
  assert.deepEqual(resolveBuildingMeta("BLD_UNKNOWN", options), {
    elementId: "BLD_UNKNOWN",
    label: null,
  });
  assert.equal(resolveBuildingMeta("terrain", options), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import commonElements from "../../../common/data/common_elemetns.json" with { type: "json" };
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { resolveBuildingMeta } from "../utils/buildingLabels.mjs";
import {
  autoShortName,
  buildLabelRegistry,
  clusterLabelFor,
  LANDMARK_IDS,
  PRESET_SHORT_NAMES,
  ZONES,
} from "./labelRegistry.mjs";

const elements = commonElements.elements;
const elementNames = new Map(elements.map(({ element_id: id, name }) => [id, name]));
const plain = (elementId, position = [0, 0, 0]) => ({
  name: elementId,
  elementId,
  displayName: elementNames.get(elementId) ?? null,
  dataElementId: elementId,
  proxy: false,
  position,
});
const proxy = (name, label, extras = {}) => ({ name, elementId: name, displayName: label, proxy: true, extras, position: [0, 0, 0] });
const dorm = (suffix) => ({
  name: `BLD_Dormitory_Building${suffix}`,
  elementId: `BLD_Dormitory_Building${suffix}`,
  displayName: "학생생활관",
  dataElementId: `BLD_Dormitory_Building${suffix}`,
  proxy: false,
  position: [10, 0, 10],
});

const anchors = [
  ...["BLD_C1", "BLD_E1", "BLD_A1", "BLD_D4", "BLD_B2", "BLD_B1", "BLD_B3"].map((id) => plain(id)),
  proxy("BLD_SCNU_E2", "E2 기초교육관", { nameSource: "SCNU registry E2 (w1.scnu.ac.kr)" }),
  ...["BLD_D1", "BLD_D2", "BLD_D3", "BLD_E3", "BLD_A10"].map((id) => plain(id, [4, 0, 8])),
  // GLB 꼬리 순서와 다르게 넣어도 번호는 꼬리 순서를 따른다.
  dorm("003"), dorm(""), dorm("004"), dorm("001"), dorm("002"),
  { name: "BLD_B5_Greenhouse", elementId: "BLD_B5_Greenhouse", displayName: "생명산업과학대학 온실", dataElementId: "BLD_B5_Greenhouse", proxy: false, position: [0, 0, 0] },
  proxy("BLD_SCNU_R688057", "A1 대학본부 부속동 (추정)", { nameSource: "estimated: 부속동 of A1" }),
  proxy("BLD_SCNU_R688980", "A16 교직원테니스장 부속 시설 (추정)"),
  proxy("BLD_SCNU_R138317", "A16 교직원테니스장 부속 시설 (추정)"),
  proxy("BLD_SCNU_R69065", "A15 운동장 본부석 (추정)"),
  proxy("BLD_SCNU_A12", "A12 우정원", { nameSource: "SCNU registry A12 (w1.scnu.ac.kr)" }),
  { name: "BLD_Unknown_Thing", elementId: "BLD_Unknown_Thing", displayName: null, dataElementId: "BLD_Unknown_Thing", proxy: false, position: [0, 0, 0] },
];
const registry = buildLabelRegistry({ elements, anchors, presets: CAMERA_PRESETS });
const entry = (id) => registry.get(id);

test("every landmark id names a building in common_elemetns.json", () => {
  assert.equal(LANDMARK_IDS.length, 8);
  for (const id of LANDMARK_IDS) assert.ok(elementNames.get(id), `${id} has no name`);
});

test("tier 1 = landmark ids, matched through the proxy data element id too", () => {
  const landmarks = [...registry.values()].filter((e) => e.tier === 1).map((e) => e.elementId).sort();
  assert.deepEqual(landmarks, ["BLD_A1", "BLD_B1", "BLD_B2", "BLD_B3", "BLD_C1", "BLD_D4", "BLD_E1", "BLD_SCNU_E2"]);
  assert.equal(entry("BLD_SCNU_E2").displayName, "기초교육관");
  assert.equal(entry("BLD_SCNU_E2").code, "E2");
});

test("tier 3 = BLD_SCNU_R* proxies, 부속 시설 / 온실 / 본부석 names and estimated names", () => {
  for (const id of ["BLD_SCNU_R688057", "BLD_SCNU_R688980", "BLD_SCNU_R69065", "BLD_B5_Greenhouse", "BLD_Unknown_Thing"]) {
    assert.equal(entry(id).tier, 3, id);
  }
});

test("tier 2 = every other named building", () => {
  for (const id of ["BLD_D1", "BLD_D2", "BLD_E3", "BLD_A10", "BLD_SCNU_A12", "BLD_Dormitory_Building"]) {
    assert.equal(entry(id).tier, 2, id);
  }
});

test("tier 0 = the seven zones, each with a position", () => {
  const zones = [...registry.values()].filter((e) => e.tier === 0);
  assert.equal(zones.length, 7);
  assert.deepEqual(zones.map((z) => z.displayName), ZONES.map((z) => z.name));
  assert.deepEqual(entry("ZONE_gate").position, CAMERA_PRESETS.find((p) => p.id === "gate").target);
  assert.deepEqual(entry("ZONE_engineering").position, [3, 0, 6]);
});

test("zone membership follows the preset focus ids, every dormitory and 운동장 names", () => {
  assert.equal(entry("BLD_D4").zone, "공과대학");
  assert.equal(entry("BLD_E3").zone, "사범대학·인문예술");
  assert.equal(entry("BLD_B5_Greenhouse").zone, "생명산업과학대학");
  assert.equal(entry("BLD_C1").zone, "도서관 일대");
  assert.equal(entry("BLD_Dormitory_Building004").zone, "본부·생활관");
  assert.equal(entry("BLD_SCNU_R69065").zone, "운동장");
  assert.equal(entry("BLD_SCNU_E2").zone, null);
});

test("dormitory blocks are numbered by GLB suffix order and share the dormitory group", () => {
  const ids = ["", "001", "002", "003", "004"].map((s) => `BLD_Dormitory_Building${s}`);
  assert.deepEqual(ids.map((id) => entry(id).displayName), [1, 2, 3, 4, 5].map((n) => `학생생활관 ${n}동`));
  for (const id of ids) assert.equal(entry(id).group, "dormitory");
  assert.equal(clusterLabelFor("dormitory", 5), "학생생활관 5동");
  assert.equal(clusterLabelFor("교직원테니스장 부속 시설", 2), "교직원테니스장 부속 시설 2곳");
});

test("(추정) is stripped from displayName and sets estimatedName; the leading registry code goes too", () => {
  assert.equal(entry("BLD_SCNU_R688057").displayName, "대학본부 부속동");
  assert.equal(entry("BLD_SCNU_R688057").estimatedName, true);
  assert.equal(entry("BLD_SCNU_R69065").displayName, "운동장 본부석");
  assert.equal(entry("BLD_D4").estimatedName, false);
});

test("an unknown anchor has no name, is tier 3 and estimated, and gets no search aliases", () => {
  assert.deepEqual(
    { tier: entry("BLD_Unknown_Thing").tier, estimatedName: entry("BLD_Unknown_Thing").estimatedName, displayName: entry("BLD_Unknown_Thing").displayName, aliases: entry("BLD_Unknown_Thing").aliases },
    { tier: 3, estimatedName: true, displayName: null, aliases: [] },
  );
  assert.equal([...registry.values()].some((e) => e.aliases.includes("BLD_Unknown_Thing")), false);
});

test("no two entries share a displayName unless they share a group", () => {
  const seen = new Map();
  for (const e of registry.values()) {
    if (!e.displayName) continue;
    const other = seen.get(e.displayName);
    if (other) assert.ok(other.group && other.group === e.group, `${other.elementId} and ${e.elementId} share ${e.displayName}`);
    seen.set(e.displayName, e);
  }
  assert.equal(entry("BLD_SCNU_R688980").group, "교직원테니스장 부속 시설");
});

test("codes come from BLD_<code> ids, prefixed ids and proxy data element ids", () => {
  assert.equal(entry("BLD_D4").code, "D4");
  assert.equal(entry("BLD_B5_Greenhouse").code, "B5");
  assert.equal(entry("BLD_SCNU_A12").code, "A12");
  assert.equal(entry("BLD_SCNU_A12").dataElementId, "BLD_A12");
  assert.equal(entry("BLD_SCNU_R688057").code, null);
  assert.equal(entry("BLD_Dormitory_Building").code, null);
});

test("D4 reads 공과대학 3호관 with the preset short name 공대 3호관", () => {
  assert.equal(entry("BLD_D4").displayName, "공과대학 3호관");
  assert.equal(entry("BLD_D4").shortName, "공대 3호관");
});

test("preset short names are at most 8 characters and name every preset", () => {
  for (const preset of CAMERA_PRESETS) {
    const short = PRESET_SHORT_NAMES[preset.id];
    assert.ok(short, preset.id);
    assert.ok(short.length <= 8, `${preset.id}: ${short}`);
  }
  assert.equal(entry("ZONE_engineering").shortName, "공대");
  assert.equal(entry("ZONE_humanities").shortName, "인문·사범");
});

test("automatic short names drop 대학/학교 word suffixes only when longer than 8 characters", () => {
  assert.equal(autoShortName("공과대학 3호관"), "공과대학 3호관");
  assert.equal(autoShortName("생명산업과학대학 2호관"), "생명산업과학 2호관");
  assert.equal(autoShortName("순천대학교 어린이집"), "순천대 어린이집");
  assert.equal(autoShortName("사범대학·인문예술"), "사범·인문예술");
  assert.equal(autoShortName(null), null);
});

test("aliases carry codes, 공대 for the D block, 도서관 and 학관", () => {
  assert.ok(entry("BLD_D2").aliases.includes("공대"));
  assert.ok(entry("BLD_D4").aliases.includes("D4"));
  assert.ok(entry("BLD_C1").aliases.includes("도서관"));
  assert.ok(entry("BLD_E1").aliases.includes("학관"));
  assert.equal(entry("BLD_A1").aliases.includes("공대"), false);
});

test("the registry does not mutate its inputs", () => {
  const input = anchors.map((a) => ({ ...a }));
  const snapshot = JSON.stringify(input);
  buildLabelRegistry({ elements, anchors: input, presets: CAMERA_PRESETS });
  assert.equal(JSON.stringify(input), snapshot);
});

test("resolveBuildingMeta returns the registry entry when a registry is given", () => {
  const meta = resolveBuildingMeta("BLD_D4", { elementNames, registry });
  assert.equal(meta.elementId, "BLD_D4");
  assert.equal(meta.label, "공과대학 3호관");
  assert.equal(meta.code, "D4");
  assert.equal(meta.tier, 1);
  assert.deepEqual(resolveBuildingMeta("BLD_D4", { elementNames }), { elementId: "BLD_D4", label: "공과대학 3호관" });
});

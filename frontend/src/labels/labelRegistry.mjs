import { resolveProxyDataElementId } from "../utils/buildingLabels.mjs";

// 캠퍼스 라벨·검색·인스펙터가 함께 쓰는 건물 이름 레지스트리. 한 건물에는 이름이 하나다:
// displayName(인스펙터·제목), shortName(칩·시점 버튼), code(배지, 예: D4). tier는 줌 단계별로 보일지 정하는 계층이다.
//   0 구역(건물이 아닌 단과대·기능 구역 이름), 1 랜드마크, 2 일반 건물, 3 부속 시설·명칭 추정 시설.
// anchors는 CityModel의 라벨 앵커({ name, displayName, elementId, dataElementId?, proxy?, extras?, position? })이고,
// elements는 common_elemetns.json의 요소 목록, presets는 cameraPresets.mjs의 CAMERA_PRESETS다.

export const LANDMARK_IDS = Object.freeze(["BLD_C1", "BLD_E1", "BLD_A1", "BLD_D4", "BLD_B2", "BLD_B1", "BLD_B3", "BLD_E2"]);

// 구역 이름과, 그 구역에 속하는 건물을 고르는 시점(focus 목록). 운동장은 이름으로, 정문은 정문 시점의 목표점으로 정한다.
export const ZONES = Object.freeze([
  { id: "ZONE_engineering", name: "공과대학", presetId: "engineering" },
  { id: "ZONE_humanities", name: "사범대학·인문예술", presetId: "humanities" },
  { id: "ZONE_life-science", name: "생명산업과학대학", presetId: "life-science" },
  { id: "ZONE_headquarters", name: "본부·생활관", presetId: "headquarters", includeDormitories: true },
  { id: "ZONE_library", name: "도서관 일대", presetId: "library" },
  { id: "ZONE_field", name: "운동장", nameContains: "운동장" },
  { id: "ZONE_gate", name: "정문", presetId: "gate", synthetic: true },
]);

// 시점 버튼과 그 시점에 해당하는 구역·건물이 함께 쓰는 짧은 이름.
export const PRESET_SHORT_NAMES = Object.freeze({
  overview: "전체",
  gate: "정문",
  d4: "공대 3호관",
  engineering: "공대",
  library: "도서관",
  "life-science": "생명대",
  headquarters: "본부",
  humanities: "인문·사범",
});

const SHORT_NAME_MAX = 8;
const DORMITORY_GROUP = "dormitory";
const DORMITORY_PATTERN = /^BLD_Dormitory_Building(?:_?(\d+))?$/;
const ANNEX_PROXY_PATTERN = /^BLD_SCNU_R/;
const TIER3_NAME_WORDS = ["부속 시설", "온실", "본부석"];
const ESTIMATED_SUFFIX = /\s*\(추정\)\s*$/;
const LEADING_CODE = /^[A-F]\d{1,2}\s+/;
const CODE_FROM_ID = /^BLD_([A-F]\d{1,2})(?:_|$)/;
const COLLEGE_WORD_SUFFIX = /(대학|학교)(?=$|[\s·])/g;
const ALIAS_BY_CODE_PREFIX = Object.freeze({ D: ["공대"] });
const ALIAS_BY_ID = Object.freeze({ BLD_C1: ["도서관"], BLD_E1: ["학관"] });

// 이름이 8자를 넘으면 '대학'·'학교'로 끝나는 낱말에서 그 꼬리를 뗀다(사범대학·인문예술 -> 사범·인문예술).
export function autoShortName(displayName) {
  if (typeof displayName !== "string") return null;
  if (displayName.length <= SHORT_NAME_MAX) return displayName;
  return displayName.replace(COLLEGE_WORD_SUFFIX, "").replace(/\s+/g, " ").trim();
}

// 묶음(group) 하나를 칩 하나로 접을 때의 이름.
export function clusterLabelFor(group, count, displayName = group) {
  return group === DORMITORY_GROUP ? `학생생활관 ${count}동` : `${displayName} ${count}곳`;
}

function codeOf(elementId, dataElementId, elementNames) {
  for (const id of [elementId, dataElementId]) {
    const code = CODE_FROM_ID.exec(id ?? "")?.[1];
    if (code && elementNames.has(`BLD_${code}`)) return code;
  }
  return null;
}

// 표시 이름: 기존 요소와 연결된 대리 노드는 요소 이름, 그 밖에는 앵커 라벨에서 앞의 대장 코드와 '(추정)'을 뗀 이름.
function nameOf(anchor, dataElementId, elementNames) {
  const raw = anchor.proxy && !anchor.displayName?.endsWith(" · 공사 중") && elementNames.has(dataElementId) && dataElementId !== anchor.elementId
    ? elementNames.get(dataElementId)
    : anchor.displayName;
  if (typeof raw !== "string" || raw.trim() === "" || raw.startsWith("BLD_")) return { displayName: null, estimated: true };
  const estimated = ESTIMATED_SUFFIX.test(raw);
  return { displayName: raw.replace(ESTIMATED_SUFFIX, "").replace(LEADING_CODE, "").trim(), estimated };
}

function tierOf(anchor, displayName, estimatedName, dataElementId) {
  if (LANDMARK_IDS.includes(anchor.elementId) || LANDMARK_IDS.includes(dataElementId)) return 1;
  if (ANNEX_PROXY_PATTERN.test(anchor.elementId) || estimatedName) return 3;
  if (TIER3_NAME_WORDS.some((word) => displayName.includes(word))) return 3;
  return 2;
}

function centroid(points) {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return sum.map((value) => value / points.length);
}

function zoneMembers(zone, entries, presets) {
  if (zone.nameContains) return entries.filter((entry) => entry.displayName?.includes(zone.nameContains));
  const focus = new Set(presets.find((preset) => preset.id === zone.presetId)?.focus ?? []);
  return entries.filter(
    (entry) =>
      focus.has(entry.anchorName) ||
      focus.has(entry.elementId) ||
      (zone.includeDormitories && entry.group === DORMITORY_GROUP),
  );
}

export function buildLabelRegistry({ elements = [], anchors = [], presets = [] } = {}) {
  const elementNames = new Map(elements.map(({ element_id: id, name }) => [id, name]));
  const entries = [];

  for (const anchor of anchors) {
    const dataElementId =
      anchor.dataElementId ??
      (anchor.proxy ? resolveProxyDataElementId(anchor.name, anchor.extras, elementNames) : null) ??
      anchor.elementId;
    const code = codeOf(anchor.elementId, dataElementId, elementNames);
    const { displayName, estimated } = nameOf(anchor, dataElementId, elementNames);
    const dormitory = DORMITORY_PATTERN.exec(anchor.elementId) ?? DORMITORY_PATTERN.exec(anchor.name ?? "");
    entries.push({
      elementId: anchor.elementId,
      dataElementId,
      anchorName: anchor.name ?? anchor.elementId,
      code,
      displayName,
      shortName: null,
      tier: displayName === null ? 3 : tierOf(anchor, displayName, estimated, dataElementId),
      group: dormitory ? DORMITORY_GROUP : null,
      dormitoryOrder: dormitory ? Number(dormitory[1] ?? 0) : null,
      zone: null,
      estimatedName: estimated,
      aliases: [],
      position: anchor.position ?? null,
    });
  }

  // 학생생활관 동은 GLB 이름 꼬리 순서(없음, 001, 002 ...)로 1동부터 번호를 붙인다.
  entries
    .filter((entry) => entry.group === DORMITORY_GROUP)
    .sort((a, b) => a.dormitoryOrder - b.dormitoryOrder)
    .forEach((entry, index) => {
      entry.displayName = `학생생활관 ${index + 1}동`;
    });

  // 이름이 같은 나머지 건물(같은 시설의 부속 시설 여러 채)은 그 이름으로 묶는다.
  const byName = new Map();
  for (const entry of entries) {
    if (entry.group || entry.displayName === null) continue;
    byName.set(entry.displayName, [...(byName.get(entry.displayName) ?? []), entry]);
  }
  for (const [name, same] of byName) if (same.length > 1) for (const entry of same) entry.group = name;

  const zoneEntries = [];
  for (const zone of ZONES) {
    const members = zone.synthetic ? [] : zoneMembers(zone, entries, presets);
    for (const member of members) member.zone ??= zone.name;
    const target = presets.find((preset) => preset.id === zone.presetId)?.target ?? null;
    const shortName = PRESET_SHORT_NAMES[zone.presetId] ?? autoShortName(zone.name);
    zoneEntries.push({
      elementId: zone.id,
      dataElementId: null,
      code: null,
      displayName: zone.name,
      shortName,
      tier: 0,
      group: null,
      zone: null,
      estimatedName: false,
      aliases: [...new Set([zone.name, shortName])],
      position: zone.synthetic ? (target ? [...target] : null) : centroid(members.map((m) => m.position).filter(Boolean)),
    });
  }

  const presetShortById = new Map(
    presets
      .filter((preset) => preset.focus?.length === 1 && PRESET_SHORT_NAMES[preset.id])
      .map((preset) => [preset.focus[0], PRESET_SHORT_NAMES[preset.id]]),
  );

  const registry = new Map();
  for (const entry of entries) {
    const { anchorName, dormitoryOrder, ...rest } = entry;
    rest.shortName = presetShortById.get(entry.elementId) ?? autoShortName(entry.displayName);
    rest.aliases =
      entry.displayName === null
        ? []
        : [
            ...new Set(
              [
                entry.displayName,
                rest.shortName,
                entry.code,
                ...(ALIAS_BY_CODE_PREFIX[entry.code?.[0]] ?? []),
                ...(ALIAS_BY_ID[entry.elementId] ?? ALIAS_BY_ID[entry.dataElementId] ?? []),
              ].filter(Boolean),
            ),
          ];
    registry.set(entry.elementId, rest);
  }
  for (const zone of zoneEntries) registry.set(zone.elementId, zone);
  return registry;
}

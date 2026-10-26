const BUILDING_ID_PATTERN = /^BLD_[A-Z]\d+$/;
const GLTF_SUFFIX_PATTERN = /^(BLD_[A-Z]\d+)\.00\d+$/;
const SANITIZED_SUFFIX_PATTERN = /^(BLD_[A-Z]\d+)00\d+$/;

const PROXY_NAME_PREFIX = "BLD_SCNU_";

// uni.glb에서 물려받은 노드 BLD_A12와 BLD_A12.001은 실제로 A17 체육관·A18 체육관 증축동 자리다
// (list.do의 A17·A18 점이 그 바닥면 안, VR scene_a17 "체육관", 같은 VWorld LOD4 모델 SC030058을 VWorld 쪽은 이미 A17로 연다).
// 요소 BLD_A12는 list.do A12 우정원이 맞으므로(BLD_SCNU_A12 대리 노드가 그 건물) 요소는 그대로 두고 이 노드만 BLD_A17로 잇는다.
// 노드 이름은 바꾸지 않는다. 키는 점·공백을 뺀 이름이다(BLD_A12.001 -> BLD_A12001).
const NODE_ELEMENT_OVERRIDES = new Map([
  ["BLD_A12", "BLD_A17"],
  ["BLD_A12001", "BLD_A17"],
]);
const REGISTRY_CODE_PATTERN = /^[A-F]\d{1,2}$/;
const REGISTRY_SOURCE_PATTERN = /^SCNU registry ([A-F]\d{1,2})\b/;

// 생성기의 선택 대리 노드(BLD_SCNU_*) 중 학교 건물 대장 코드(extras.nameSource "SCNU registry A6 ...", 또는
// 노드 이름 BLD_SCNU_A6)가 기존 백엔드 요소(BLD_A6)와 같으면, 미기후·팝업 데이터를 그 요소 id로 요청한다.
// 대장 코드가 없는 추정 부속 시설(BLD_SCNU_R*)은 연결하지 않는다(null). 노드 id 자체는 바꾸지 않는다.
export function resolveProxyDataElementId(nodeName, extras, elementNames) {
  if (typeof nodeName !== "string" || !nodeName.startsWith(PROXY_NAME_PREFIX)) return null;
  const fromSource = REGISTRY_SOURCE_PATTERN.exec(extras?.nameSource ?? "")?.[1];
  const fromName = nodeName.slice(PROXY_NAME_PREFIX.length);
  const code = fromSource ?? (REGISTRY_CODE_PATTERN.test(fromName) ? fromName : null);
  if (!code) return null;
  const elementId = `BLD_${code}`;
  return elementNames?.has(elementId) ? elementId : null;
}

function getMappedId(rawName, buildingMap) {
  if (buildingMap instanceof Map) {
    return buildingMap.get(rawName);
  }
  return buildingMap?.[rawName];
}

// registry(labels/labelRegistry.mjs의 buildLabelRegistry 결과)를 넘기면 그 건물의 레지스트리 항목에
// elementId·label을 얹어 돌려준다(label = 레지스트리의 displayName). 넘기지 않으면 { elementId, label }만 돌려준다.
export function resolveBuildingMeta(
  rawName,
  { elementNames, buildingMap, blockedIds, registry } = {},
) {
  if (typeof rawName !== "string" || !rawName.startsWith("BLD_")) return null;

  const normalizedName = rawName.replaceAll(".", "").replaceAll(" ", "_");
  if (blockedIds?.has(rawName) || blockedIds?.has(normalizedName)) return null;

  const dormitory = /^BLD_Dormitory_Building(?:_?\d+)?$/.test(normalizedName);
  const trainingLab = /^BLD_Training_Lab_Building$/.test(normalizedName);
  const greenhouse = normalizedName === "BLD_B5_Greenhouse";

  let elementId = rawName;
  const override = NODE_ELEMENT_OVERRIDES.get(normalizedName);
  const gltfSuffix = rawName.match(GLTF_SUFFIX_PATTERN);
  const sanitizedSuffix = normalizedName.match(SANITIZED_SUFFIX_PATTERN);
  const candidateId =
    gltfSuffix?.[1] ??
    sanitizedSuffix?.[1] ??
    (BUILDING_ID_PATTERN.test(normalizedName) ? normalizedName : null);

  if (override && elementNames?.has(override)) {
    elementId = override;
  } else if (candidateId && elementNames?.has(candidateId)) {
    elementId = candidateId;
  } else {
    const mappedId = getMappedId(rawName, buildingMap);
    if (mappedId) elementId = mappedId;
  }

  if (blockedIds?.has(elementId)) return null;

  let label = dormitory
    ? "학생생활관"
    : trainingLab
      ? "실습관"
      : greenhouse
        ? "생명산업과학대학 온실"
        : elementNames?.get(elementId) ?? null;

  if (typeof label === "string" && label.startsWith("BLD_")) label = null;

  const entry = registry?.get(elementId);
  if (entry) return { ...entry, elementId, label: entry.displayName ?? label };
  return { elementId, label };
}

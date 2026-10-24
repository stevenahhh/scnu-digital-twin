const BUILDING_ID_PATTERN = /^BLD_[A-Z]\d+$/;
const GLTF_SUFFIX_PATTERN = /^(BLD_[A-Z]\d+)\.00\d+$/;
const SANITIZED_SUFFIX_PATTERN = /^(BLD_[A-Z]\d+)00\d+$/;

const PROXY_NAME_PREFIX = "BLD_SCNU_";
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

export function resolveBuildingMeta(
  rawName,
  { elementNames, buildingMap, blockedIds } = {},
) {
  if (typeof rawName !== "string" || !rawName.startsWith("BLD_")) return null;

  const normalizedName = rawName.replaceAll(".", "").replaceAll(" ", "_");
  if (blockedIds?.has(rawName) || blockedIds?.has(normalizedName)) return null;

  const dormitory = /^BLD_Dormitory_Building(?:_?\d+)?$/.test(normalizedName);
  const trainingLab = /^BLD_Training_Lab_Building$/.test(normalizedName);
  const greenhouse = normalizedName === "BLD_B5_Greenhouse";

  let elementId = rawName;
  const gltfSuffix = rawName.match(GLTF_SUFFIX_PATTERN);
  const sanitizedSuffix = normalizedName.match(SANITIZED_SUFFIX_PATTERN);
  const candidateId =
    gltfSuffix?.[1] ??
    sanitizedSuffix?.[1] ??
    (BUILDING_ID_PATTERN.test(normalizedName) ? normalizedName : null);

  if (candidateId && elementNames?.has(candidateId)) {
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

  return { elementId, label };
}

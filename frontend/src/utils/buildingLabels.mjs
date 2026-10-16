const BUILDING_ID_PATTERN = /^BLD_[A-Z]\d+$/;
const GLTF_SUFFIX_PATTERN = /^(BLD_[A-Z]\d+)\.00\d+$/;
const SANITIZED_SUFFIX_PATTERN = /^(BLD_[A-Z]\d+)00\d+$/;

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

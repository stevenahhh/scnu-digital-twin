// 건물 검색(이름·짧은 이름·코드·별칭·구역 이름). registry는 buildLabelRegistry 결과(또는 그 항목 배열)다.
// 순위: 앞부분 일치 > 중간 일치 > 별칭 일치, 같은 순위 안에서는 계층(구역 0 ... 부속 3)과 이름 순. 최대 8개.
// 맞는 것이 없으면 가장 가까운 이름(편집 거리 2 이하)을 제안한다.

export const SEARCH_LIMIT = 8;
export const SEARCH_GROUPS = Object.freeze([
  { id: "landmark", label: "주요 건물", tiers: [1] },
  { id: "building", label: "건물", tiers: [2] },
  { id: "annex", label: "부속 시설", tiers: [3] },
  { id: "zone", label: "구역", tiers: [0] },
]);

const normalize = (value) => String(value ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, "");

function entriesOf(registry) {
  const list = registry instanceof Map ? [...registry.values()] : registry ?? [];
  return list.filter((entry) => entry?.displayName);
}

function scoreOf(entry, query) {
  const primary = [entry.displayName, entry.shortName, entry.code].filter(Boolean).map(normalize);
  if (primary.some((name) => name.startsWith(query))) return 0;
  if (primary.some((name) => name.includes(query))) return 1;
  const aliases = (entry.aliases ?? []).map(normalize);
  if (aliases.some((alias) => alias.includes(query))) return 2;
  return null;
}

export function groupOf(entry) {
  return SEARCH_GROUPS.find((group) => group.tiers.includes(entry.tier))?.id ?? "building";
}

export function searchBuildings(query, registry, { limit = SEARCH_LIMIT } = {}) {
  const q = normalize(query);
  if (!q) return [];
  const matches = [];
  for (const entry of entriesOf(registry)) {
    const score = scoreOf(entry, q);
    if (score !== null) matches.push({ entry, score });
  }
  matches.sort((a, b) => a.score - b.score || a.entry.tier - b.entry.tier || a.entry.displayName.localeCompare(b.entry.displayName, "ko"));
  return matches.slice(0, limit).map(({ entry }) => entry);
}

export function editDistance(a, b) {
  const s = [...a];
  const t = [...b];
  let previous = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= t.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[t.length];
}

// 맞는 건물이 없을 때 제안할 이름(표시 이름). 이름·짧은 이름·별칭 중 편집 거리 2 이하로 가장 가까운 것.
export function suggestBuilding(query, registry, { maxDistance = 2 } = {}) {
  const q = normalize(query);
  if (!q) return null;
  let best = null;
  for (const entry of entriesOf(registry)) {
    for (const name of new Set([entry.displayName, entry.shortName, ...(entry.aliases ?? [])].filter(Boolean))) {
      const distance = editDistance(q, normalize(name));
      if (distance <= maxDistance && (!best || distance < best.distance)) best = { name, distance, entry };
    }
  }
  return best ? best.name : null;
}

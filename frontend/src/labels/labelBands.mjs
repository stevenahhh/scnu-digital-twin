import { clusterLabelFor } from "./labelRegistry.mjs";

// 캠퍼스 라벨의 줌 단계(band), 단계별 개수 상한·글자 크기, 우선순위, 300 ms 유지 규칙(hysteresis)을 정하는 순수 함수.
// DOM·three.js·타이머를 쓰지 않는다. 시간은 호출하는 쪽이 now(ms)로 넘긴다.
// 거리는 OrbitControls의 카메라-목표점 거리(장면 단위), 기울기는 수평면에서 내려다보는 각도(도)다.

export const FAR_DISTANCE = 300;
export const NEAR_DISTANCE = 150;
export const STREET_PITCH_DEGREES = 25;
export const STREET_RADIUS = 120;
export const HOLD_MS = 300;

const BANDS = Object.freeze({
  far: { tiersShown: [0, 1], dotTiers: [2], clusterGroups: true, cap: 14, tierCaps: { 0: 6, 1: 8 }, chipPx: 12, zonePx: 14, leader: false },
  mid: { tiersShown: [1, 2], dotTiers: [3], clusterGroups: true, cap: 20, tierCaps: null, chipPx: 13, zonePx: 14, leader: false },
  near: { tiersShown: [1, 2, 3], dotTiers: [], clusterGroups: false, cap: 30, tierCaps: null, chipPx: 13, zonePx: 14, leader: false },
  street: { tiersShown: [1, 2], dotTiers: [], clusterGroups: false, cap: 8, tierCaps: null, chipPx: 14, zonePx: 14, leader: true },
});

const half = (value) => Math.max(1, Math.floor(value / 2));

function bandName({ distance, pitchDegrees, presetFromGround }) {
  if (presetFromGround || pitchDegrees <= STREET_PITCH_DEGREES) return "street";
  if (distance > FAR_DISTANCE) return "far";
  if (distance >= NEAR_DISTANCE) return "mid";
  return "near";
}

// touch: 칩 14 px 이상, 상한 절반. presentation: 상한 절반, 점 표시 없음, 글자 1.5배.
export function resolveLabelBand({ distance, pitchDegrees, presetFromGround = false, presentation = false, touch = false }) {
  const band = bandName({ distance, pitchDegrees, presetFromGround });
  const base = BANDS[band];
  let { cap, tierCaps, chipPx, zonePx, dotTiers } = base;
  const halvings = (touch ? 1 : 0) + (presentation ? 1 : 0);
  for (let i = 0; i < halvings; i += 1) {
    cap = half(cap);
    tierCaps = tierCaps && Object.fromEntries(Object.entries(tierCaps).map(([tier, value]) => [tier, half(value)]));
  }
  if (touch) chipPx = Math.max(chipPx, 14);
  if (presentation) {
    chipPx *= 1.5;
    zonePx *= 1.5;
    dotTiers = [];
  }
  return {
    band,
    presentation,
    cap,
    tierCaps,
    chipPx,
    zonePx,
    tiersShown: [...base.tiersShown],
    dotTiers: [...dotTiers],
    clusterGroups: base.clusterGroups,
    leader: base.leader,
    streetRadius: band === "street" ? STREET_RADIUS : null,
  };
}

function compareRank(a, b) {
  if (a.selected !== b.selected) return a.selected ? -1 : 1;
  if (a.attention !== b.attention) return a.attention ? -1 : 1;
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (Boolean(a.hasData) !== Boolean(b.hasData)) return a.hasData ? -1 : 1;
  if (a.distance !== b.distance) return a.distance - b.distance;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// candidates: [{ id, tier, hasData, distance, inFront? }]. 단계에 맞지 않는 후보는 빼고, 남은 후보에 kind('chip'|'dot')를 붙여
// 우선순위 순(선택 > 호버·포커스 > 계층 > 데이터 있음 > 가까움 > id)으로 돌려준다. 선택·호버·포커스 후보는 늘 칩이다.
// street 단계에서는 카메라 앞쪽(inFront !== false)이고 STREET_RADIUS 안인 후보만 칩으로 남긴다.
export function rankLabelCandidates(candidates, band, { selectedId = null, hoveredId = null, focusedId = null } = {}) {
  const ranked = [];
  for (const candidate of candidates) {
    const selected = candidate.id === selectedId;
    const attention = candidate.id === hoveredId || candidate.id === focusedId;
    let kind = null;
    if (selected || attention || band.tiersShown.includes(candidate.tier)) kind = "chip";
    else if (band.dotTiers.includes(candidate.tier)) kind = "dot";
    if (!kind) continue;
    if (band.streetRadius !== null && !selected && !attention) {
      // 랜드마크(계층 1)는 반경 밖이어도 남는다: 정문 시점에서도 도서관 같은 길잡이 건물이 보인다(AUDIT GAP-37). 상한은 그대로다.
      if (candidate.inFront === false || (candidate.distance > band.streetRadius && candidate.tier !== 1)) continue;
    }
    ranked.push({ ...candidate, kind, selected, attention });
  }
  return ranked.sort(compareRank);
}

// 상한(cap, 계층별 tierCaps) 안에 드는 칩 id를 우선순위 순으로 고른다.
function desiredChips(ranked, band) {
  const desired = [];
  const perTier = new Map();
  for (const candidate of ranked) {
    if (candidate.kind !== "chip") continue;
    if (desired.length >= band.cap && !candidate.selected) continue;
    const tierCap = band.tierCaps?.[candidate.tier];
    const used = perTier.get(candidate.tier) ?? 0;
    if (tierCap !== undefined && used >= tierCap && !candidate.selected) continue;
    perTier.set(candidate.tier, used + 1);
    desired.push(candidate.id);
  }
  return desired;
}

// 300 ms 유지 규칙. previousVisible은 이전 호출이 돌려준 state(처음이면 null)다.
// 보이던 칩은 상한 밖으로 밀린 지 holdMs가 지나야 빠지고, 숨어 있던 칩은 빈자리가 holdMs 동안 이어져야 나타난다.
// 단계가 바뀌면 유지 없이 바로 새 단계의 칩을 쓴다. 선택된 칩은 기다리지 않는다. 점(dot)은 유지 규칙 없이 모두 돌려준다.
// 반환: { visible: 칩 id[] (우선순위 순), dots: 점 id[], state }.
export function applyHysteresis({ ranked, previousVisible = null, now, holdMs = HOLD_MS, band }) {
  const desired = desiredChips(ranked, band);
  const desiredSet = new Set(desired);
  const order = new Map(ranked.map((candidate, index) => [candidate.id, index]));
  const chipIds = new Set(ranked.filter((candidate) => candidate.kind === "chip").map((candidate) => candidate.id));
  const selectedIds = new Set(ranked.filter((candidate) => candidate.selected).map((candidate) => candidate.id));
  const dots = ranked.filter((candidate) => candidate.kind === "dot").map((candidate) => candidate.id);

  if (!previousVisible || previousVisible.band !== band.band) {
    return {
      visible: desired,
      dots,
      state: { band: band.band, visible: new Map(desired.map((id) => [id, { outrankedSince: null }])), pending: new Map() },
    };
  }

  const visible = new Map();
  for (const [id, slot] of previousVisible.visible) {
    if (!chipIds.has(id)) continue;
    if (desiredSet.has(id)) {
      visible.set(id, { outrankedSince: null });
      continue;
    }
    const outrankedSince = slot.outrankedSince ?? now;
    if (now - outrankedSince < holdMs) visible.set(id, { outrankedSince });
  }

  const pending = new Map();
  for (const id of desired) {
    if (visible.has(id)) continue;
    if (selectedIds.has(id)) {
      visible.set(id, { outrankedSince: null });
      continue;
    }
    const since = previousVisible.pending.get(id) ?? now;
    if (now - since >= holdMs && visible.size < band.cap) visible.set(id, { outrankedSince: null });
    else pending.set(id, since);
  }

  // 선택된 칩을 바로 넣느라 상한을 넘으면, 밀려난 채 유지 중인 칩부터 낮은 순위 순으로 뺀다.
  const held = [...visible.keys()].filter((id) => !desiredSet.has(id)).sort((a, b) => order.get(b) - order.get(a));
  while (visible.size > band.cap && held.length > 0) visible.delete(held.shift());

  return {
    visible: [...visible.keys()].sort((a, b) => order.get(a) - order.get(b)),
    dots,
    state: { band: band.band, visible, pending },
  };
}

// far·mid 단계에서 같은 group의 후보를 칩 하나로 합친다(학생생활관 5동, 위치 = 구성원 위치의 평균).
// 합친 후보: id `GROUP_<group>`, tier = 구성원 최소, hasData = 하나라도 있음, distance = 최소, members = 구성원 id.
export function clusterGroups(entries, band) {
  if (!band.clusterGroups) return entries.map((entry) => ({ ...entry }));
  const groups = new Map();
  for (const entry of entries) {
    if (entry.group) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  }
  const out = [];
  const emitted = new Set();
  for (const entry of entries) {
    const members = entry.group ? groups.get(entry.group) : null;
    if (!members || members.length === 1) {
      out.push({ ...entry });
      continue;
    }
    if (emitted.has(entry.group)) continue;
    emitted.add(entry.group);
    const positions = members.map((m) => m.position).filter(Boolean);
    out.push({
      id: `GROUP_${entry.group}`,
      group: entry.group,
      displayName: clusterLabelFor(entry.group, members.length, entry.displayName),
      tier: Math.min(...members.map((m) => m.tier)),
      hasData: members.some((m) => m.hasData),
      distance: Math.min(...members.map((m) => m.distance ?? Infinity)),
      position: positions.length
        ? positions[0].map((_, axis) => positions.reduce((sum, p) => sum + p[axis], 0) / positions.length)
        : null,
      members: members.map((m) => m.id),
    });
  }
  return out;
}

import { applyHysteresis } from "./labelBands.mjs";

// 화면 좌표(px)에서 캠퍼스 라벨 칩과 점을 겹치지 않게 놓는 순수 함수. DOM·three.js를 쓰지 않고 입력을 바꾸지 않는다.
// 칩은 앵커 점 위에 가운데 맞춤으로 6 px 띄워 놓고(translate(-50%, -100% - 6px)), 다른 칩과 겹치면 화면 위로 4 px씩
// maxDisplacement까지 올려 보며, 올린 칩은 앵커까지 연결선(leader)을 긋는다. 패널(occluder)·HUD(chrome)와의 여백(chromeMargin)을
// 침범하는 칩은 자르지 않고 숨긴다. HUD에 걸린 칩은 숨기기 전에 아래쪽으로 비켜 본다. 화면 가장자리 여백(edgeMargin)을 넘는 칩은
// 숨기지 않고 가장자리를 따라 안쪽으로 밀어 넣는다(EDGE_LEADER_PX 이상 밀리면 연결선). 밀어 넣은 뒤에도 더 높은 순위의 칩과 겹치거나,
// 앵커가 화면 밖·패널/HUD 밑이면 숨긴다.
// 사각형은 { left, top, right, bottom } 모양이다.

export const CHIP_GAP_PX = 6;
export const DISPLACEMENT_STEP_PX = 4;
export const DOT_SIZE_PX = 8;
// 가장자리 안쪽으로 밀어 넣은 칩은 가로로 이만큼 이상 밀렸을 때만 연결선을 긋는다(조금 밀린 칩은 여전히 앵커 바로 위에 있다).
// 세로로 옮긴 칩(위로 비키기, 위 가장자리에서 아래로 밀기)은 늘 연결선을 긋는다.
export const EDGE_LEADER_PX = 12;

const LAYOUT_DEFAULTS = Object.freeze({ edgeMargin: 8, chromeMargin: 12, spacing: 6, maxDisplacement: 24 });
// HUD 비켜 가기: 칩이 HUD 사각형(여백 포함)에 걸리면, 겹침 회피용 24 px 안에서 못 피할 때 그 HUD 바로 아래·위 자리까지
// 옮겨 본다(연결선으로 앵커를 가리킨다). 앵커 자체가 HUD 밑에 있으면 옮기지 않고 숨긴다. 연결선이 길어지지 않게 96 px까지.
const MAX_HUD_ESCAPE_PX = 96;

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inflate = (r, by) => ({ left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by });
const shift = (r, dy) => ({ left: r.left, top: r.top + dy, right: r.right, bottom: r.bottom + dy });
const contains = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

function chipRect({ anchor, width, height }) {
  const left = anchor.x - width / 2;
  const bottom = anchor.y - CHIP_GAP_PX;
  return { left, top: bottom - height, right: left + width, bottom };
}

function dotRect({ anchor }) {
  const r = DOT_SIZE_PX / 2;
  return { left: anchor.x - r, top: anchor.y - r, right: anchor.x + r, bottom: anchor.y + r };
}

// 선택·호버된 건물의 화면 경계 상자(depth = 카메라에서 그 건물까지 거리) 안에 투영되면서 그 건물보다 먼 앵커는
// 건물 뒤에 가려졌다고 본다(AUDIT 5.6의 건물 가림 근사). anchorScreen = { x, y, depth }.
export function isAnchorBehindSelectedBox(anchorScreen, selectedBox) {
  if (!anchorScreen || !selectedBox) return false;
  return contains(selectedBox, anchorScreen.x, anchorScreen.y) && anchorScreen.depth > selectedBox.depth;
}

const needsLeader = (rect, natural) => rect.top !== natural.top || Math.abs(rect.left - natural.left) >= EDGE_LEADER_PX;

function leaderFor(rect, anchor) {
  const x = (rect.left + rect.right) / 2;
  return { from: { x, y: rect.bottom <= anchor.y ? rect.bottom : rect.top }, to: { x: anchor.x, y: anchor.y } };
}

function fingerprintOf(placed) {
  return [...placed]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id, rect, state }) => `${id}:${[rect.left, rect.top, rect.right, rect.bottom].map(Math.round).join(",")}:${state}`)
    .join("|");
}

// candidates: rankLabelCandidates 결과 순서(우선순위)의 [{ id, kind: 'chip'|'dot', selected?, anchor: { x, y, depth? }, width, height }].
// opts: area(뷰포트), chrome(HUD 사각형 목록), occluder(열린 패널), focusBoxes(선택·호버 건물 상자 [{ id, left, top, right,
// bottom, depth }]), band(+ previous, now: 있으면 applyHysteresis로 보일 칩을 먼저 고른다), previous(직전 layoutLabels 결과).
// 반환: { placed: [{ id, kind, rect, leader, state }], hidden: Set, hiddenReasons: Map(id -> 'cap'|'edge'|'chrome'|'collision'),
//         leaders: [{ id, from, to }], fingerprint, state(다음 호출의 previous.state) }.
export function layoutLabels(candidates, opts) {
  const { area, chrome = [], occluder = null, focusBoxes = [], band = null, previous = null, now = 0, holdMs } = opts;
  const { edgeMargin, chromeMargin, spacing, maxDisplacement } = { ...LAYOUT_DEFAULTS, ...pickDefined(opts) };

  const safeArea = inflate(area, -edgeMargin);
  const blockers = [...(occluder ? [{ rect: inflate(occluder, chromeMargin), hud: false }] : []), ...chrome.map((r) => ({ rect: inflate(r, chromeMargin), hud: true, source: r }))];

  const chips = candidates.filter((c) => c.kind !== "dot");
  const dots = candidates.filter((c) => c.kind === "dot");
  const hidden = new Set();
  const hiddenReasons = new Map();
  const hide = (id, reason) => {
    hidden.add(id);
    hiddenReasons.set(id, reason);
  };

  let hysteresisState = null;
  let allowed = null;
  if (band) {
    const result = applyHysteresis({ ranked: chips, previousVisible: previous?.state ?? null, now, band, ...(holdMs === undefined ? {} : { holdMs }) });
    hysteresisState = result.state;
    allowed = new Set(result.visible);
  }

  // 가장자리 여백 안으로 가로·세로를 밀어 넣은 사각형(크기가 안전 영역보다 크면 왼쪽·위에 맞춘다).
  const clampIntoSafe = (r) => {
    const dx = Math.max(safeArea.left - r.left, Math.min(0, safeArea.right - r.right));
    const dy = Math.max(safeArea.top - r.top, Math.min(0, safeArea.bottom - r.bottom));
    return { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy };
  };
  const anchorShown = (a) =>
    a.x >= area.left && a.x <= area.right && a.y >= area.top && a.y <= area.bottom &&
    ![...(occluder ? [occluder] : []), ...chrome].some((r) => contains(r, a.x, a.y));
  const inSafeArea = (r) => r.left >= safeArea.left && r.top >= safeArea.top && r.right <= safeArea.right && r.bottom <= safeArea.bottom;
  const kept = [];
  const reasonAt = (r) => {
    if (!inSafeArea(r)) return "edge";
    if (blockers.some((b) => overlaps(b.rect, r))) return "chrome";
    if (kept.some((k) => overlaps(inflate(k, spacing), r))) return "collision";
    return null;
  };

  const placed = [];
  const order = [...chips.filter((c) => c.selected), ...chips.filter((c) => !c.selected)];
  for (const candidate of order) {
    if (allowed && !allowed.has(candidate.id) && !candidate.selected) {
      hide(candidate.id, "cap");
      continue;
    }
    const natural = chipRect(candidate);
    const offsets = [];
    for (let d = 0; d <= maxDisplacement; d += DISPLACEMENT_STEP_PX) offsets.push(-d);
    // HUD에 걸리면 숨기기 전에 아래쪽 자리(HUD 밑으로 비켜 가기)도 보고, 그래도 걸리면 그 HUD 바로 아래·위 자리를 본다.
    const hudHits = blockers.filter((b) => b.hud && overlaps(b.rect, natural));
    if (hudHits.length) {
      for (let d = DISPLACEMENT_STEP_PX; d <= maxDisplacement; d += DISPLACEMENT_STEP_PX) offsets.push(d);
      if (anchorShown(candidate.anchor)) {
        const escapes = hudHits.flatMap((b) => [b.rect.bottom - natural.top, b.rect.top - natural.bottom]);
        for (const dy of escapes.filter((d) => Math.abs(d) <= MAX_HUD_ESCAPE_PX).sort((a, b) => Math.abs(a) - Math.abs(b))) {
          if (!offsets.includes(dy)) offsets.push(dy);
        }
      }
    }
    let rect = null;
    for (const dy of offsets) {
      const r = shift(natural, dy);
      if (reasonAt(r) === null) {
        rect = r;
        break;
      }
    }
    // 가장자리에 걸려 둘 자리가 없으면 같은 후보 자리들을 가장자리 안으로 밀어 넣어 본다. 앵커가 보이는 곳에 있을 때만.
    const clampTried = !rect && anchorShown(candidate.anchor) && offsets.some((dy) => !inSafeArea(shift(natural, dy)));
    if (clampTried) {
      for (const dy of offsets) {
        const r = clampIntoSafe(shift(natural, dy));
        if (reasonAt(r) === null) {
          rect = r;
          break;
        }
      }
    }
    if (!rect && candidate.selected) {
      // 선택된 칩은 늘 남긴다. 둘 자리가 없으면 가장자리 안쪽으로 끌어들인다.
      rect = clampIntoSafe(natural);
    }
    if (!rect) {
      // 밀어 넣어 봤다면 숨기는 이유는 밀어 넣은 자리에서 막은 것(겹침·HUD)이다.
      hide(candidate.id, reasonAt(clampTried ? clampIntoSafe(natural) : natural));
      continue;
    }
    const displaced = needsLeader(rect, natural);
    kept.push(rect);
    const occluded = !candidate.selected && focusBoxes.some((box) => box.id !== candidate.id && isAnchorBehindSelectedBox(candidate.anchor, box));
    placed.push({
      id: candidate.id,
      kind: "chip",
      rect,
      leader: displaced ? leaderFor(rect, candidate.anchor) : null,
      state: candidate.selected ? "selected" : occluded ? "occluded" : "default",
    });
  }

  // 점은 칩과 겹치면 숨기되 점끼리는 겹쳐도 둔다.
  for (const candidate of dots) {
    const rect = dotRect(candidate);
    const reason = !inSafeArea(rect)
      ? "edge"
      : blockers.some((b) => overlaps(b.rect, rect))
        ? "chrome"
        : kept.some((k) => overlaps(k, rect))
          ? "collision"
          : null;
    if (reason) {
      hide(candidate.id, reason);
      continue;
    }
    const occluded = focusBoxes.some((box) => box.id !== candidate.id && isAnchorBehindSelectedBox(candidate.anchor, box));
    placed.push({ id: candidate.id, kind: "dot", rect, leader: null, state: occluded ? "occluded" : "dot" });
  }

  return {
    placed,
    hidden,
    hiddenReasons,
    leaders: placed.filter((p) => p.leader).map((p) => ({ id: p.id, ...p.leader })),
    fingerprint: fingerprintOf(placed),
    state: hysteresisState,
  };
}

function pickDefined({ edgeMargin, chromeMargin, spacing, maxDisplacement }) {
  return Object.fromEntries(Object.entries({ edgeMargin, chromeMargin, spacing, maxDisplacement }).filter(([, v]) => v !== undefined));
}

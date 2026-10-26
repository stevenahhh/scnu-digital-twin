import { applyHysteresis } from "./labelBands.mjs";

// 화면 좌표(px)에서 캠퍼스 라벨 칩과 점을 겹치지 않게 놓는 순수 함수. DOM·three.js를 쓰지 않고 입력을 바꾸지 않는다.
// 칩은 앵커 점 위에 가운데 맞춤으로 6 px 띄워 놓고(translate(-50%, -100% - 6px)), 다른 칩과 겹치면 화면 위로 4 px씩
// maxDisplacement까지 올려 보며, 올린 칩은 앵커까지 연결선(leader)을 긋는다. 화면 가장자리(edgeMargin), 패널(occluder)·
// HUD(chrome)와의 여백(chromeMargin)을 침범하는 칩은 자르지 않고 숨긴다. HUD에 걸린 칩은 숨기기 전에 아래쪽으로 비켜 본다.
// 사각형은 { left, top, right, bottom } 모양이다.

export const CHIP_GAP_PX = 6;
export const DISPLACEMENT_STEP_PX = 4;
export const DOT_SIZE_PX = 8;

const LAYOUT_DEFAULTS = Object.freeze({ edgeMargin: 8, chromeMargin: 12, spacing: 6, maxDisplacement: 24 });

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
    // HUD에 걸리면 숨기기 전에 아래쪽 자리(HUD 밑으로 비켜 가기)도 본다.
    if (blockers.some((b) => b.hud && overlaps(b.rect, natural))) {
      for (let d = DISPLACEMENT_STEP_PX; d <= maxDisplacement; d += DISPLACEMENT_STEP_PX) offsets.push(d);
    }
    let rect = null;
    let displaced = false;
    for (const dy of offsets) {
      const r = shift(natural, dy);
      if (reasonAt(r) === null) {
        rect = r;
        displaced = dy !== 0;
        break;
      }
    }
    if (!rect && candidate.selected) {
      // 선택된 칩은 늘 남긴다. 둘 자리가 없으면 가장자리 안쪽으로 끌어들인다.
      const dx = Math.max(safeArea.left - natural.left, Math.min(0, safeArea.right - natural.right));
      const dy = Math.max(safeArea.top - natural.top, Math.min(0, safeArea.bottom - natural.bottom));
      rect = { left: natural.left + dx, top: natural.top + dy, right: natural.right + dx, bottom: natural.bottom + dy };
      displaced = dx !== 0 || dy !== 0;
    }
    if (!rect) {
      hide(candidate.id, reasonAt(natural));
      continue;
    }
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

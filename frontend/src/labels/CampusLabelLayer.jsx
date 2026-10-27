import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DotMarker, SceneLabel, ZoneLabel } from "../ui/SceneLabel.jsx";
import { HOLD_MS, clusterGroups, rankLabelCandidates } from "./labelBands.mjs";
import { layoutLabels } from "./labelLayout.mjs";
import { clusterLabelFor } from "./labelRegistry.mjs";

// 캠퍼스 건물 이름표 한 장(오버레이). 건물마다 drei <Html>을 하나씩 두던 방식을 대신한다.
// 노드는 레지스트리 id마다 한 번만 만들고(풀), 프레임마다 위치(transform)·보임(visibility)만 직접 쓴다. React가 다시 그리는 것은
// 선택·호버·포커스, 칩/점 종류, 우선순위 순서(= Tab 순서)가 바뀔 때뿐이다. 계층·상한·충돌 규칙은 labelBands/labelLayout이 정한다.
// 화면 좌표는 모두 뷰포트(client) px이고, 쓸 때 area.left/top을 빼서 이 층 안의 좌표로 바꾼다.

const GROUP_PREFIX = "GROUP_";
const ESTIMATED_SUFFIX = ", 명칭 추정";

const PARKED_TRANSFORM = "translate3d(-10000px, -10000px, 0)";
const SLOT_STYLE = Object.freeze({ position: "absolute", left: 0, top: 0, visibility: "hidden", pointerEvents: "none", transform: PARKED_TRANSFORM });
const LEADER_STYLE = Object.freeze({ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", visibility: "hidden" });

function accessibleNameOf(slot) {
  const base = `${slot.code ? `${slot.code} ` : ""}${slot.displayName}`;
  return slot.estimatedName ? `${base}${ESTIMATED_SUFFIX}` : base;
}

// 레지스트리 항목과 묶음(group) 칩을 한 목록의 슬롯으로 만든다. 묶음 칩 이름의 개수는 묶음 전체 구성원 수다.
function buildSlots(entries) {
  const slots = [];
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.displayName) continue;
    slots.push({ ...entry, id: entry.elementId, kind: entry.tier === 0 ? "zone" : "chip" });
    if (entry.group) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  }
  for (const [group, members] of groups) {
    if (members.length < 2) continue;
    slots.push({
      id: `${GROUP_PREFIX}${group}`,
      elementId: null,
      group,
      members: members.map((m) => m.elementId),
      displayName: clusterLabelFor(group, members.length, members[0].displayName),
      shortName: null,
      code: null,
      tier: Math.min(...members.map((m) => m.tier)),
      estimatedName: false,
      hasData: members.some((m) => m.hasData),
      kind: "chip",
      cluster: true,
    });
  }
  return slots;
}

function defaultMeasure(slotElement) {
  const hit = slotElement.firstElementChild;
  const chip = slotElement.querySelector('[data-qa="label-chip"]') ?? hit;
  return {
    width: chip?.offsetWidth ?? 0,
    height: chip?.offsetHeight ?? 0,
    hitWidth: hit?.offsetWidth ?? 0,
    hitHeight: hit?.offsetHeight ?? 0,
  };
}

function sameView(a, b) {
  if (a.order.length !== b.order.length) return false;
  for (let i = 0; i < a.order.length; i += 1) if (a.order[i] !== b.order[i]) return false;
  const keys = Object.keys(b.kinds);
  if (keys.length !== Object.keys(a.kinds).length) return false;
  return keys.every((key) => a.kinds[key] === b.kinds[key]);
}

// entries: 레지스트리 항목 배열(+ hasData). controllerRef.current는 { update(frame), setMotion(on), setHovered(id) }를 받는다.
// frame = { points: Map(id -> { x, y, depth, distance }) (카메라 앞·지형에 가리지 않은 앵커만), area, chrome, occluder,
//           focusBoxes, band, now, motion, hidden }.
// 카메라가 움직이는 동안 칩(누르는 영역)을 둘 화면 가장자리 여백(labelLayout의 edgeMargin과 같다).
const MOTION_EDGE_PX = 8;

export function CampusLabelLayer({
  entries,
  selectedId = null,
  hoveredId: hoveredProp = null,
  headlineById = null,
  onSelect,
  onSelectCluster,
  onClear,
  onRequestPass,
  controllerRef,
  measure = defaultMeasure,
}) {
  const slots = useMemo(() => buildSlots(entries ?? []), [entries]);
  const slotById = useMemo(() => new Map(slots.map((slot) => [slot.id, slot])), [slots]);
  const [view, setView] = useState({ order: [], kinds: {} });
  const [hoveredLocal, setHoveredLocal] = useState(null);
  const [focusedId, setFocusedId] = useState(null);
  const rootRef = useRef(null);
  const nodesRef = useRef(new Map());
  const leadersRef = useRef(new Map());
  const sizeCacheRef = useRef(new Map());
  const lastRef = useRef({ layout: null, placed: new Map(), fingerprint: "" });
  const viewRef = useRef(view);
  const lastDetailRef = useRef(1);
  const holdTimerRef = useRef(null);
  const hoveredId = hoveredLocal ?? hoveredProp;
  const rankState = useRef({ selectedId, hoveredId, focusedId });
  rankState.current = { selectedId, hoveredId, focusedId };
  const callbacks = useRef({});
  callbacks.current = { onSelect, onSelectCluster, onClear, onRequestPass, measure };

  // 다시 그린 뒤에는 칩 크기가 바뀌었을 수 있으니 재어 둔 크기를 버리고 배치를 한 번 더 요청한다.
  useLayoutEffect(() => {
    viewRef.current = view;
    sizeCacheRef.current.clear();
    callbacks.current.onRequestPass?.();
  }, [view, selectedId, hoveredId, focusedId, slots, headlineById]);

  useLayoutEffect(() => {
    // 숨긴 칩은 층 밖으로 옮겨 둔다. 마지막 자리(또는 한 번도 놓이지 않은 칩의 0,0 = HUD 밑)에 남아 있으면 HUD 아래에
    // 숨은 칩처럼 보이고 재기도 그렇게 잰다. 숨긴 이유(cap·edge·chrome·collision·inactive)는 data-hidden-reason에 남긴다.
    const hideNode = (id, reason = "inactive") => {
      const node = nodesRef.current.get(id);
      if (node) {
        if (node.style.visibility !== "hidden") {
          node.style.visibility = "hidden";
          node.style.pointerEvents = "none";
        }
        if (node.style.transform !== PARKED_TRANSFORM) node.style.transform = PARKED_TRANSFORM;
        if (node.dataset.hiddenReason !== reason) node.dataset.hiddenReason = reason;
        if (node.dataset.anchorTop !== undefined) delete node.dataset.anchorTop;
        if (node.dataset.anchorLeft !== undefined) delete node.dataset.anchorLeft;
      }
      const leader = leadersRef.current.get(id);
      if (leader && leader.style.visibility !== "hidden") leader.style.visibility = "hidden";
    };
    const hideAll = () => {
      for (const id of nodesRef.current.keys()) hideNode(id);
      lastRef.current = { layout: null, placed: new Map(), fingerprint: "" };
    };
    const sizeOf = (id) => {
      const cached = sizeCacheRef.current.get(id);
      if (cached) return cached;
      const node = nodesRef.current.get(id);
      const size = node ? callbacks.current.measure(node) : { width: 0, height: 0, hitWidth: 0, hitHeight: 0 };
      sizeCacheRef.current.set(id, size);
      return size;
    };
    // anchor: the building anchor's client point. Written as data-anchor-left/top so screen QA can measure the chip-to-anchor
    // gap and find the building under a displaced chip.
    const writeSlot = (id, x, y, area, leader, opacity, anchor) => {
      const node = nodesRef.current.get(id);
      if (!node) return;
      for (const [key, value] of [["anchorTop", anchor?.y], ["anchorLeft", anchor?.x]]) {
        const text = Number.isFinite(value) ? String(Math.round(value)) : undefined;
        if (node.dataset[key] === text) continue;
        if (text === undefined) delete node.dataset[key];
        else node.dataset[key] = text;
      }
      const transform = `translate3d(${Math.round(x - area.left)}px, ${Math.round(y - area.top)}px, 0)`;
      if (node.style.transform !== transform) node.style.transform = transform;
      if (node.style.visibility !== "visible") node.style.visibility = "visible";
      if (node.dataset.hiddenReason) delete node.dataset.hiddenReason;
      const slot = slotById.get(id);
      const pointer = slot?.kind === "zone" ? "none" : "auto";
      if (node.style.pointerEvents !== pointer) node.style.pointerEvents = pointer;
      const nextOpacity = opacity === 1 ? "" : String(opacity);
      // 고른·올린 건물 뒤로 가려진 앵커의 칩(흐리게 그린다). 화면 검사가 가림 판정을 읽는다(V-F-55).
      const occluded = opacity < 1 ? "true" : "false";
      if (node.dataset.occluded !== occluded) node.dataset.occluded = occluded;
      if (node.style.opacity !== nextOpacity) node.style.opacity = nextOpacity;
      const line = leadersRef.current.get(id);
      if (!line) return;
      if (!leader) {
        if (line.style.visibility !== "hidden") line.style.visibility = "hidden";
        return;
      }
      line.style.visibility = "visible";
      const segment = line.firstElementChild;
      segment.setAttribute("x1", String(Math.round(leader.from.x - area.left)));
      segment.setAttribute("y1", String(Math.round(leader.from.y - area.top)));
      segment.setAttribute("x2", String(Math.round(leader.to.x - area.left)));
      segment.setAttribute("y2", String(Math.round(leader.to.y - area.top)));
      // 앵커 점: 가장자리로 밀려난 칩도 어느 건물을 가리키는지 보이게 한다.
      const dot = segment.nextElementSibling;
      dot.setAttribute("cx", String(Math.round(leader.to.x - area.left)));
      dot.setAttribute("cy", String(Math.round(leader.to.y - area.top)));
    };

    const update = (frame) => {
      if (frame.hidden) {
        hideAll();
        return;
      }
      const { band, area } = frame;
      // 줌 단계를 층에 남겨 화면 검사(QA)가 읽을 수 있게 한다.
      if (rootRef.current && rootRef.current.dataset.band !== band.band) rootRef.current.dataset.band = band.band;
      // 발표 모드: 칩 글자를 띠의 chipPx(보통의 1.5배)로 키운다(index.css가 data-presentation일 때만 이 값을 쓴다).
      if (rootRef.current) {
        const presenting = String(Boolean(band.presentation));
        if (rootRef.current.dataset.presentation !== presenting) rootRef.current.dataset.presentation = presenting;
        rootRef.current.style.setProperty("--label-chip-px", `${band.chipPx}px`);
      }
      const { selectedId: selected, hoveredId: hovered, focusedId: focused } = rankState.current;
      const base = [];
      for (const slot of slots) {
        if (slot.cluster) continue;
        const point = frame.points.get(slot.id);
        if (!point) continue;
        base.push({
          id: slot.id,
          tier: slot.tier,
          hasData: slot.hasData,
          distance: point.distance,
          inFront: true,
          // 선택된 건물은 묶음 칩에 숨지 않는다.
          group: slot.id === selected ? null : slot.group,
          displayName: slot.displayName,
          position: [point.x, point.y, point.depth],
        });
      }
      const clustered = clusterGroups(base, band);
      const anchorOf = new Map(clustered.map((c) => [c.id, { x: c.position[0], y: c.position[1], depth: c.position[2] }]));

      // 카메라가 움직이는 동안: 보이던 칩 묶음과 앵커로부터의 상대 위치를 그대로 두고 앵커만 따라간다(보임/숨김을 바꾸지 않는다).
      if (frame.motion && lastRef.current.layout) {
        for (const [id, offset] of lastRef.current.placed) {
          const anchor = anchorOf.get(id);
          if (!anchor) {
            hideNode(id);
            continue;
          }
          // 움직이는 동안에도 칩(누르는 영역)은 화면 가장자리 여백 안에 둔다. 밖으로 미끄러지는 칩은 숨기지 않고(보임이 바뀌지 않게)
          // 가장자리에 붙여 연결선으로 앵커를 가리킨다. 멈추면 다시 배치한다.
          const size = sizeOf(id);
          const rawX = anchor.x + offset.dx;
          const rawY = anchor.y + offset.dy;
          const x = Math.min(Math.max(rawX, area.left + MOTION_EDGE_PX), Math.max(area.left + MOTION_EDGE_PX, area.right - MOTION_EDGE_PX - size.hitWidth));
          const y = Math.min(Math.max(rawY, area.top + MOTION_EDGE_PX), Math.max(area.top + MOTION_EDGE_PX, area.bottom - MOTION_EDGE_PX - size.hitHeight));
          const clamped = x !== rawX || y !== rawY;
          const leader = clamped
            ? { from: { x: x + size.hitWidth / 2, y: y + (size.hitHeight + size.height) / 2 }, to: anchor }
            : offset.leader
              ? { from: { x: anchor.x + offset.leader.fx, y: anchor.y + offset.leader.fy }, to: anchor }
              : null;
          writeSlot(id, x, y, area, leader, offset.opacity, anchor);
        }
        return;
      }

      const ranked = rankLabelCandidates(clustered, band, { selectedId: selected, hoveredId: hovered, focusedId: focused });
      const candidates = [];
      for (const candidate of ranked) {
        if (!nodesRef.current.has(candidate.id)) continue;
        const size = sizeOf(candidate.id);
        // 계층(tier)은 단계별 계층 상한(tierCaps)에 쓰인다.
        candidates.push({
          id: candidate.id,
          kind: candidate.kind,
          tier: candidate.tier,
          selected: candidate.selected,
          anchor: anchorOf.get(candidate.id),
          width: size.width,
          height: size.height,
          // 누르는 영역(버튼)이 보이는 칩보다 큰 만큼. 가장자리·HUD 여백은 버튼까지 지킨다.
          hitPad: { x: Math.max(0, (size.hitWidth - size.width) / 2), y: Math.max(0, (size.hitHeight - size.height) / 2) },
        });
      }
      const result = layoutLabels(candidates, {
        area,
        chrome: frame.chrome ?? [],
        occluder: frame.occluder ?? null,
        focusBoxes: frame.focusBoxes ?? [],
        band,
        previous: lastRef.current.layout,
        now: frame.now,
      });

      const placed = new Map();
      for (const item of result.placed) {
        const size = sizeOf(item.id);
        const anchor = anchorOf.get(item.id);
        const cx = (item.rect.left + item.rect.right) / 2;
        const cy = (item.rect.top + item.rect.bottom) / 2;
        // 누르는 영역(버튼)이 보이는 칩보다 클 수 있다. 버튼 가운데를 칩 사각형 가운데에 맞춘다.
        const x = cx - size.hitWidth / 2;
        const y = cy - size.hitHeight / 2;
        const opacity = item.state === "occluded" ? 0.6 : 1;
        placed.set(item.id, {
          dx: x - anchor.x,
          dy: y - anchor.y,
          opacity,
          leader: item.leader ? { fx: item.leader.from.x - anchor.x, fy: item.leader.from.y - anchor.y } : null,
        });
        if (result.fingerprint !== lastRef.current.fingerprint) writeSlot(item.id, x, y, area, item.leader, opacity, anchor);
      }
      if (result.fingerprint !== lastRef.current.fingerprint) {
        for (const id of nodesRef.current.keys()) if (!placed.has(id)) hideNode(id, result.hiddenReasons.get(id) ?? "inactive");
      }
      lastRef.current = { layout: result, placed, fingerprint: result.fingerprint };

      // 300 ms 유지 규칙은 시간이 지나야 결론이 난다(빈자리를 기다리는 칩, 밀려난 채 남아 있는 칩). 요청 렌더 루프는 카메라가
      // 멈추면 프레임을 더 그리지 않으므로, 기다리는 칩이 있으면 유지 시간이 지난 뒤 배치를 한 번 더 요청한다.
      const waiting =
        (result.state?.pending?.size ?? 0) > 0 ||
        [...(result.state?.visible?.values() ?? [])].some((slot) => slot.outrankedSince !== null);
      if (waiting && !holdTimerRef.current) {
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          callbacks.current.onRequestPass?.();
        }, HOLD_MS + 16);
      }

      // Tab 순서 = DOM 순서 = 우선순위. 보이는 칩의 순서나 칩/점 종류가 바뀔 때만 다시 그린다(순위 자체가 300 ms 유지 규칙을 거친다).
      // 순서에는 호버·포커스를 넣지 않는다. 포커스를 받은 칩이 앞으로 옮겨 가면 다음 Tab이 이미 지나온 칩으로 돌아간다.
      const kinds = {};
      for (const candidate of ranked) kinds[candidate.id] = candidate.kind;
      const tabRanked = rankLabelCandidates(clustered, band, { selectedId: selected });
      const next = { order: tabRanked.filter((c) => placed.has(c.id)).map((c) => c.id), kinds };
      if (!sameView(viewRef.current, next)) {
        viewRef.current = next;
        setView(next);
      }
    };

    const controller = {
      update,
      setMotion(on) {
        const root = rootRef.current;
        if (root) root.dataset.motion = on ? "true" : "false";
      },
      setHovered(id) {
        setHoveredLocal(id ?? null);
      },
    };
    if (controllerRef) controllerRef.current = controller;
    return () => {
      if (controllerRef?.current === controller) controllerRef.current = null;
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    };
  }, [controllerRef, slots, slotById]);

  // Esc: 캔버스나 라벨에 포커스가 있을 때(또는 아무 데도 없을 때) 선택을 푼다.
  useEffect(() => {
    if (!selectedId) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const active = document.activeElement;
      const inLayer = active && rootRef.current?.contains(active);
      if (!inLayer && active && active !== document.body && active.tagName !== "CANVAS") return;
      callbacks.current.onClear?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId]);

  const ordered = useMemo(() => {
    const rank = new Map(view.order.map((id, index) => [id, index]));
    return [...slots].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  }, [slots, view.order]);

  const selectedSlot = selectedId ? slotById.get(selectedId) : null;

  const registerNode = (id) => (element) => {
    if (element) nodesRef.current.set(id, element);
    else nodesRef.current.delete(id);
  };
  const registerLeader = (id) => (element) => {
    if (element) leadersRef.current.set(id, element);
    else leadersRef.current.delete(id);
  };

  const stateOf = (slot) => {
    if (slot.id === selectedId) return "selected";
    if (slot.id === hoveredId) return "hover";
    if (selectedId) return "dimmed";
    if (!slot.hasData && !slot.cluster) return "no-data";
    return "idle";
  };

  const handleChipClick = (slot) => (event) => {
    if (slot.cluster) callbacks.current.onSelectCluster?.(slot, event);
    else callbacks.current.onSelect?.(slot, event);
  };

  return (
    <div
      ref={rootRef}
      data-qa="campus-label-layer"
      data-motion="false"
      className="pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-state data-[motion=true]:opacity-40 motion-reduce:transition-none"
      onFocus={(event) => setFocusedId(event.target.closest?.("[data-label-slot]")?.dataset.labelSlot ?? null)}
      onBlur={() => setFocusedId(null)}
    >
      {ordered.map((slot) => {
        const kind = slot.kind === "zone" ? "zone" : view.kinds[slot.id] === "dot" ? "dot" : "chip";
        // 건물 칩은 어디서나 같은 한 이름(displayName, AUDIT GAP-12). 구역·묶음 칩만 짧은 이름을 쓴다.
        const name = kind === "zone" || slot.cluster ? slot.shortName ?? slot.displayName : slot.displayName;
        return (
          <Fragment key={slot.id}>
          <svg ref={registerLeader(slot.id)} aria-hidden="true" data-qa="label-leader" width="1" height="1" style={LEADER_STYLE} className="text-hairline-strong">
            <line x1="0" y1="0" x2="0" y2="0" stroke="currentColor" strokeWidth="1" />
            <circle data-qa="label-anchor-dot" cx="0" cy="0" r="2.5" fill="currentColor" />
          </svg>
          <div
            ref={registerNode(slot.id)}
            data-label-slot={slot.id}
            data-kind={kind}
            style={SLOT_STYLE}
            onPointerEnter={(event) => event.pointerType === "mouse" && kind !== "zone" && setHoveredLocal(slot.id)}
            onPointerLeave={(event) => event.pointerType === "mouse" && setHoveredLocal((current) => (current === slot.id ? null : current))}
            onClickCapture={(event) => {
              lastDetailRef.current = event.detail;
            }}
          >
            {kind === "zone" ? (
              <ZoneLabel name={slot.displayName} />
            ) : kind === "dot" ? (
              <DotMarker
                name={accessibleNameOf(slot)}
                elementId={slot.id}
                selected={slot.id === selectedId}
                onSelect={() => callbacks.current.onSelect?.(slot, { detail: lastDetailRef.current })}
              />
            ) : (
              <SceneLabel
                name={name}
                elementId={slot.cluster ? undefined : slot.id}
                data-cluster={slot.cluster ? slot.group : undefined}
                tier={slot.tier}
                state={stateOf(slot)}
                code={slot.code ?? undefined}
                estimatedName={slot.estimatedName}
                value={headlineById?.[slot.id] ?? undefined}
                aria-label={accessibleNameOf(slot)}
                onClick={handleChipClick(slot)}
              />
            )}
          </div>
          </Fragment>
        );
      })}
      <div data-qa="label-live" aria-live="polite" className="sr-only">
        {selectedSlot ? `선택: ${selectedSlot.displayName}` : ""}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import commonElements from "../../../common/data/common_elemetns.json";
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { CampusLabelLayer } from "../labels/CampusLabelLayer.jsx";
import { resolveLabelBand } from "../labels/labelBands.mjs";
import { SETTLE_MS } from "../labels/motionSettle.mjs";
import { CAMPUS_GLTF_OVERLAY_CONFIG } from "./campusGltfOverlay.mjs";
import { buildVWorldLabelEntries, glbNodeBoxes, readGlbJson } from "./labelAnchors.mjs";
import { createVWorldLabelProjector } from "./labelProjection.mjs";

// campus-buildings.glb 단위(Main 장면과 같이 1 m = 0.6242 units)와 모델 끝 사각형의 여유.
const MODEL_UNITS_PER_METER = 0.62421715;
const FOOTPRINT_CLEARANCE_METERS = 60;

// 앞 렌더에서도 카메라가 움직였고 그 간격이 이보다 짧으면 이어지는 움직임(끌기·휠·비행)으로 본다. 단추·키 한 단계 이동은
// 한 프레임만 바뀌므로 라벨 층을 흐리지 않는다.
const CONTINUOUS_MOVE_GAP_MS = 100;
// 이보다 멀리서 보면(지구본·시군 단위 시점, 장면 단위 약 6.4 km) 캠퍼스가 점 하나라 라벨을 모두 숨긴다.
export const VWORLD_MAX_LABEL_DISTANCE = 4000;

// data-label-chrome-layer가 붙은 요소는 통과용 레이어로 보고 그 안의 자식 사각형을 쓴다(겹겹이 붙어 있으면 더 들어간다).
function collectChromeRects(element, out) {
  if (element.hasAttribute?.("data-label-chrome-layer")) {
    for (const child of element.children) collectChromeRects(child, out);
    return;
  }
  const rect = element.getBoundingClientRect();
  if (rect.right > rect.left && rect.bottom > rect.top) out.push(rect);
}

const rectKey = (rect) => `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}`;

// VWorld 지도 위의 건물 라벨: Main와 같은 CampusLabelLayer(계층·충돌 배치·12 px 하한·움직이는 동안 흐림)를
// Cesium 카메라 투영(labelProjection)으로 그린다. scene: Cesium Scene. getModelMatrix: 캠퍼스 GLB 오버레이 위치.
// onSelectEntry(entry, event)는 칩을 눌렀을 때, onSelectCluster(members)는 묶음 칩을 눌렀을 때 부른다.
export function VWorldLabelLayer({
  Cesium,
  scene,
  getModelMatrix,
  selectedId = null,
  // 지도에서 마우스를 올린 건물(그 칩이 떠오른다).
  hoveredId = null,
  hidden = false,
  presentation = false,
  occluderRef = null,
  // 지금 시점이 땅 높이 시점(정문)이면 Main처럼 거리 단계(street)로 1단 건물을 멀리까지 남긴다.
  presetFromGround = false,
  chromeRefs = [],
  onSelectEntry,
  onSelectCluster,
  onClear,
  // 앵커를 읽은 뒤 레지스트리 항목 목록을 한 번 알린다(검색칸이 같은 항목을 쓴다).
  onEntries,
  // 읽은 campus-buildings.glb의 JSON을 한 번 알린다(카메라 시점이 노드 경계 상자를 쓴다).
  onGlb,
  loadGlb = defaultLoadGlb,
}) {
  const [entries, setEntries] = useState(null);
  const controllerRef = useRef(null);
  const passesRef = useRef(2);
  const frameKeyRef = useRef("");
  const motionRef = useRef(false);
  const settleTimerRef = useRef(null);
  const lastPoseRef = useRef(null);
  const footprintRef = useRef(null);
  const hostRef = useRef(null);
  const onGlbRef = useRef(onGlb);
  onGlbRef.current = onGlb;
  const state = useRef({});
  state.current = { selectedId, hidden, presentation, occluderRef, chromeRefs, presetFromGround };

  useEffect(() => {
    let cancelled = false;
    loadGlb(CAMPUS_GLTF_OVERLAY_CONFIG.url)
      .then((buffer) => {
        if (cancelled) return;
        const json = readGlbJson(buffer);
        // 캠퍼스 모델이 끝나는 사각형(모델 좌표): 모든 노드 경계 상자의 수평 범위에 여유를 더하고, 높이는 가장 낮은 곳.
        // VWorld의 모델은 건물만 있고 바닥판이 없다(바닥은 지도 영상이 끊김 없이 잇는다). 경계 상자 그대로면 가장 바깥
        // 건물 벽이 모서리에 걸쳐 화면 검사가 벽과 지도의 밝기 차를 모델 가장자리로 읽으므로, 바깥 건물 너머 60 m를 둔다.
        const clearance = FOOTPRINT_CLEARANCE_METERS * MODEL_UNITS_PER_METER;
        let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let minY = Infinity;
        for (const [min, max] of glbNodeBoxes(json).values()) {
          minX = Math.min(minX, min[0]); maxX = Math.max(maxX, max[0]); minZ = Math.min(minZ, min[2]); maxZ = Math.max(maxZ, max[2]); minY = Math.min(minY, min[1]);
        }
        minX -= clearance; maxX += clearance; minZ -= clearance; maxZ += clearance;
        footprintRef.current = Number.isFinite(minX)
          ? [[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]].map((position, i) => ({ elementId: `edge${i}`, position }))
          : null;
        setEntries(buildVWorldLabelEntries({ json, elements: commonElements.elements, presets: CAMERA_PRESETS }));
        onGlbRef.current?.(json);
      })
      .catch((error) => {
        // 라벨 앵커 없이도 지도는 쓸 수 있다(SDK 건물 클릭·D4 표지는 그대로).
        if (!cancelled) console.warn("Campus label anchors could not be loaded.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [loadGlb]);

  const onEntriesRef = useRef(onEntries);
  onEntriesRef.current = onEntries;
  useEffect(() => {
    if (entries) onEntriesRef.current?.(entries);
  }, [entries]);

  const entryById = useMemo(() => new Map((entries ?? []).map((entry) => [entry.elementId, entry])), [entries]);
  const selectedAnchorId = selectedId && entryById.has(selectedId) ? selectedId : null;

  // 지도가 다시 그릴 때마다(Cesium postRender) 카메라·화면 사각형이 바뀌었는지 보고, 바뀐 뒤 두 번만 배치한다.
  useEffect(() => {
    if (!scene || !Cesium || !entries) return undefined;
    const projector = createVWorldLabelProjector({ Cesium, scene, getModelMatrix });
    const touch = globalThis.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    const requestRender = () => scene.requestRender?.();
    // 카메라가 이어서 움직이는 동안 라벨 층을 흐리고 배치를 멈춘다. 마지막 움직임에서 정착 시간(--motion-settle)이 지나면 한 번 다시 배치한다.
    let lastMoveAt = -Infinity;
    const scheduleSettle = () => {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        motionRef.current = false;
        controllerRef.current?.setMotion(false);
        passesRef.current = 2;
        frameKeyRef.current = "";
        requestRender();
      }, SETTLE_MS);
    };
    const noteCameraMove = (now) => {
      if (!motionRef.current && now - lastMoveAt < CONTINUOUS_MOVE_GAP_MS) {
        motionRef.current = true;
        controllerRef.current?.setMotion(true);
      }
      lastMoveAt = now;
      if (motionRef.current) scheduleSettle();
    };
    // 화면 사각형(지도 캔버스, 패널, 크롬)은 크기·전환이 바뀌었을 때와 카메라가 멈춰 있을 때만 다시 잰다.
    // 비행·끌기 중 매 프레임 강제 레이아웃을 하지 않는다.
    let rects = null;
    const markRectsDirty = () => {
      rects = null;
      requestRender();
    };
    const measureRects = () => {
      const { occluderRef: occluderSource, chromeRefs: chromeSources } = state.current;
      const area = scene.canvas.getBoundingClientRect();
      const panelRect = occluderSource?.current?.getBoundingClientRect() ?? null;
      const chrome = [];
      for (const ref of chromeSources ?? []) if (ref?.current) collectChromeRects(ref.current, chrome);
      return { area, panelRect, chrome };
    };
    const onPostRender = () => {
      const controller = controllerRef.current;
      if (!controller) return;
      const { selectedId: selected, hidden: isHidden, presentation: presenting } = state.current;
      if (!rects || !motionRef.current) rects = measureRects();
      const { area, panelRect } = rects;
      const chrome = [...rects.chrome];
      const occluder =
        panelRect && panelRect.left < area.right && panelRect.right > area.left && panelRect.top < area.bottom && panelRect.bottom > area.top
          ? panelRect
          : null;
      // 지도 영역 바로 옆(12 px 안)에 붙은 패널·레일은 가리개는 아니지만 칩이 12 px 떨어져야 하는 경계다(HUD와 같은 여백).
      if (panelRect && !occluder && panelRect.width > 0 && panelRect.height > 0 && panelRect.top < area.bottom && panelRect.bottom > area.top
        && panelRect.left < area.right + 12 && panelRect.right > area.left - 12) chrome.push(panelRect);
      const camera = scene.camera;
      const p = camera.positionWC;
      const d = camera.directionWC;
      const pose = [p.x, p.y, p.z, d.x, d.y, d.z].map((v) => v.toFixed(3)).join(",");
      // SDK의 moveStart는 한 번에 옮긴 단계에도 나므로 쓰지 않는다. 렌더 사이에 카메라 자세가 바뀌었는지로 움직임을 본다.
      if (lastPoseRef.current !== null && pose !== lastPoseRef.current) noteCameraMove(performance.now());
      lastPoseRef.current = pose;
      const key = pose
        + `|${rectKey(area)}|${occluder ? rectKey(occluder) : ""}|${chrome.map(rectKey).join(";")}|${isHidden}|${presenting}|${selected}|${state.current.presetFromGround}`;
      if (key !== frameKeyRef.current) {
        frameKeyRef.current = key;
        passesRef.current = 2;
      }
      if (passesRef.current <= 0) return;
      passesRef.current -= 1;
      if (isHidden || area.width === 0 || area.height === 0) {
        controller.update({ hidden: true });
        return;
      }
      const motion = motionRef.current;
      const { points, distance, pitchDegrees } = projector.project(entries, area, { keepId: selected, occluder, clip: !motion });
      if (distance > VWORLD_MAX_LABEL_DISTANCE) {
        controller.update({ hidden: true });
        return;
      }
      // 모델 바닥 사각형의 화면 모서리 네 점(화면 검사가 가장자리 안팎 밝기를 잰다). 투영이 안 되는 모서리가 있으면 비운다.
      if (hostRef.current && footprintRef.current) {
        const corners = projector.project(footprintRef.current, area, { clip: false }).points;
        const value = corners.size === 4 ? footprintRef.current.map(({ elementId }) => { const c = corners.get(elementId); return `${Math.round(c.x)},${Math.round(c.y)}`; }).join(";") : "";
        if (hostRef.current.dataset.modelEdge !== value) hostRef.current.dataset.modelEdge = value;
      }
      const band = resolveLabelBand({ distance, pitchDegrees, presetFromGround: state.current.presetFromGround, presentation: presenting, touch });
      controller.update({ points, area, chrome, occluder, focusBoxes: [], band, now: performance.now(), motion });
    };
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(markRectsDirty) : null;
    resizeObserver?.observe(scene.canvas);
    globalThis.addEventListener?.("resize", markRectsDirty);
    globalThis.document?.addEventListener("transitionend", markRectsDirty, true);
    scene.postRender.addEventListener(onPostRender);
    passesRef.current = 2;
    requestRender();
    return () => {
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.("resize", markRectsDirty);
      globalThis.document?.removeEventListener("transitionend", markRectsDirty, true);
      scene.postRender.removeEventListener(onPostRender);
      clearTimeout(settleTimerRef.current);
      motionRef.current = false;
      lastPoseRef.current = null;
    };
  }, [Cesium, scene, entries, getModelMatrix]);

  // 층 콜백은 한 번만 만들고 최신 핸들러를 ref로 부른다(노드 풀이 콜백 때문에 다시 그려지지 않게).
  const handlersRef = useRef(null);
  handlersRef.current = {
    onSelect: (slot, event) => {
      const entry = entryById.get(slot.id);
      if (entry) onSelectEntry?.(entry, event);
    },
    onSelectCluster: (slot) => {
      const members = (slot.members ?? []).map((id) => entryById.get(id)).filter(Boolean);
      if (members.length > 0) onSelectCluster?.(members);
    },
    onClear: () => onClear?.(),
  };
  const [callbacks] = useState(() => ({
    onSelect: (slot, event) => handlersRef.current.onSelect(slot, event),
    onSelectCluster: (slot, event) => handlersRef.current.onSelectCluster(slot, event),
    onClear: () => handlersRef.current.onClear(),
    onRequestPass: () => {
      passesRef.current = 2;
      scene?.requestRender?.();
    },
  }));

  if (!entries) return null;
  return (
    <div ref={hostRef} data-qa="vworld-label-host" className="pointer-events-none absolute inset-0" style={{ zIndex: "var(--layer-labels)" }}>
      <CampusLabelLayer entries={entries} selectedId={selectedAnchorId} hoveredId={hoveredId && entryById.has(hoveredId) ? hoveredId : null} controllerRef={controllerRef} {...callbacks} />
    </div>
  );
}

async function defaultLoadGlb(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GLB request failed: ${response.status}`);
  return response.arrayBuffer();
}

// 앵커 묶음의 가운데(장면 좌표). 묶음 칩을 눌렀을 때 카메라를 그쪽으로 옮긴다.
export function centroidOf(entries) {
  const sum = [0, 0, 0];
  for (const entry of entries) for (let i = 0; i < 3; i += 1) sum[i] += entry.position[i];
  return sum.map((value) => value / entries.length);
}

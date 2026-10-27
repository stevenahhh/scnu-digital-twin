import { useEffect, useMemo, useRef, useState } from "react";
import commonElements from "../../../common/data/common_elemetns.json";
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { CampusLabelLayer } from "../labels/CampusLabelLayer.jsx";
import { resolveLabelBand } from "../labels/labelBands.mjs";
import { CAMPUS_GLTF_OVERLAY_CONFIG } from "./campusGltfOverlay.mjs";
import { buildVWorldLabelEntries, glbNodeBoxes, readGlbJson } from "./labelAnchors.mjs";
import { createVWorldLabelProjector } from "./labelProjection.mjs";

// 카메라가 멈춘 뒤 한 번 더 배치하기까지 기다리는 시간(tokens.css --motion-settle, Legacy와 같다).
const MOTION_SETTLE_MS = 150;
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

// VWorld 지도 위의 건물 라벨: Legacy와 같은 CampusLabelLayer(계층·충돌 배치·12 px 하한·움직이는 동안 흐림)를
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
  state.current = { selectedId, hidden, presentation, occluderRef, chromeRefs };

  useEffect(() => {
    let cancelled = false;
    loadGlb(CAMPUS_GLTF_OVERLAY_CONFIG.url)
      .then((buffer) => {
        if (cancelled) return;
        const json = readGlbJson(buffer);
        // 캠퍼스 모델의 바닥 사각형(모델 좌표): 모든 노드 경계 상자의 수평 범위, 가장 낮은 높이.
        let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let minY = Infinity;
        for (const [min, max] of glbNodeBoxes(json).values()) {
          minX = Math.min(minX, min[0]); maxX = Math.max(maxX, max[0]); minZ = Math.min(minZ, min[2]); maxZ = Math.max(maxZ, max[2]); minY = Math.min(minY, min[1]);
        }
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
    const onMoveStart = () => {
      clearTimeout(settleTimerRef.current);
      motionRef.current = true;
      controllerRef.current?.setMotion(true);
    };
    // 지도를 누르고 있는 동안(끌기)은 카메라가 멈춰 있어도 움직이는 중이다(Legacy의 드래그와 같다). 손을 떼면 150 ms 뒤 재배치.
    let held = false;
    const onMoveEnd = () => {
      if (held) return;
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        motionRef.current = false;
        controllerRef.current?.setMotion(false);
        passesRef.current = 2;
        frameKeyRef.current = "";
        requestRender();
      }, MOTION_SETTLE_MS);
    };
    const onPostRender = () => {
      const controller = controllerRef.current;
      if (!controller) return;
      const { selectedId: selected, hidden: isHidden, presentation: presenting, occluderRef: occluderSource, chromeRefs: chromeSources } = state.current;
      const area = scene.canvas.getBoundingClientRect();
      const panelRect = occluderSource?.current?.getBoundingClientRect() ?? null;
      const occluder =
        panelRect && panelRect.left < area.right && panelRect.right > area.left && panelRect.top < area.bottom && panelRect.bottom > area.top
          ? panelRect
          : null;
      const chrome = [];
      for (const ref of chromeSources ?? []) if (ref?.current) collectChromeRects(ref.current, chrome);
      const camera = scene.camera;
      const p = camera.positionWC;
      const d = camera.directionWC;
      const pose = [p.x, p.y, p.z, d.x, d.y, d.z].map((v) => v.toFixed(3)).join(",");
      // VWorld SDK의 끌기·휠은 camera.moveStart를 내지 않을 때가 있다. 카메라 자세가 프레임 사이에 바뀌면 움직이는 중으로 본다.
      if (lastPoseRef.current !== null && pose !== lastPoseRef.current) {
        onMoveStart();
        onMoveEnd();
      }
      lastPoseRef.current = pose;
      const key = pose
        + `|${rectKey(area)}|${occluder ? rectKey(occluder) : ""}|${chrome.map(rectKey).join(";")}|${isHidden}|${presenting}|${selected}`;
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
      const band = resolveLabelBand({ distance, pitchDegrees, presentation: presenting, touch });
      controller.update({ points, area, chrome, occluder, focusBoxes: [], band, now: performance.now(), motion });
    };
    const onPointerDown = () => {
      held = true;
      onMoveStart();
    };
    const onPointerUp = () => {
      if (!held) return;
      held = false;
      onMoveEnd();
    };
    scene.canvas.addEventListener?.("pointerdown", onPointerDown);
    globalThis.addEventListener?.("pointerup", onPointerUp);
    globalThis.addEventListener?.("pointercancel", onPointerUp);
    scene.postRender.addEventListener(onPostRender);
    scene.camera.moveStart?.addEventListener(onMoveStart);
    scene.camera.moveEnd?.addEventListener(onMoveEnd);
    passesRef.current = 2;
    requestRender();
    return () => {
      scene.canvas.removeEventListener?.("pointerdown", onPointerDown);
      globalThis.removeEventListener?.("pointerup", onPointerUp);
      globalThis.removeEventListener?.("pointercancel", onPointerUp);
      scene.postRender.removeEventListener(onPostRender);
      scene.camera.moveStart?.removeEventListener(onMoveStart);
      scene.camera.moveEnd?.removeEventListener(onMoveEnd);
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

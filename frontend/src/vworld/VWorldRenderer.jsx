import { createPortal } from "react-dom";
import { CAMERA_PRESETS, D4_CAMERA_OFFSET, OVERVIEW_PRESET_ID } from "../camera/cameraPresets.mjs";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { focusMapAt } from "./cameraFocus.mjs";
import { D4_COORDINATE_HIT_TOLERANCE_DEGREES, isCoordinateMarkerHit } from "./coordinateMarkerHit.mjs";
import { D4_COORDINATE_MARKER } from "./d4CoordinateMarker.mjs";
import { createD4VWorldModel, removeD4VWorldModel } from "./d4VWorldModel.mjs";
import {
  activateCoordinateMarkerSelection,
  activateNativeModelSelection,
} from "./selectionActivation.mjs";
import { applyVWorldSunSimulation } from "./sunSimulation.mjs";
import { clearRoadZoneOverlays, findRoadZoneAt, setRoadZoneHighlighted } from "./roadZones.mjs";
import { loadVWorldWebGlSdk } from "./webglSdkLoader.mjs";
import { RepresentativePlanOverlayController } from "./RepresentativePlanOverlayController";
import { CAMPUS_REPRESENTATIVE_BUILDING_IDS } from "./representativePlanOverlay.mjs";
import { replaceRepresentativePlanObjects } from "./representativePlanVWorld.mjs";
import { createCampusGltfOverlay, createCampusModelMatrix, removeCampusGltfOverlay } from "./campusGltfOverlay.mjs";
import { createVWorldLabelProjector } from "./labelProjection.mjs";
import { applyCampusZoomLimits } from "./cameraLimits.mjs";
import { createVWorldCampusCamera } from "./campusCamera.mjs";
import { attachCameraGestures } from "../camera/cameraGestures.mjs";
import { createVWorldSelectionHighlight, pickedNodeName } from "./selectionHighlight.mjs";
import { CAMPUS_BLOCKED_ELEMENT_IDS, CAMPUS_BUILDING_MAP, resolveBuildingMeta } from "../utils/buildingLabels.mjs";
import { campusCenterOf, glbLabelAnchors, glbNodeBoxes } from "./labelAnchors.mjs";
import commonElements from "../../../common/data/common_elemetns.json";
import { VWorldLabelLayer, centroidOf } from "./VWorldLabelLayer";
import { SearchField } from "../components/SearchField";
import { createVWorldTrafficSimulation } from "./trafficSimulationOverlay.mjs";
import { Alert } from "../ui/Alert.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";

const OVERVIEW_PRESET = CAMERA_PRESETS.find((preset) => preset.id === OVERVIEW_PRESET_ID);
const PAN_STEP = 0.1;
const prefersReducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const D4SectionExperience = lazy(() =>
  import("./D4SectionExperience").then((module) => ({
    default: module.D4SectionExperience,
  })),
);

const VWORLD_MAP_ID = "vmap";
const VWORLD_MAP_INSTANCE_KEY = "__scnuVWorldMapInstance";
const CAMPUS_BOUNDARY_ID = "SCNU_CAMPUS_AREA";
const D4_MARKER_ID = "SCNU_D4_COORDINATE_MARKER";
const D4_MARKER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36'%3E%3Ccircle cx='18' cy='18' r='16' fill='%235e6ad2'/%3E%3Ccircle cx='18' cy='18' r='12' fill='%230f1011'/%3E%3Ctext x='18' y='22' text-anchor='middle' fill='%23f7f8f8' font-family='sans-serif' font-size='12' font-weight='700'%3ED4%3C/text%3E%3C/svg%3E";

function createCampusBoundary(vw) {
  const coordinates = [
    new vw.Coord(127.4758811, 34.9698032),
    new vw.Coord(127.476452, 34.9684882),
    new vw.Coord(127.4771066, 34.9672831),
    new vw.Coord(127.4792342, 34.9662112),
    new vw.Coord(127.4837115, 34.9654154),
    new vw.Coord(127.4845949, 34.965956),
    new vw.Coord(127.4844475, 34.9669869),
    new vw.Coord(127.4841844, 34.9681617),
    new vw.Coord(127.4833142, 34.9708445),
    new vw.Coord(127.4830788, 34.9715139),
    new vw.Coord(127.4777905, 34.9711092),
    new vw.Coord(127.4771614, 34.9710003),
    new vw.Coord(127.4761456, 34.9706227),
    new vw.Coord(127.4758811, 34.9698032),
  ];
  const campusBoundary = new vw.geom.PolygonZ(new vw.Collection(coordinates));

  campusBoundary.setId(CAMPUS_BOUNDARY_ID);
  campusBoundary.setFillColor(new vw.Color(0, 180, 220, 100));
  campusBoundary.setOutLineColor(new vw.Color(60, 220, 255, 220));
  campusBoundary.setDistanceFromTerrain(10);
  campusBoundary.setExtrudeHeight(3);
  campusBoundary.create();
}

function createD4CoordinateMarker(vw) {
  const marker = new vw.geom.PointZ(
    new vw.CoordZ(127.4764043, 34.9700548, 0),
  );

  marker.setId(D4_MARKER_ID);
  marker.setName(D4_COORDINATE_MARKER.displayName);
  marker.setFont("Wanted Sans");
  marker.setFontSize(14);
  marker.setImage(D4_MARKER_IMAGE);
  marker.create();
}

export default function VWorldRenderer({
  onSelection,
  energyFeedDown = false,
  simulationDate,
  editorRequest,
  onEditorClose,
  onPlanSaved,
  createInstallationPlanDraft,
  installationPlanRefreshKey,
  onInstallationPlansChange,
  onRepresentativeInstallationPlanChange,
  representativeRefreshKey,
  presentationMode = false,
  onD4SectionChange,
  d4PaneHost = null,
  d4CloseKey = 0,
  // 인스펙터의 "실내 보기"가 바꾸는 값. 바뀌면 D4 좌표 표지를 누른 것과 같이 D4를 고르고 D4 상세를 연다.
  d4OpenKey = 0,
  // 대표 설치 계획 지도 표시(지붕 위 배열). 배열을 주면 그대로 그리고 []는 숨긴다. 주지 않으면 렌더러 안의 컨트롤러가
  // 불러와 그린다(카드는 그리지 않는다).
  representativeOverlays,
  overlaysHidden = false,
  overlayInsetRight = "0px",
  overlayInsetBottom = "0px",
  mapBackdrop = null,
  // 앱이 고른 건물(useSelectionState.selectedId). 비면 라벨 선택도 푼다.
  selectedId = "",
  // 라벨 층에서 Esc로 선택을 풀 때.
  onClearSelection,
  // 라벨을 가리는 패널과, 라벨이 피해 갈 지도 위 조작 UI(HUD) ref 목록.
  labelOccluderRef = null,
  labelChromeRefs = null,
  // HUD 안의 지도 위 문구·버튼 자리(DOM 요소). 없으면 지도 안에 그대로 그린다.
  overlayHost = null,
  // 폰의 D4 패인에 둘 캠퍼스 시점 줄(Legacy D4 패인과 같다)과 고른 시점으로 가는 함수.
  d4Presets = null,
  onSelectPreset,
  // 지금 시점이 땅 높이 시점(정문)인지: 라벨 거리 단계에 쓴다(Legacy CityModel의 presetFromGround와 같다).
  labelPresetFromGround = false,
  // 라벨 항목(앵커 위치 포함)이 준비되면 받는다.
  onLabelEntries,
  presentation = false,
  // 시점 버튼이 쓰는 카메라(createVWorldCampusCamera). 준비되면 넘기고, 지도가 사라지면 null.
  onCampusCamera,
  // 사용자가 지도를 누르거나 끌기 시작했을 때(시점 표시·투어를 멈춘다).
  onUserCameraStart,
}) {
  const onSelectionPropRef = useRef(onSelection);
  onSelectionPropRef.current = onSelection;
  // 지도에서 고른 건물의 요소 id. 라벨 층이 그 칩을 선택 상태로 그린다(SDK 건물·D4 표지·칩·SOLAR 카드 모두 이 길로 온다).
  const [selectedLabelId, setSelectedLabelId] = useState(null);
  const onSelectionRef = useRef((target) => {
    setSelectedLabelId(target?.elementId ?? null);
    onSelectionPropRef.current?.(target);
  });
  useEffect(() => {
    if (!selectedId) setSelectedLabelId(null);
  }, [selectedId]);
  const [labelScene, setLabelScene] = useState(null);
  const [labelEntries, setLabelEntries] = useState(null);
  // 라벨 항목을 앱에도 알린다(인스펙터의 정문 거리·방위가 앵커 위치를 쓴다).
  const onLabelEntriesRef = useRef(onLabelEntries);
  onLabelEntriesRef.current = onLabelEntries;
  const handleLabelEntries = useCallback((entries) => {
    setLabelEntries(entries);
    onLabelEntriesRef.current?.(entries);
  }, []);
  const [campusGlb, setCampusGlb] = useState(null);
  // 마우스를 올린 캠퍼스 건물(앵커 요소 id). 상자 강조와 칩 떠오름이 같이 쓴다.
  const [hoveredLabelId, setHoveredLabelId] = useState(null);
  const highlightRef = useRef(null);
  const leftStackRef = useRef(null);
  const simulationDateRef = useRef(simulationDate);
  const mapRef = useRef(null);
  const vwRef = useRef(null);
  const overlayDataRef = useRef([]);
  const overlayObjectIdsRef = useRef([]);
  const highlightedRoadZoneRef = useRef(null);
  const highlightedRoadZoneIdsRef = useRef([]);
  const campusGltfModelRef = useRef(null);
  const trafficSimulationRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  // 다시 시도는 페이지를 새로 고치지 않고 SDK 로더부터 지도 초기화를 한 번 더 돌린다.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const retryLoad = () => {
    setHasLoadError(false);
    setIsLoading(true);
    setLoadAttempt((value) => value + 1);
  };
  const [campusStatus, setCampusStatus] = useState(null);
  const [isD4SectionOpen, setIsD4SectionOpen] = useState(false);
  const onClearSelectionRef = useRef(onClearSelection);
  onClearSelectionRef.current = onClearSelection;
  // D4 상세에서 돌아오면 Legacy처럼 선택이 풀린 캠퍼스 지도로 돌아간다(D4 인스펙터가 남지 않는다).
  const closeD4Section = useCallback(() => {
    setIsD4SectionOpen(false);
    setDetailRequest(null);
    onClearSelectionRef.current?.();
    onEditorClose?.();
  }, [onEditorClose]);
  // 대시보드 레일에서 다른 탭을 고르면(d4CloseKey가 바뀌면) D4 패인을 닫는다.
  const closeKeyRef = useRef(d4CloseKey);
  useEffect(() => {
    if (closeKeyRef.current === d4CloseKey) return;
    closeKeyRef.current = d4CloseKey;
    closeD4Section();
  }, [closeD4Section, d4CloseKey]);
  // 인스펙터의 "실내 보기"(d4OpenKey가 바뀌면): D4 좌표 표지와 같은 길로 D4를 고르고 상세를 연다(좌표 표지 폴백 유지).
  const openKeyRef = useRef(d4OpenKey);
  useEffect(() => {
    if (openKeyRef.current === d4OpenKey) return;
    openKeyRef.current = d4OpenKey;
    activateCoordinateMarkerSelection(D4_COORDINATE_MARKER, onSelectionRef.current);
    setIsD4SectionOpen(true);
  }, [d4OpenKey]);
  const [detailRequest, setDetailRequest] = useState(null);

  // D4 상세 화면은 자체 대화상자다. 열려 있는 동안 앱이 건물 팝업을 겹쳐 띄우지 않도록 상태를 알린다.
  useEffect(() => {
    onD4SectionChange?.(isD4SectionOpen);
  }, [isD4SectionOpen, onD4SectionChange]);

  useEffect(() => {
    if (editorRequest?.scenarioId || editorRequest?.installationPlanId) {
      setDetailRequest(editorRequest);
      setIsD4SectionOpen(true);
    }
  }, [editorRequest]);

  // 라벨 앵커의 지도 위치: 캠퍼스 GLB 오버레이의 modelMatrix(지형으로 다시 맞추면 바뀐다). GLB를 못 올렸으면 같은 기준점으로 한 번 만든다.
  const fallbackModelMatrixRef = useRef(null);
  const getLabelModelMatrix = useCallback(() => {
    const model = campusGltfModelRef.current;
    if (model?.modelMatrix) return model.modelMatrix;
    const viewer = mapRef.current?._wsViewer;
    if (!viewer || !window.Cesium) return null;
    fallbackModelMatrixRef.current ??= createCampusModelMatrix(viewer, window.Cesium);
    return fallbackModelMatrixRef.current;
  }, []);
  // 캠퍼스 카메라(Legacy 시점을 VWorld로 옮긴 것). 오버레이·GLB가 준비되면 아래 효과가 채운다.
  const campusCameraRef = useRef(null);
  // 고른 건물로 한 번 비행한다(라벨 칩·SDK 건물·D4 표지가 같은 길). 이미 화면 가운데 부분(가로·세로 가운데 60%)에 보이면
  // 그대로 둔다. 도착하면 카메라는 멈춘다(자동 회전 없음). focus: 요소 id 목록, position: 장면 좌표, lonLat: 경위도.
  const focusBuilding = useCallback(({ focus = null, position = null, lonLat = null }) => {
    const camera = campusCameraRef.current;
    if (!labelScene || !camera) return;
    const target = camera.focusTarget({ focus, lonLat }) ?? position;
    if (!target) return;
    const projector = createVWorldLabelProjector({ ...labelScene, getModelMatrix: getLabelModelMatrix });
    const area = labelScene.scene.canvas?.getBoundingClientRect?.();
    const point = area ? projector.project([{ elementId: "focus", position: target }], area, { clip: false }).points.get("focus") : null;
    const central = point && area
      && Math.abs(point.x - (area.left + area.width / 2)) <= area.width * 0.3
      && Math.abs(point.y - (area.top + area.height / 2)) <= area.height * 0.3;
    if (central) return;
    camera.flyToFocus(target, { reducedMotion: prefersReducedMotion() });
  }, [getLabelModelMatrix, labelScene]);
  const focusBuildingRef = useRef(focusBuilding);
  focusBuildingRef.current = focusBuilding;
  // 칩으로 고르면 SDK 건물을 누른 것과 같은 선택(요소 id·건물 코드·이름)을 보내고 지도 가운데를 그 건물로 옮긴다(Legacy 칩과 같다).
  const handleLabelSelect = useCallback((entry) => {
    const elementId = entry.dataElementId ?? entry.elementId;
    onSelectionRef.current({ elementId, buildingId: elementId.replace(/^BLD_/, ""), displayName: entry.displayName });
    setSelectedLabelId(entry.elementId);
    focusBuilding({ focus: [entry.elementId], position: entry.position });
  }, [focusBuilding]);
  // 검색으로 고르면 Legacy(camera.flyToBuilding)처럼 그 건물을 가까이 보는 시점(건물 경계 상자 + D4 시점과 같은 거리)으로
  // 날아간다. 캠퍼스 카메라 전에는 칩과 같이 지도 가운데만 옮긴다.
  const handleSearchPick = useCallback((entry) => {
    const elementId = entry.dataElementId ?? entry.elementId;
    onSelectionRef.current({ elementId, buildingId: elementId.replace(/^BLD_/, ""), displayName: entry.displayName });
    setSelectedLabelId(entry.elementId);
    const flown = campusCameraRef.current?.flyTo(
      { id: `building:${entry.elementId}`, focus: [entry.elementId], offset: D4_CAMERA_OFFSET, position: OVERVIEW_PRESET.position, target: OVERVIEW_PRESET.target },
      { reducedMotion: prefersReducedMotion() },
    );
    if (!flown) focusBuilding({ position: entry.position });
  }, [focusBuilding]);
  const handleLabelCluster = useCallback((members) => focusBuilding({ position: centroidOf(members) }), [focusBuilding]);
  const defaultChromeRefs = useRef([leftStackRef]).current;
  const onCampusCameraRef = useRef(onCampusCamera);
  onCampusCameraRef.current = onCampusCamera;
  const onUserCameraStartRef = useRef(onUserCameraStart);
  onUserCameraStartRef.current = onUserCameraStart;
  useEffect(() => {
    if (!labelScene || !campusGlb) return undefined;
    const elementNames = new Map(commonElements.elements.map(({ element_id: id, name }) => [id, name]));
    const center = campusCenterOf(glbLabelAnchors(campusGlb, { elementNames }));
    campusCameraRef.current = createVWorldCampusCamera({ ...labelScene, getModelMatrix: getLabelModelMatrix, boxes: glbNodeBoxes(campusGlb), center });
    onCampusCameraRef.current?.(campusCameraRef.current);
    return () => {
      campusCameraRef.current = null;
      onCampusCameraRef.current?.(null);
    };
  }, [campusGlb, getLabelModelMatrix, labelScene]);

  // 트랙패드 제스처(Legacy OrbitGestures와 같은 조작): Cesium은 ctrl wheel(Chrome·Firefox 핀치)을 확대로 쓰지 않고 가로 스와이프도
  // 버리므로 여기서 핀치 확대, 가로 스와이프 회전, Option+세로 스와이프 기울이기, Safari 핀치·비틀기를 처리한다.
  // 터치 화면의 두 손가락 핀치·비틀기·기울이기는 Cesium이 스스로 한다(여기서 또 돌리면 비틀기가 두 배로 돈다).
  // 캔버스를 감싼 요소의 캡처 단계에서 Cesium보다 먼저 받는다.
  useEffect(() => {
    const host = labelScene?.scene.canvas?.parentElement;
    if (!host) return undefined;
    const camera = () => campusCameraRef.current;
    return attachCameraGestures(host, {
      start: () => {
        campusCameraRef.current?.cancelFlight();
        onUserCameraStartRef.current?.();
      },
      zoom: (factor) => camera()?.zoomBy(factor),
      rotate: (radians) => camera()?.rotateBy(radians),
      tilt: (radians) => camera()?.tiltBy(radians),
    });
  }, [labelScene]);

  // 선택·호버 강조(오버레이 전체 흐리게 + 고른 건물 강조색 상자, 올린 건물 호버 색 상자). 오버레이 GLB 노드를 집어 호버를 안다.
  useEffect(() => {
    if (!labelScene || !campusGlb) return undefined;
    const { Cesium, scene } = labelScene;
    const elementNames = new Map(commonElements.elements.map(({ element_id: id, name }) => [id, name]));
    const boxById = new Map(glbLabelAnchors(campusGlb, { elementNames }).map((anchor) => [anchor.elementId, anchor.box]));
    const highlight = createVWorldSelectionHighlight({ Cesium, scene, getModel: () => campusGltfModelRef.current, getModelMatrix: getLabelModelMatrix, boxById });
    highlightRef.current = highlight;
    const handler = Cesium.ScreenSpaceEventHandler ? new Cesium.ScreenSpaceEventHandler(scene.canvas) : null;
    handler?.setInputAction((movement) => {
      const picked = scene.pick?.(movement.endPosition);
      // VWorld의 Cesium은 고른 노드를 picked.detail.node(런타임 노드)에 두고, glTF 노드 이름은 그 안의 node.name에 있다.
      const name = picked?.primitive === campusGltfModelRef.current ? pickedNodeName(picked) : null;
      const meta = name ? resolveBuildingMeta(name, { elementNames, buildingMap: CAMPUS_BUILDING_MAP, blockedIds: CAMPUS_BLOCKED_ELEMENT_IDS }) : null;
      const id = meta && boxById.has(meta.elementId) ? meta.elementId : null;
      setHoveredLabelId((current) => (current === id ? current : id));
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    return () => {
      handler?.destroy();
      highlight.dispose();
      highlightRef.current = null;
    };
  }, [campusGlb, getLabelModelMatrix, labelScene]);
  useEffect(() => {
    highlightRef.current?.set({ selectedId: selectedLabelId, hoveredId: hoveredLabelId });
  }, [campusGlb, hoveredLabelId, labelScene, selectedLabelId]);

  const handleOverlayDataChange = useCallback((overlays) => {
    overlayDataRef.current = overlays;
    if (!mapRef.current || !vwRef.current) return;
    overlayObjectIdsRef.current = replaceRepresentativePlanObjects({
      map: mapRef.current,
      vw: vwRef.current,
      overlays,
      previousIds: overlayObjectIdsRef.current,
    });
  }, []);

  // 앱이 대표 설치 계획 표시를 직접 넘기면(에너지 탭이 불러온 것) 그대로 그린다. 지도가 준비되면 초기화가 다시 그린다.
  useEffect(() => {
    if (representativeOverlays !== undefined) handleOverlayDataChange(representativeOverlays);
  }, [handleOverlayDataChange, representativeOverlays]);

  useEffect(() => {
    simulationDateRef.current = simulationDate;
    applyVWorldSunSimulation(simulationDate);
  }, [simulationDate]);

  useEffect(() => {
    let isDisposed = false;
    let map = null;
    let handleMapClick = null;

    async function initializeMap() {
      try {
        const vw = await loadVWorldWebGlSdk(import.meta.env.VITE_VWORLD_API_KEY);
        if (isDisposed) return;

        map = globalThis.window[VWORLD_MAP_INSTANCE_KEY];
        if (!map) {
          map = new vw.Map();
          map.setOption({
            mapId: VWORLD_MAP_ID,
            initPosition: new vw.CameraPosition(
              new vw.CoordZ(127.4810, 34.9697, 400),
              new vw.Direction(0, -60, 0),
            ),
            logo: false,
            navigation: false,
          });
          map.start();
          globalThis.window[VWORLD_MAP_INSTANCE_KEY] = map;
        }
        // The SDK map deliberately survives component cleanup. Always bind the
        // current mount to it so StrictMode/remount overlay callbacks can render.
        mapRef.current = map;
        vwRef.current = vw;
        if (presentationMode) {
          focusMapAt(map, vw, {
            longitude: D4_COORDINATE_MARKER.longitude,
            latitude: D4_COORDINATE_MARKER.latitude,
            altitude: 140,
            heading: -15,
          });
        }
        applyVWorldSunSimulation(simulationDateRef.current);

        const poiLayer = map.getLayerElement("POI_GROUP");
        if (poiLayer) poiLayer.hide();

        createCampusBoundary(vw);
        createD4VWorldModel(vw);
        let d4FallbackRemoved = false;
        let campusLoadFailed = false;
        try {
          campusGltfModelRef.current = await createCampusGltfOverlay(map, window.Cesium, {
            onStatus: (status) => {
              setCampusStatus(status);
              if (status.state !== "error") return;
              campusLoadFailed = true;
              // Cesium 1.99 reports a failed download only after the overlay was returned and the
              // D4 fallback below was removed, so put the fallback back.
              if (d4FallbackRemoved && !isDisposed) {
                d4FallbackRemoved = false;
                campusGltfModelRef.current = null;
                createD4VWorldModel(vw);
              }
            },
          });
          if (isDisposed) {
            removeCampusGltfOverlay(map, campusGltfModelRef.current);
            campusGltfModelRef.current = null;
            return;
          }
          if (campusLoadFailed) {
            campusGltfModelRef.current = null;
          } else if (campusGltfModelRef.current) {
            removeD4VWorldModel(map);
            d4FallbackRemoved = true;
          }
        } catch (error) {
          console.warn("Campus GLB overlay could not be loaded; keeping the D4 fallback model.", error);
        }
        const labelViewerScene = map._wsViewer?.scene;
        // 휠·핀치 확대·축소 범위를 Legacy 캠퍼스 궤도와 같게 둔다(지구본까지 빠지면 라벨·선택이 뜻이 없다).
        applyCampusZoomLimits(labelViewerScene);
        if (labelViewerScene && window.Cesium) setLabelScene({ Cesium: window.Cesium, scene: labelViewerScene });
        trafficSimulationRef.current?.dispose();
        // 연결 상태는 시뮬레이션 탭 머리글이 알린다. 지도 위에는 배지를 두지 않는다.
        trafficSimulationRef.current = presentationMode ? null : createVWorldTrafficSimulation({ map });
        handleOverlayDataChange(overlayDataRef.current);
        createD4CoordinateMarker(vw);

        const clearRoadZoneHighlight = () => {
          if (!highlightedRoadZoneRef.current) return;
          clearRoadZoneOverlays(map, highlightedRoadZoneIdsRef.current);
          highlightedRoadZoneRef.current = null;
          highlightedRoadZoneIdsRef.current = [];
        };

        handleMapClick = (
          _windowPosition,
          _ecefPosition,
          cartographic,
          modelObject,
        ) => {
          const modelName = modelObject?.attributes?.MODEL_NAME;
          const nativeSelection = activateNativeModelSelection(
            modelName,
            onSelectionRef.current,
          );

          if (nativeSelection) {
            clearRoadZoneHighlight();
            focusBuildingRef.current({
              focus: [nativeSelection.elementId],
              lonLat: { longitude: cartographic?.longitudeDD, latitude: cartographic?.latitudeDD },
            });
            return;
          }

          if (
            isCoordinateMarkerHit(
              cartographic,
              D4_COORDINATE_MARKER,
              D4_COORDINATE_HIT_TOLERANCE_DEGREES,
            )
          ) {
            clearRoadZoneHighlight();
            const selection = activateCoordinateMarkerSelection(
              D4_COORDINATE_MARKER,
              onSelectionRef.current,
            );
            setIsD4SectionOpen(true);
            focusBuildingRef.current({
              focus: [selection.elementId],
              lonLat: { longitude: D4_COORDINATE_MARKER.longitude, latitude: D4_COORDINATE_MARKER.latitude },
            });
            return;
          }

          const roadZone = findRoadZoneAt(
            cartographic?.longitudeDD,
            cartographic?.latitudeDD,
          );

          if (highlightedRoadZoneRef.current?.id !== roadZone?.id) {
            clearRoadZoneHighlight();
            if (roadZone) {
              highlightedRoadZoneIdsRef.current = setRoadZoneHighlighted(map, roadZone);
              highlightedRoadZoneRef.current = roadZone;
            }
          }
        };
        map.onClick.addEventListener(handleMapClick);

        setIsLoading(false);
      } catch (error) {
        if (isDisposed) return;

        console.error("VWorld renderer initialization failed.", error);
        // 로더 오류(code 보유)만 정리된 한국어 안내를 갖는다. 그 밖의 예외 문구는 콘솔에만 남긴다.
        setLoadErrorMessage(error?.code ? error.message : "VWorld 지도를 불러오지 못했습니다.");
        setHasLoadError(true);
        setIsLoading(false);
      }
    }

    initializeMap();

    return () => {
      isDisposed = true;
      setLabelScene(null);
      fallbackModelMatrixRef.current = null;
      trafficSimulationRef.current?.dispose();
      trafficSimulationRef.current = null;
      if (!map) return;

      if (handleMapClick) {
        map.onClick.removeEventListener(handleMapClick);
      }
      map.removeObjectById(D4_MARKER_ID);
      map.removeObjectById(CAMPUS_BOUNDARY_ID);
      clearRoadZoneOverlays(map, highlightedRoadZoneIdsRef.current);
      highlightedRoadZoneIdsRef.current = [];
      highlightedRoadZoneRef.current = null;
      removeD4VWorldModel(map);
      removeCampusGltfOverlay(map, campusGltfModelRef.current);
      campusGltfModelRef.current = null;
      overlayObjectIdsRef.current = replaceRepresentativePlanObjects({
        map,
        vw: vwRef.current,
        overlays: [],
        previousIds: overlayObjectIdsRef.current,
      });
      mapRef.current = null;
      vwRef.current = null;
    };
  }, [handleOverlayDataChange, loadAttempt, presentationMode]);

  // 사람이 지도를 누르거나 휠을 돌리면 진행 중인 비행을 그 자리에서 끊고 앱에 알린다(시점 표시·투어를 멈춘다).
  const handleUserCameraStart = () => {
    campusCameraRef.current?.cancelFlight();
    onUserCameraStart?.();
  };

  // 지도(캔버스)에 포커스가 있을 때 방향키로 땅 위를 옮긴다(Legacy 장면과 같은 키보드 조작). 한 번에 화면 가운데까지 거리의 10%.
  const handleMapKey = (event) => {
    const step = { ArrowLeft: [-PAN_STEP, 0], ArrowRight: [PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] }[event.key];
    if (!step || !campusCameraRef.current) return;
    event.preventDefault();
    onUserCameraStart?.();
    campusCameraRef.current.panBy(...step);
  };

  const mapOverlays = (
    <>
        {/* 지도 위에는 검색과 지도 로딩·오류 문구만 둔다. 열린 패널을 뺀 지도 영역 안의 왼쪽 위 열 하나에 쌓는다. */}
        <div
          data-qa="vworld-map-overlays"
          data-label-chrome-layer=""
          aria-hidden={overlaysHidden ? "true" : undefined}
          className={`pointer-events-none absolute inset-y-0 left-0 ${overlaysHidden ? "invisible" : ""}`}
          style={{ right: overlayInsetRight, bottom: overlayInsetBottom }}
        >
          {!isD4SectionOpen && (
            <div
              ref={leftStackRef}
              data-qa="vworld-left-stack"
              data-label-chrome-layer=""
              className="pointer-events-none absolute left-4 flex max-w-[calc(100%-2rem)] flex-col items-start gap-3"
              style={{ top: presentationMode ? "12rem" : "var(--vworld-hud-bottom, 4.5rem)" }}
            >
              {!presentationMode && labelEntries && <SearchField registry={labelEntries} onPick={handleSearchPick} />}
              {isLoading && !hasLoadError && (
                <Spinner
                  delayMs={0}
                  label="VWorld 지도를 불러오는 중입니다."
                  className="rounded-control border border-hairline bg-surface-1 px-3 py-2"
                />
              )}
              {hasLoadError && (
                <Alert
                  tone="danger"
                  source="vworld-map"
                  title={loadErrorMessage}
                  actions={[{ label: "다시 시도", onClick: retryLoad }]}
                  className="pointer-events-auto max-w-80"
                />
              )}
              {(campusStatus?.state === "terrain-timeout" || campusStatus?.state === "error") && (
                <StatusBadge tone="warning" role="status" className="pointer-events-auto text-caption">
                  {campusStatus.message}
                </StatusBadge>
              )}
            </div>
          )}
        </div>
    </>
  );

  return (
    <div className="relative h-full w-full">
      {/* 지도 자체에 Legacy 캔버스와 같은 이름을 준다(화면 읽기·랜드마크). */}
      <div id={VWORLD_MAP_ID} role="region" aria-label="순천대 캠퍼스 3D 지도" data-qa="campus-map-layer" data-selected-id={selectedLabelId ?? undefined} className="h-full w-full" onPointerDown={handleUserCameraStart} onWheel={handleUserCameraStart} onKeyDown={handleMapKey} />
      {mapBackdrop}
      {labelScene && (
        <VWorldLabelLayer
          Cesium={labelScene.Cesium}
          scene={labelScene.scene}
          getModelMatrix={getLabelModelMatrix}
          selectedId={selectedLabelId}
          hoveredId={hoveredLabelId}
          hidden={isD4SectionOpen || presentationMode}
          presentation={presentation}
          presetFromGround={labelPresetFromGround}
          occluderRef={labelOccluderRef}
          chromeRefs={labelChromeRefs ? [...defaultChromeRefs, ...labelChromeRefs] : defaultChromeRefs}
          onSelectEntry={handleLabelSelect}
          onSelectCluster={handleLabelCluster}
          onEntries={handleLabelEntries}
          onGlb={setCampusGlb}
          onClear={() => {
            setSelectedLabelId(null);
            onClearSelection?.();
          }}
        />
      )}
      {/* 앱이 표시를 넘기지 않으면 대표 설치 계획을 여기서 불러와 지붕 위에만 그린다(카드는 에너지 탭 몫). */}
      {representativeOverlays === undefined && (
        <RepresentativePlanOverlayController
          buildingIds={CAMPUS_REPRESENTATIVE_BUILDING_IDS}
          refreshKey={representativeRefreshKey}
          renderPanel={false}
          onOverlayDataChange={handleOverlayDataChange}
          feedDown={energyFeedDown}
        />
      )}
      {/* 지도 위 문구 묶음은 HUD 안의 자리(overlayHost)에 그린다: 탭 순서가 Legacy처럼 HUD -> 칩 -> 패널이 된다. */}
      {overlayHost ? createPortal(mapOverlays, overlayHost) : mapOverlays}
      {/* D4 상세는 대시보드 셸의 패인 자리(d4PaneHost)에 그린다. 진입 경로(MODEL_NAME, D4 좌표 표지)는 그대로다. */}
      {isD4SectionOpen && d4PaneHost && createPortal(
        <Suspense
          fallback={
            <div className="absolute inset-0 grid place-items-center bg-surface-1">
              <Spinner label="D4 단면 모델을 불러오는 중입니다." />
            </div>
          }
        >
          <D4SectionExperience
            buildingId={detailRequest?.buildingId ?? "D4"}
            scenarioId={detailRequest?.scenarioId}
            installationPlanId={detailRequest?.installationPlanId}
            startInstallation={Boolean(detailRequest?.scenarioId || detailRequest?.installationPlanId)}
            onPlanSaved={onPlanSaved}
            createInstallationPlanDraft={createInstallationPlanDraft}
            onPlansChange={onInstallationPlansChange}
            onRepresentativeChange={onRepresentativeInstallationPlanChange}
            planRefreshKey={installationPlanRefreshKey}
            onClose={closeD4Section}
            presets={d4Presets}
            onSelectPreset={(preset) => {
              closeD4Section();
              onSelectPreset?.(preset);
            }}
          />
        </Suspense>,
        d4PaneHost,
      )}
    </div>
  );
}

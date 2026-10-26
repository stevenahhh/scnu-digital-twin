import { createPortal } from "react-dom";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import { createBuildingCameraController } from "./cameraFocus.mjs";
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
import { VWorldCampusStatus } from "./VWorldCampusStatus";
import { RepresentativePlanOverlayController } from "./RepresentativePlanOverlayController";
import { CAMPUS_REPRESENTATIVE_BUILDING_IDS } from "./representativePlanOverlay.mjs";
import { replaceRepresentativePlanObjects } from "./representativePlanVWorld.mjs";
import { createCampusGltfOverlay, removeCampusGltfOverlay } from "./campusGltfOverlay.mjs";
import { createVWorldTrafficSimulation } from "./trafficSimulationOverlay.mjs";
import { Alert } from "../ui/Alert.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";

// 교통 시뮬레이션 연결 상태 문구(frontend/AGENTS.md 공용 어휘). 모르는 상태는 끊김으로 본다.
const TRAFFIC_STATUS = {
  live: { label: "교통 시뮬레이션 연결됨", tone: "success" },
  connecting: { label: "교통 시뮬레이션 연결 중", tone: "neutral" },
};

const D4SectionExperience = lazy(() =>
  import("./D4SectionExperience").then((module) => ({
    default: module.D4SectionExperience,
  })),
);

const VWORLD_MAP_ID = "vmap";
const VWORLD_AVAILABLE_AREA_ID = "vworld-available-area";
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
  simulationDate,
  editorRequest,
  onEditorClose,
  onPlanSaved,
  createInstallationPlanDraft,
  installationPlanRefreshKey,
  onInstallationPlansChange,
  onRepresentativeInstallationPlanChange,
  representativeRefreshKey,
  onD4SectionChange,
  d4PaneHost = null,
  d4CloseKey = 0,
  overlaysHidden = false,
  overlayInsetRight = "0px",
  overlayInsetBottom = "0px",
  mapBackdrop = null,
}) {
  const onSelectionRef = useRef(onSelection);
  const simulationDateRef = useRef(simulationDate);
  const mapRef = useRef(null);
  const vwRef = useRef(null);
  const overlayDataRef = useRef([]);
  const overlayObjectIdsRef = useRef([]);
  const highlightedRoadZoneRef = useRef(null);
  const highlightedRoadZoneIdsRef = useRef([]);
  const campusGltfModelRef = useRef(null);
  const trafficSimulationRef = useRef(null);
  const cameraControllerRef = useRef(null);
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
  const [trafficStatus, setTrafficStatus] = useState(null);
  const [isD4SectionOpen, setIsD4SectionOpen] = useState(false);
  const closeD4Section = useCallback(() => {
    setIsD4SectionOpen(false);
    setDetailRequest(null);
    onEditorClose?.();
  }, [onEditorClose]);
  // 대시보드 레일에서 다른 탭을 고르면(d4CloseKey가 바뀌면) D4 패인을 닫는다.
  const closeKeyRef = useRef(d4CloseKey);
  useEffect(() => {
    if (closeKeyRef.current === d4CloseKey) return;
    closeKeyRef.current = d4CloseKey;
    closeD4Section();
  }, [closeD4Section, d4CloseKey]);
  // D4 상세를 여는 버튼은 상세가 열린 동안 사라졌다가 닫히면 다시 그려지므로, 닫을 때 포커스를 돌려받을 새 버튼을 ref로 넘긴다.
  const d4OpenerRef = useRef(null);
  const [detailRequest, setDetailRequest] = useState(null);
  const [selectedRoadZoneName, setSelectedRoadZoneName] = useState(null);

  useEffect(() => {
    onSelectionRef.current = onSelection;
  }, [onSelection]);

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
        cameraControllerRef.current = createBuildingCameraController({
          map,
          vw,
          viewport: document.getElementById(VWORLD_MAP_ID),
          availableArea: document.getElementById(VWORLD_AVAILABLE_AREA_ID),
        });
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
        trafficSimulationRef.current?.dispose();
        trafficSimulationRef.current = createVWorldTrafficSimulation({
          map,
          // 끊긴 뒤 재시도하는 동안에는 "연결 끊김"을 유지해 배지가 깜빡이지 않게 한다.
          onStatus: (status) =>
            setTrafficStatus((previous) =>
              status.state === "connecting" && previous?.state === "disconnected" ? previous : status,
            ),
        });
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
            setSelectedRoadZoneName(null);
            clearRoadZoneHighlight();
            cameraControllerRef.current.focus({
              longitude: cartographic?.longitudeDD,
              latitude: cartographic?.latitudeDD,
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
            setSelectedRoadZoneName(null);
            clearRoadZoneHighlight();
            activateCoordinateMarkerSelection(
              D4_COORDINATE_MARKER,
              onSelectionRef.current,
            );
            setIsD4SectionOpen(true);
            cameraControllerRef.current.focus({
              longitude: D4_COORDINATE_MARKER.longitude,
              latitude: D4_COORDINATE_MARKER.latitude,
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
          setSelectedRoadZoneName(roadZone?.name ?? null);
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
      cameraControllerRef.current?.dispose();
      cameraControllerRef.current = null;
    };
  }, [handleOverlayDataChange, loadAttempt]);

  return (
    <div className="relative h-full w-full">
      {/* 지도 자체에 Legacy 캔버스와 같은 이름을 준다(화면 읽기·랜드마크). */}
      <div id={VWORLD_MAP_ID} role="region" aria-label="순천대 캠퍼스 3D 지도" className="h-full w-full" />
      {mapBackdrop}
      {/* 지도 위 문구와 버튼은 열린 패널을 뺀 지도 영역 안에만 둔다. 상태 문구는 위쪽 왼쪽 열, 지도 조작은 아래쪽 왼쪽 열에
          쌓는다. 절대 위치는 두 열에만 주어 화면이 좁아도 서로 겹치거나 패널 밑으로 들어가지 않는다. */}
      <div
        data-qa="vworld-map-overlays"
        aria-hidden={overlaysHidden ? "true" : undefined}
        className={`pointer-events-none absolute inset-y-0 left-0 transition-[right] duration-300 ${overlaysHidden ? "invisible" : ""}`}
        style={{ right: overlayInsetRight, bottom: overlayInsetBottom }}
      >
        {!isD4SectionOpen && (
          <div
            data-qa="vworld-left-stack"
            className="pointer-events-none absolute left-4 top-[4.5rem] z-20 flex max-w-[calc(100%-2rem)] flex-col items-start gap-3"
          >
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
            {trafficStatus && (
              <StatusBadge tone={TRAFFIC_STATUS[trafficStatus.state]?.tone ?? "warning"} role="status" className="text-caption">
                {TRAFFIC_STATUS[trafficStatus.state]?.label ?? "교통 시뮬레이션 연결 끊김"}
              </StatusBadge>
            )}
            <RepresentativePlanOverlayController
              buildingIds={CAMPUS_REPRESENTATIVE_BUILDING_IDS}
              refreshKey={representativeRefreshKey}
              onOverlayDataChange={handleOverlayDataChange}
              onBuildingSelect={(buildingId) => onSelectionRef.current({
                elementId: `BLD_${buildingId}`,
                buildingId,
                displayName: buildingId,
              })}
              className="pointer-events-auto"
              widthClassName="max-w-[18rem]"
            />
          </div>
        )}
        {!isD4SectionOpen && (
          <div
            data-qa="vworld-bottom-stack"
            className="pointer-events-none absolute bottom-6 left-6 z-10 flex max-w-[calc(100%-3rem)] flex-col items-start gap-3"
          >
            <VWorldCampusStatus
              className="hidden max-w-[280px] lg:block"
              onSelection={(selection) => onSelectionRef.current(selection)}
            />
            {selectedRoadZoneName && (
              <div
                role="status"
                className="pointer-events-auto flex items-center gap-2 rounded-control border border-hairline bg-surface-1 px-3 py-2 text-caption font-semibold text-ink"
              >
                <MapPin size={14} className="text-[var(--colors-primary)]" />
                도로 구역 · {selectedRoadZoneName}
                <button
                  type="button"
                  onClick={() => {
                    if (highlightedRoadZoneRef.current && mapRef.current) {
                      clearRoadZoneOverlays(mapRef.current, highlightedRoadZoneIdsRef.current);
                    }
                    highlightedRoadZoneRef.current = null;
                    highlightedRoadZoneIdsRef.current = [];
                    setSelectedRoadZoneName(null);
                  }}
                  aria-label="도로 구역 정보 닫기"
                  className="ml-1 rounded p-0.5 text-[var(--colors-ink-subtle)] hover:text-[var(--colors-ink)]"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <button
              ref={d4OpenerRef}
              type="button"
              className="dashboard-ghost-button pointer-events-auto min-h-11 px-4 text-xs font-extrabold shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--colors-primary)]"
              onClick={() => {
                activateCoordinateMarkerSelection(D4_COORDINATE_MARKER, onSelectionRef.current);
                setIsD4SectionOpen(true);
              }}
            >
              D4 공과대학 3호관 상세 보기
            </button>
          </div>
        )}
      </div>
      {/* D4 상세는 대시보드 셸의 패인 자리(d4PaneHost)에 그린다. 진입 경로(MODEL_NAME, D4 좌표 표지)는 그대로다. */}
      {isD4SectionOpen && d4PaneHost && createPortal(
        <Suspense
          fallback={
            <div
              className="absolute inset-0 z-30 grid place-items-center bg-slate-950/90 text-sm font-semibold text-slate-100"
              role="status"
            >
              D4 단면 모델을 불러오는 중입니다.
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
            returnFocusRef={d4OpenerRef}
            onClose={closeD4Section}
          />
        </Suspense>,
        d4PaneHost,
      )}
    </div>
  );
}

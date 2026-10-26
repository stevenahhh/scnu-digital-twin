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
  overlaysCovered = false,
  overlayInsetRight = "0px",
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
  const overlaysRef = useRef(null);
  const campusGltfModelRef = useRef(null);
  const trafficSimulationRef = useRef(null);
  const cameraControllerRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  const [campusStatus, setCampusStatus] = useState(null);
  const [trafficStatus, setTrafficStatus] = useState(null);
  const [isD4SectionOpen, setIsD4SectionOpen] = useState(false);
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
  }, [handleOverlayDataChange]);

  // 좁은 화면에서 열린 대시보드 패널은 지도 전체를 덮는다. 그 밑의 지도 오버레이는 보이지 않으므로
  // 포커스·클릭·보조 기술 대상에서 뺀다. D4 상세는 이 묶음 밖에 두어 영향을 받지 않는다.
  useEffect(() => {
    const overlays = overlaysRef.current;
    if (!overlays) return;
    if (overlaysCovered) overlays.setAttribute("inert", "");
    else overlays.removeAttribute("inert");
  }, [overlaysCovered]);

  return (
    <div className="relative h-full w-full">
      <div id={VWORLD_MAP_ID} className="h-full w-full" />
      {mapBackdrop}
      {/* 지도 위 문구와 버튼은 열린 패널을 뺀 지도 영역 안에만 둔다. 상태 문구는 위쪽 왼쪽 열, 지도 조작은 아래쪽 왼쪽 열에
          쌓는다. 절대 위치는 두 열에만 주어 화면이 좁아도 서로 겹치거나 패널 밑으로 들어가지 않는다. */}
      <div
        ref={overlaysRef}
        data-qa="vworld-map-overlays"
        className="pointer-events-none absolute inset-y-0 left-0 transition-[right] duration-300"
        style={{ right: overlayInsetRight }}
      >
        {!isD4SectionOpen && (
          <div
            data-qa="vworld-left-stack"
            className="pointer-events-none absolute left-6 top-6 z-20 flex max-w-[calc(100%-3rem)] flex-col items-start gap-3"
          >
            {isLoading && !hasLoadError && (
              <div aria-live="polite" role="status" className="dashboard-status-badge flex items-center gap-2 px-3 py-2 text-xs">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--colors-hairline)] border-t-[var(--colors-primary)]" />
                VWorld 지도를 불러오는 중입니다.
              </div>
            )}
            {hasLoadError && (
              <div role="alert" className="dashboard-status-badge pointer-events-auto flex items-center gap-3 px-3 py-2 text-xs">
                <span>{loadErrorMessage}</span>
                <button type="button" className="underline" onClick={() => window.location.reload()}>
                  다시 시도
                </button>
              </div>
            )}
            {(campusStatus?.state === "terrain-timeout" || campusStatus?.state === "error") && (
              <div className="dashboard-status-badge pointer-events-auto px-3 py-2 text-xs" role="status">
                {campusStatus.message}
              </div>
            )}
            {trafficStatus && (
              <div className="dashboard-status-badge px-3 py-2 text-xs" role="status">
                {trafficStatus.state === "live"
                  ? "교통 시뮬레이션 연결됨"
                  : trafficStatus.state === "connecting"
                    ? "교통 시뮬레이션 연결 중"
                    : "교통 시뮬레이션 연결 끊김"}
              </div>
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
              widthClassName="max-w-72"
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
                className="dashboard-status-badge pointer-events-auto flex items-center gap-2 px-3 py-2 text-xs font-extrabold shadow-lg"
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
      {isD4SectionOpen && (
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
            onClose={() => {
              setIsD4SectionOpen(false);
              setDetailRequest(null);
              onEditorClose?.();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

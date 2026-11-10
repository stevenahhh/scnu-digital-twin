/* @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createdIds: [],
  receivedBuildingIds: [],
  receivedRenderPanel: [],
  vw: null,
  loaderError: null,
  trafficOnStatus: null,
  highlightStates: [],
}));

vi.mock("./webglSdkLoader.mjs", () => ({
  loadVWorldWebGlSdk: vi.fn(async () => {
    if (mocks.loaderError) throw mocks.loaderError;
    return mocks.vw;
  }),
}));
vi.mock("./sunSimulation.mjs", () => ({ applyVWorldSunSimulation: vi.fn() }));
vi.mock("./campusGltfOverlay.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  createCampusGltfOverlay: vi.fn(async () => null),
  removeCampusGltfOverlay: vi.fn(),
}));
// 선택·호버 강조는 selectionHighlight.test.mjs가 본다. 여기서는 렌더러가 넘기는 선택만 기록한다.
vi.mock("./selectionHighlight.mjs", () => ({
  createVWorldSelectionHighlight: () => ({ set: (state) => mocks.highlightStates.push(state), dispose: () => {} }),
}));
// 라벨 층 자체는 VWorldLabelLayer.test.jsx가 본다. 여기서는 렌더러가 넘기는 값만 기록한다.
vi.mock("./VWorldLabelLayer", () => ({
  centroidOf: (entries) => entries[0].position,
  VWorldLabelLayer: (props) => {
    mocks.labelProps = props;
    return <div data-testid="vworld-label-layer" data-selected={props.selectedId ?? ""} data-hidden={String(props.hidden)} />;
  },
}));
vi.mock("./D4SectionExperience", () => ({
  D4SectionExperience: (props) => {
    mocks.d4Props = props;
    return <div>D4 상세 화면<button type="button" onClick={props.onClose}>D4 상세 닫기</button></div>;
  },
}));
vi.mock("./trafficSimulationOverlay.mjs", () => ({
  createVWorldTrafficSimulation: vi.fn((options) => {
    mocks.trafficOnStatus = options.onStatus;
    return { dispose: vi.fn() };
  }),
}));
vi.mock("./roadZones.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  setRoadZoneHighlighted: vi.fn(() => []),
  clearRoadZoneOverlays: vi.fn(),
}));
vi.mock("./RepresentativePlanOverlayController", () => ({
  RepresentativePlanOverlayController: ({ buildingIds, onOverlayDataChange, className, renderPanel }) => {
    useEffect(() => {
      mocks.receivedBuildingIds.push(...buildingIds);
      mocks.receivedRenderPanel.push(renderPanel);
      onOverlayDataChange([{
        buildingId: "D4",
        installationPlanId: "strict-plan",
        name: "StrictMode plan",
        arrays: [{
          id: "array-1",
          roofId: "D4-roof-west",
          roofZoneId: "D4-roof-west-main",
          footprintMeters: [
            { xMeters: 10, yMeters: 10 },
            { xMeters: 12, yMeters: 10 },
            { xMeters: 12, yMeters: 14 },
            { xMeters: 10, yMeters: 14 },
          ],
        }],
      }]);
      return () => onOverlayDataChange([]);
    }, [onOverlayDataChange]);
    return renderPanel ? <aside aria-label="대표 설치 계획 지도 레이어" className={className} /> : null;
  },
}));

import VWorldRenderer from "./VWorldRenderer.jsx";
import { D4_VWORLD_MODEL_IDS } from "./d4VWorldModel.mjs";
import { findRoadZoneAt, ROAD_ZONES } from "./roadZones.mjs";

class Geometry {
  setId(value) { this.id = value; }
  setName() {}
  setFillColor() {}
  setOutLineColor() {}
  setDistanceFromTerrain() {}
  setExtrudeHeight() {}
  setFont() {}
  setFontSize() {}
  setImage() {}
  create() { mocks.createdIds.push(this.id); }
}

function createVw() {
  class Collection { constructor(values) { this.values = values; } }
  class Coord { constructor(longitude, latitude) { this.longitude = longitude; this.latitude = latitude; } }
  class CoordZ extends Coord { constructor(longitude, latitude, height) { super(longitude, latitude); this.height = height; } }
  return {
    Collection,
    Coord,
    CoordZ,
    Color: class Color {},
    Direction: class Direction {},
    CameraPosition: class CameraPosition {},
    Map: vi.fn(() => { throw new Error("the retained map should be reused"); }),
    geom: {
      PolygonZ: class PolygonZ extends Geometry { constructor(collection) { super(); this.collection = collection; } },
      PointZ: class PointZ extends Geometry {},
    },
  };
}

function retainedMap() {
  return {
    getLayerElement: () => ({ hide: vi.fn() }),
    onClick: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    removeObjectById: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  delete window.__scnuVWorldMapInstance;
  mocks.createdIds.length = 0;
  mocks.receivedBuildingIds.length = 0;
  mocks.receivedRenderPanel.length = 0;
  mocks.loaderError = null;
  mocks.trafficOnStatus = null;
});

class ResizeObserver {
  observe() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserver;

// 앱에서는 대시보드 셸의 D4 패인 자리가 D4 상세를 받는다. 렌더러만 시험할 때는 문서에 같은 자리를 하나 만든다.
const paneHosts = [];
const paneHost = () => {
  const host = document.createElement("div");
  host.dataset.qa = "d4-pane-host";
  document.body.appendChild(host);
  paneHosts.push(host);
  return host;
};
afterEach(() => paneHosts.splice(0).forEach((host) => host.remove()));

describe("VWorldRenderer retained map integration", () => {
  it("keeps solar arrays but hides dashboard controls and traffic in solar presentation", async () => {
    const { createVWorldTrafficSimulation } = await import("./trafficSimulationOverlay.mjs");
    createVWorldTrafficSimulation.mockClear();
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<VWorldRenderer presentationMode onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_REPRESENTATIVE_PANEL_strict-plan_array-1"));
    expect(screen.queryByLabelText("대표 설치 계획 지도 레이어")).toBeNull();
    expect(screen.queryByRole("button", { name: "D4 공과대학 3호관 상세 보기" })).toBeNull();
    expect(screen.queryByTestId("campus-status")).toBeNull();
    expect(createVWorldTrafficSimulation).not.toHaveBeenCalled();
  });

  it("rebinds a reused global map under StrictMode and renders the D4 representative polygon", async () => {
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<StrictMode><VWorldRenderer onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} /></StrictMode>);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_REPRESENTATIVE_PANEL_strict-plan_array-1"));
    expect(mocks.vw.Map).not.toHaveBeenCalled();
    expect(new Set(mocks.receivedBuildingIds)).toEqual(new Set(["C1", "D1", "D2", "D3", "D4"]));
    // 지도 위 대표 설치 계획 카드는 없다(에너지 탭 몫). 렌더러 안의 컨트롤러는 지붕 위 배열만 그린다.
    expect(new Set(mocks.receivedRenderPanel)).toEqual(new Set([false]));
    expect(screen.queryByLabelText("대표 설치 계획 지도 레이어")).toBeNull();
  });

  it("draws the representative overlays the app passes and skips its own controller; [] hides them", async () => {
    mocks.vw = createVw();
    const map = retainedMap();
    window.__scnuVWorldMapInstance = map;
    const overlays = [{
      buildingId: "D4",
      installationPlanId: "app-plan",
      name: "App plan",
      arrays: [{ id: "array-9", roofId: "D4-roof-west", roofZoneId: "D4-roof-west-main", footprintMeters: [
        { xMeters: 10, yMeters: 10 }, { xMeters: 12, yMeters: 10 }, { xMeters: 12, yMeters: 14 }, { xMeters: 10, yMeters: 14 },
      ] }],
    }];
    const props = { onSelection: vi.fn(), simulationDate: new Date("2026-05-18T12:00:00+09:00") };
    const view = render(<VWorldRenderer {...props} representativeOverlays={overlays} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_REPRESENTATIVE_PANEL_app-plan_array-9"));
    expect(mocks.receivedBuildingIds).toEqual([]);
    const created = mocks.createdIds.length;
    view.rerender(<VWorldRenderer {...props} representativeOverlays={[]} />);
    expect(mocks.createdIds.length).toBe(created);
    expect(map.removeObjectById).toHaveBeenCalledWith("SCNU_REPRESENTATIVE_PANEL_app-plan_array-9");
  });

  it("passes Cesium before the status options when creating the campus GLB overlay", async () => {
    const { createCampusGltfOverlay } = await import("./campusGltfOverlay.mjs");
    createCampusGltfOverlay.mockClear();
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

    await waitFor(() => expect(createCampusGltfOverlay).toHaveBeenCalled());
    const [, cesiumArg, options] = createCampusGltfOverlay.mock.calls.at(-1);
    expect(cesiumArg).toBe(window.Cesium);
    expect(typeof options?.onStatus).toBe("function");
  });

  it("mounts the campus label layer with the map, selects through onSelection, follows the app selection and unmounts with the map", async () => {
    const { createCampusGltfOverlay } = await import("./campusGltfOverlay.mjs");
    createCampusGltfOverlay.mockResolvedValueOnce({ modelMatrix: { id: "campus" } });
    // 칩으로 고른 건물로 카메라를 옮기는 데 쓰는 만큼만 흉내 낸 Cesium(모델 지역 좌표를 그대로 라디안 경위도로 읽는다).
    const previousCesium = window.Cesium;
    window.Cesium = {
      Cartesian3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
      Matrix4: { multiplyByPoint: (_matrix, point) => point },
      Cartographic: { fromCartesian: (point) => ({ longitude: point.x, latitude: point.y }) },
    };
    const scene = { id: "scene" };
    const map = { ...retainedMap(), _wsViewer: { scene }, lookat: { moveTo: vi.fn() } };
    window.__scnuVWorldMapInstance = map;
    mocks.vw = createVw();
    const onSelection = vi.fn();
    const onClearSelection = vi.fn();
    const onCampusCamera = vi.fn();
    const props = { d4PaneHost: paneHost(), onSelection, onClearSelection, onCampusCamera, simulationDate: new Date("2026-05-18T12:00:00+09:00") };
    const view = render(<VWorldRenderer {...props} selectedId="" />);

    const layer = await screen.findByTestId("vworld-label-layer");
    expect(mocks.labelProps.scene).toBe(scene);
    expect(mocks.labelProps.getModelMatrix()).toEqual({ id: "campus" });
    expect(mocks.labelProps.chromeRefs.map((ref) => ref.current?.dataset.qa)).toEqual(["vworld-left-stack"]);

    // 칩 선택은 캠퍼스 카메라의 비행 한 번으로만 카메라를 옮긴다. 지도 lookat으로 뛰거나 그 뒤에 돌지 않는다.
    act(() => mocks.labelProps.onSelectEntry({ elementId: "BLD_C1", dataElementId: "BLD_C1", displayName: "도서관", position: [2, 1, 0] }));
    expect(onSelection).toHaveBeenCalledWith({ elementId: "BLD_C1", buildingId: "C1", displayName: "도서관" });
    expect(map.lookat.moveTo).not.toHaveBeenCalled();
    view.rerender(<VWorldRenderer {...props} selectedId="도서관" />);
    expect(layer.dataset.selected).toBe("BLD_C1");
    expect(screen.getByRole("region", { name: "순천대 캠퍼스 3D 지도" }).dataset.selectedId).toBe("BLD_C1");

    // 앱이 선택을 풀면(인스펙터 닫기) 라벨 선택도 풀리고, Esc는 앱에 알린다.
    view.rerender(<VWorldRenderer {...props} selectedId="" />);
    expect(screen.getByTestId("vworld-label-layer").dataset.selected).toBe("");
    act(() => mocks.labelProps.onClear());
    expect(onClearSelection).toHaveBeenCalledTimes(1);

    // The layer hands over the parsed GLB: the renderer builds the preset camera from it.
    act(() => mocks.labelProps.onGlb({ scene: 0, scenes: [{ nodes: [] }], nodes: [] }));
    expect(typeof onCampusCamera.mock.calls.at(-1)[0]?.flyTo).toBe("function");
    expect(screen.getByRole("region", { name: "순천대 캠퍼스 3D 지도" }).dataset.qa).toBe("campus-map-layer");

    view.unmount();
    expect(screen.queryByTestId("vworld-label-layer")).toBeNull();
    expect(onCampusCamera.mock.calls.at(-1)[0]).toBeNull();
    window.Cesium = previousCesium;
  });

  it("puts the D4 fallback model back when the campus GLB fails after the overlay was returned", async () => {
    const { createCampusGltfOverlay } = await import("./campusGltfOverlay.mjs");
    let reportStatus = null;
    createCampusGltfOverlay.mockImplementationOnce(async (_map, _cesium, options) => {
      reportStatus = options.onStatus;
      return { id: "SCNU_D4_GLTF_OVERLAY" };
    });
    mocks.vw = createVw();
    const map = retainedMap();
    window.__scnuVWorldMapInstance = map;
    render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_REPRESENTATIVE_PANEL_strict-plan_array-1"));
    expect(map.removeObjectById).toHaveBeenCalledWith(D4_VWORLD_MODEL_IDS[0]);
    const d4Created = () => mocks.createdIds.filter((id) => D4_VWORLD_MODEL_IDS.includes(id)).length;
    const before = d4Created();

    act(() => reportStatus({ state: "error", message: "캠퍼스 3D 모델을 불러오지 못했습니다" }));

    expect(d4Created()).toBe(before + D4_VWORLD_MODEL_IDS.length);
    expect(screen.getByText("캠퍼스 3D 모델을 불러오지 못했습니다")).toBeTruthy();
  });

  it("keeps the D4 fallback model when the campus GLB fails before the overlay is returned", async () => {
    const { createCampusGltfOverlay } = await import("./campusGltfOverlay.mjs");
    createCampusGltfOverlay.mockImplementationOnce(async (_map, _cesium, options) => {
      options.onStatus({ state: "error", message: "캠퍼스 3D 모델을 불러오지 못했습니다" });
      return { id: "SCNU_D4_GLTF_OVERLAY" };
    });
    mocks.vw = createVw();
    const map = retainedMap();
    window.__scnuVWorldMapInstance = map;
    render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_REPRESENTATIVE_PANEL_strict-plan_array-1"));
    expect(map.removeObjectById).not.toHaveBeenCalledWith(D4_VWORLD_MODEL_IDS[0]);
    expect(screen.getByText("캠퍼스 3D 모델을 불러오지 못했습니다")).toBeTruthy();
  });

  it("shows a Korean message instead of raw exception text for non-loader initialization errors", async () => {
    mocks.loaderError = new TypeError("map.getViewer is not a function");
    try {
      render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} />);

      await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
      const alertText = document.querySelector('[role="alert"]').textContent;
      expect(alertText).toContain("VWorld 지도를 불러오지 못했습니다.");
      expect(alertText).not.toContain("getViewer");
    } finally {
      mocks.loaderError = null;
    }
  });

  it("reports the D4 detail experience opening so the app can hold its building popup", async () => {
    const onD4SectionChange = vi.fn();
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    const props = { d4PaneHost: paneHost(), onSelection: vi.fn(), onD4SectionChange, simulationDate: new Date("2026-05-18T12:00:00+09:00") };
    const view = render(<VWorldRenderer {...props} />);

    await waitFor(() => expect(onD4SectionChange).toHaveBeenCalledWith(false));
    // 지도 위 D4 단추는 없다. 인스펙터의 실내 보기가 d4OpenKey를 올린다.
    expect(screen.queryByRole("button", { name: "D4 공과대학 3호관 상세 보기" })).toBeNull();
    view.rerender(<VWorldRenderer {...props} d4OpenKey={1} />);
    await waitFor(() => expect(onD4SectionChange).toHaveBeenLastCalledWith(true));
    expect(await screen.findByText("D4 상세 화면")).toBeTruthy();
  });

  it("opens D4 through the coordinate-marker selection when d4OpenKey changes, not on mount", async () => {
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    const onSelection = vi.fn();
    const props = { d4PaneHost: paneHost(), onSelection, simulationDate: new Date("2026-05-18T12:00:00+09:00") };
    const view = render(<VWorldRenderer {...props} d4OpenKey={3} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_CAMPUS_AREA"));
    expect(screen.queryByText("D4 상세 화면")).toBeNull();
    view.rerender(<VWorldRenderer {...props} d4OpenKey={4} />);
    expect(await screen.findByText("D4 상세 화면")).toBeTruthy();
    expect(onSelection).toHaveBeenLastCalledWith(expect.objectContaining({ elementId: "BLD_D4", buildingId: "D4" }));
  });

  it("closes D4 details without clearing the new native building selection (F3)", async () => {
    mocks.vw = createVw();
    const map = retainedMap();
    window.__scnuVWorldMapInstance = map;
    const onSelection = vi.fn();
    const onClearSelection = vi.fn();
    const onD4SectionChange = vi.fn();
    const props = { d4PaneHost: paneHost(), onSelection, onClearSelection, onD4SectionChange };
    const view = render(<VWorldRenderer {...props} />);
    // 지도 위 D4 단추는 없다. 인스펙터의 실내 보기가 d4OpenKey를 올려 D4 상세를 연다.
    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_CAMPUS_AREA"));
    view.rerender(<VWorldRenderer {...props} d4OpenKey={1} />);
    expect(await screen.findByText("D4 상세 화면")).toBeTruthy();

    const pick = map.onClick.addEventListener.mock.calls.at(-1)[0];
    act(() => pick(null, null, null, { attributes: { MODEL_NAME: "SC090091" } }));

    expect(screen.queryByText("D4 상세 화면")).toBeNull();
    expect(onD4SectionChange).toHaveBeenLastCalledWith(false);
    expect(onSelection).toHaveBeenLastCalledWith({ elementId: "BLD_E3", buildingId: "E3", displayName: "사범대학" });
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it("keeps the map overlays focusable (the phone sheet leaves the map usable) and never puts the D4 detail inside them", async () => {
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    const simulationDate = new Date("2026-05-18T12:00:00+09:00");
    const props = { d4PaneHost: paneHost(), onSelection: vi.fn(), simulationDate, overlayInsetRight: "0px" };
    const view = render(<VWorldRenderer {...props} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_CAMPUS_AREA"));
    const overlays = document.querySelector('[data-qa="vworld-map-overlays"]');
    expect(overlays.hasAttribute("inert")).toBe(false);

    view.rerender(<VWorldRenderer {...props} d4OpenKey={1} />);
    const detail = await screen.findByText("D4 상세 화면");
    expect(detail.closest('[data-qa="vworld-map-overlays"]')).toBeNull();
  });

  it("renders the SDK loader error message and a retry that runs the loader again without reloading the page", async () => {
    mocks.loaderError = Object.assign(new Error("VWorld API 키가 없습니다. frontend/.env 에 VITE_VWORLD_API_KEY 를 설정하세요."), { code: "VWORLD_KEY_MISSING" });
    const { loadVWorldWebGlSdk } = await import("./webglSdkLoader.mjs");
    render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(document.querySelector('[role="alert"]').textContent).toContain(
      "VWorld API 키가 없습니다. frontend/.env 에 VITE_VWORLD_API_KEY 를 설정하세요.",
    );
    const callsBefore = loadVWorldWebGlSdk.mock.calls.length;
    const retryButton = within(document.querySelector('[role="alert"]')).getByRole("button", { name: "다시 시도" });
    fireEvent.click(retryButton);
    await waitFor(() => expect(loadVWorldWebGlSdk.mock.calls.length).toBe(callsBefore + 1));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("VWorldRenderer left overlay stack", () => {
  it.each([
    { state: "terrain-timeout", message: "지형 높이를 확인하지 못해 건물 높이가 부정확할 수 있습니다" },
    { state: "error", message: "캠퍼스 3D 모델을 불러오지 못했습니다" },
  ])("shows the $state chip in the top-left column and no plan card on the map", async (status) => {
    const { createCampusGltfOverlay } = await import("./campusGltfOverlay.mjs");
    let reportStatus = null;
    createCampusGltfOverlay.mockImplementationOnce(async (_map, _cesium, options) => {
      reportStatus = options.onStatus;
      return null;
    });
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_REPRESENTATIVE_PANEL_strict-plan_array-1"));
    expect(screen.queryByText(status.message)).toBeNull();

    act(() => reportStatus(status));

    const chip = screen.getByText(status.message);
    const stack = chip.parentElement;
    expect(chip.getAttribute("role")).toBe("status");
    expect(stack.getAttribute("data-qa")).toBe("vworld-left-stack");
    expect(stack.className).toContain("flex-col");
    expect(chip.className).not.toContain("absolute");
    expect(screen.queryByLabelText("대표 설치 계획 지도 레이어")).toBeNull();
  });
});

describe("VWorldRenderer map control layout", () => {
  const simulationDate = new Date("2026-05-18T12:00:00+09:00");
  const terrainMessage = "지형 높이를 확인하지 못해 건물 높이가 부정확할 수 있습니다";

  function roadZonePoint() {
    for (const zone of ROAD_ZONES) {
      const ring = zone.rings[0];
      const xs = ring.map(([x]) => x);
      const ys = ring.map(([, y]) => y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      for (let i = 1; i < 40; i += 1) {
        for (let j = 1; j < 40; j += 1) {
          const longitude = x0 + ((x1 - x0) * i) / 40;
          const latitude = y0 + ((y1 - y0) * j) / 40;
          if (findRoadZoneAt(longitude, latitude)?.id === zone.id) return { zone, longitude, latitude };
        }
      }
    }
    throw new Error("no road-zone interior point");
  }

  it("puts no traffic simulation badge on the map (the simulation tab header reports the connection)", async () => {
    const { createVWorldTrafficSimulation } = await import("./trafficSimulationOverlay.mjs");
    createVWorldTrafficSimulation.mockClear();
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={simulationDate} />);

    await waitFor(() => expect(createVWorldTrafficSimulation).toHaveBeenCalled());
    expect(mocks.trafficOnStatus).toBeUndefined();
    expect(screen.queryByText(/교통 시뮬레이션 연결/)).toBeNull();
  });

  it("puts a map load failure and its retry first in the top-left column", async () => {
    mocks.loaderError = Object.assign(new Error("VWorld SDK를 불러오지 못했습니다. 네트워크를 확인하세요."), { code: "VWORLD_SDK_UNAVAILABLE" });
    render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={simulationDate} />);

    const alert = (await screen.findByText("VWorld SDK를 불러오지 못했습니다. 네트워크를 확인하세요.")).closest('[role="alert"]');
    const column = document.querySelector('[data-qa="vworld-left-stack"]');
    expect(column.firstElementChild).toBe(alert);
    expect(within(alert).getByRole("button", { name: "다시 시도" })).toBeTruthy();
    expect(alert.className).toMatch(/\bpointer-events-auto\b/);
  });

  it("shows the map loading message first in the top-left column while the map starts", async () => {
    const { createCampusGltfOverlay } = await import("./campusGltfOverlay.mjs");
    createCampusGltfOverlay.mockImplementationOnce(() => new Promise(() => {}));
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={simulationDate} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_CAMPUS_AREA"));
    const loading = screen.getByText("VWorld 지도를 불러오는 중입니다.").closest('[role="status"]');
    const column = document.querySelector('[data-qa="vworld-left-stack"]');
    expect(column.firstElementChild).toBe(loading);
  });

  it("highlights a clicked road zone on the map without a chip, a SOLAR card or a D4 opener over the map", async () => {
    const { setRoadZoneHighlighted } = await import("./roadZones.mjs");
    setRoadZoneHighlighted.mockClear();
    const map = retainedMap();
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = map;
    render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={simulationDate} />);

    await waitFor(() => expect(map.onClick.addEventListener).toHaveBeenCalled());
    const handleMapClick = map.onClick.addEventListener.mock.calls.at(-1)[0];
    const { zone, longitude, latitude } = roadZonePoint();
    act(() => handleMapClick(null, null, { longitudeDD: longitude, latitudeDD: latitude }, null));

    expect(setRoadZoneHighlighted).toHaveBeenCalledWith(map, zone);
    expect(screen.queryByRole("button", { name: "도로 구역 정보 닫기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "D4 공과대학 3호관 상세 보기" })).toBeNull();
    expect(screen.queryByTestId("campus-status")).toBeNull();
    expect(document.querySelector('[data-qa="vworld-bottom-stack"]')).toBeNull();
  });

  it("lays the map overlays out inside the visible map area", async () => {
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    const { rerender } = render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={simulationDate} overlayInsetRight="var(--dashboard-panel-width)" />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_CAMPUS_AREA"));
    const overlays = document.querySelector('[data-qa="vworld-map-overlays"]');
    expect(overlays.className).toMatch(/\babsolute\b/);
    // 패널이 여닫혀도 지도 위 열은 right를 애니메이션하지 않고 바로 자리 잡는다(레이아웃 속성 전환 금지).
    expect(overlays.className).not.toMatch(/transition/);
    expect(overlays.style.right).toBe("var(--dashboard-panel-width)");

    rerender(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={simulationDate} overlayInsetRight="0px" />);
    expect(overlays.style.right).toBe("0px");
  });

  it("draws the map backdrop right above the map and below the map controls", async () => {
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<VWorldRenderer d4PaneHost={paneHost()} onSelection={vi.fn()} simulationDate={simulationDate} mapBackdrop={<div data-testid="map-backdrop" />} />);

    const backdrop = screen.getByTestId("map-backdrop");
    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_CAMPUS_AREA"));
    const overlays = document.querySelector('[data-qa="vworld-map-overlays"]');
    expect(backdrop.previousElementSibling.id).toBe("vmap");
    expect(backdrop.nextElementSibling).toBe(overlays);
    expect(overlays.contains(backdrop)).toBe(false);
  });
});

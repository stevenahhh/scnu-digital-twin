/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createdIds: [],
  receivedBuildingIds: [],
  vw: null,
  loaderError: null,
  trafficOnStatus: null,
}));

vi.mock("./webglSdkLoader.mjs", () => ({
  loadVWorldWebGlSdk: vi.fn(async () => {
    if (mocks.loaderError) throw mocks.loaderError;
    return mocks.vw;
  }),
}));
vi.mock("./sunSimulation.mjs", () => ({ applyVWorldSunSimulation: vi.fn() }));
vi.mock("./campusGltfOverlay.mjs", () => ({
  createCampusGltfOverlay: vi.fn(async () => null),
  removeCampusGltfOverlay: vi.fn(),
}));
vi.mock("./D4SectionExperience", () => ({
  D4SectionExperience: (props) => {
    mocks.d4Props = props;
    return <div>D4 상세 화면<button type="button" onClick={props.onClose}>D4 상세 닫기</button></div>;
  },
}));
vi.mock("./VWorldCampusStatus", () => ({
  VWorldCampusStatus: ({ className }) => <aside data-testid="campus-status" className={className} />,
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
  RepresentativePlanOverlayController: ({ buildingIds, onOverlayDataChange, className }) => {
    useEffect(() => {
      mocks.receivedBuildingIds.push(...buildingIds);
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
    return <aside aria-label="대표 설치 계획 지도 레이어" className={className} />;
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
  mocks.loaderError = null;
  mocks.trafficOnStatus = null;
});

class ResizeObserver {
  observe() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserver;

describe("VWorldRenderer retained map integration", () => {
  it("rebinds a reused global map under StrictMode and renders the D4 representative polygon", async () => {
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<StrictMode><VWorldRenderer onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} /></StrictMode>);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_REPRESENTATIVE_PANEL_strict-plan_array-1"));
    expect(mocks.vw.Map).not.toHaveBeenCalled();
    expect(new Set(mocks.receivedBuildingIds)).toEqual(new Set(["C1", "D1", "D2", "D3", "D4"]));
  });

  it("passes Cesium before the status options when creating the campus GLB overlay", async () => {
    const { createCampusGltfOverlay } = await import("./campusGltfOverlay.mjs");
    createCampusGltfOverlay.mockClear();
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<VWorldRenderer onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

    await waitFor(() => expect(createCampusGltfOverlay).toHaveBeenCalled());
    const [, cesiumArg, options] = createCampusGltfOverlay.mock.calls.at(-1);
    expect(cesiumArg).toBe(window.Cesium);
    expect(typeof options?.onStatus).toBe("function");
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
    render(<VWorldRenderer onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

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
    render(<VWorldRenderer onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_REPRESENTATIVE_PANEL_strict-plan_array-1"));
    expect(map.removeObjectById).not.toHaveBeenCalledWith(D4_VWORLD_MODEL_IDS[0]);
    expect(screen.getByText("캠퍼스 3D 모델을 불러오지 못했습니다")).toBeTruthy();
  });

  it("shows a Korean message instead of raw exception text for non-loader initialization errors", async () => {
    mocks.loaderError = new TypeError("map.getViewer is not a function");
    try {
      render(<VWorldRenderer onSelection={vi.fn()} />);

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
    render(<VWorldRenderer onSelection={vi.fn()} onD4SectionChange={onD4SectionChange} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

    await waitFor(() => expect(onD4SectionChange).toHaveBeenCalledWith(false));
    fireEvent.click(await screen.findByRole("button", { name: "D4 공과대학 3호관 상세 보기" }));
    await waitFor(() => expect(onD4SectionChange).toHaveBeenLastCalledWith(true));
    expect(await screen.findByText("D4 상세 화면")).toBeTruthy();
  });

  it("hands the re-rendered D4 opener to the detail experience as its focus return target", async () => {
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<VWorldRenderer onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

    fireEvent.click(await screen.findByRole("button", { name: "D4 공과대학 3호관 상세 보기" }));
    expect(await screen.findByText("D4 상세 화면")).toBeTruthy();
    const { returnFocusRef } = mocks.d4Props;
    expect(screen.queryByRole("button", { name: "D4 공과대학 3호관 상세 보기" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "D4 상세 닫기" }));
    const opener = await screen.findByRole("button", { name: "D4 공과대학 3호관 상세 보기" });
    expect(returnFocusRef.current).toBe(opener);
  });

  it("takes the map overlays out of focus while the open dashboard panel covers the map, but never the D4 detail", async () => {
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    const simulationDate = new Date("2026-05-18T12:00:00+09:00");
    const { rerender } = render(<VWorldRenderer onSelection={vi.fn()} simulationDate={simulationDate} overlaysCovered />);

    const opener = await screen.findByRole("button", { name: "D4 공과대학 3호관 상세 보기" });
    const overlays = opener.closest('[data-qa="vworld-map-overlays"]');
    expect(overlays.hasAttribute("inert")).toBe(true);

    rerender(<VWorldRenderer onSelection={vi.fn()} simulationDate={simulationDate} overlaysCovered={false} />);
    expect(overlays.hasAttribute("inert")).toBe(false);

    fireEvent.click(opener);
    const detail = await screen.findByText("D4 상세 화면");
    expect(detail.closest('[data-qa="vworld-map-overlays"]')).toBeNull();
  });

  it("renders the SDK loader error message and retry action", async () => {
    mocks.loaderError = Object.assign(new Error("VWorld API 키가 없습니다. frontend/.env 에 VITE_VWORLD_API_KEY 를 설정하세요."), { code: "VWORLD_KEY_MISSING" });
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });
    render(<VWorldRenderer onSelection={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(document.querySelector('[role="alert"]').textContent).toContain(
      "VWorld API 키가 없습니다. frontend/.env 에 VITE_VWORLD_API_KEY 를 설정하세요.",
    );
    const retryButton = document.querySelector('[role="alert"] button');
    expect(retryButton.textContent).toContain("다시 시도");
    retryButton.click();
    expect(reload).toHaveBeenCalledOnce();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });
});

describe("VWorldRenderer left overlay stack", () => {
  it.each([
    { state: "terrain-timeout", message: "지형 높이를 확인하지 못해 건물 높이가 부정확할 수 있습니다" },
    { state: "error", message: "캠퍼스 3D 모델을 불러오지 못했습니다" },
  ])("stacks the $state chip above the representative plan card instead of under it", async (status) => {
    const { createCampusGltfOverlay } = await import("./campusGltfOverlay.mjs");
    let reportStatus = null;
    createCampusGltfOverlay.mockImplementationOnce(async (_map, _cesium, options) => {
      reportStatus = options.onStatus;
      return null;
    });
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<VWorldRenderer onSelection={vi.fn()} simulationDate={new Date("2026-05-18T12:00:00+09:00")} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_REPRESENTATIVE_PANEL_strict-plan_array-1"));
    expect(screen.queryByText(status.message)).toBeNull();

    act(() => reportStatus(status));

    const chip = screen.getByText(status.message);
    const card = screen.getByLabelText("대표 설치 계획 지도 레이어");
    const stack = chip.parentElement;
    expect(chip.getAttribute("role")).toBe("status");
    expect(card.parentElement).toBe(stack);
    expect(stack.getAttribute("data-qa")).toBe("vworld-left-stack");
    expect(stack.className).toContain("flex-col");
    const children = Array.from(stack.children);
    expect(children.indexOf(chip)).toBeLessThan(children.indexOf(card));
    expect(chip.className).not.toContain("absolute");
    expect(chip.className).not.toContain("top-16");
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

  it("stacks the terrain chip, the traffic badge and the plan card in that order in the top-left column", async () => {
    const { createCampusGltfOverlay } = await import("./campusGltfOverlay.mjs");
    let reportStatus = null;
    createCampusGltfOverlay.mockImplementationOnce(async (_map, _cesium, options) => {
      reportStatus = options.onStatus;
      return null;
    });
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    render(<VWorldRenderer onSelection={vi.fn()} simulationDate={simulationDate} />);

    await waitFor(() => expect(mocks.trafficOnStatus).toBeTypeOf("function"));
    act(() => {
      reportStatus({ state: "terrain-timeout", message: terrainMessage });
      mocks.trafficOnStatus({ state: "live" });
    });

    const column = document.querySelector('[data-qa="vworld-left-stack"]');
    const chip = screen.getByText(terrainMessage);
    const traffic = screen.getByText("교통 시뮬레이션 연결됨");
    const card = screen.getByLabelText("대표 설치 계획 지도 레이어");
    for (const element of [chip, traffic, card]) expect(element.parentElement).toBe(column);
    const children = Array.from(column.children);
    expect(children.indexOf(chip)).toBeLessThan(children.indexOf(traffic));
    expect(children.indexOf(traffic)).toBeLessThan(children.indexOf(card));
    expect(traffic.getAttribute("role")).toBe("status");
    expect(traffic.className).not.toMatch(/\babsolute\b/);
  });

  it("puts a map load failure and its retry first in the top-left column", async () => {
    mocks.loaderError = Object.assign(new Error("VWorld SDK를 불러오지 못했습니다. 네트워크를 확인하세요."), { code: "VWORLD_SDK_UNAVAILABLE" });
    render(<VWorldRenderer onSelection={vi.fn()} simulationDate={simulationDate} />);

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
    render(<VWorldRenderer onSelection={vi.fn()} simulationDate={simulationDate} />);

    await waitFor(() => expect(mocks.createdIds).toContain("SCNU_CAMPUS_AREA"));
    const loading = screen.getByText("VWorld 지도를 불러오는 중입니다.").closest('[role="status"]');
    const column = document.querySelector('[data-qa="vworld-left-stack"]');
    expect(column.firstElementChild).toBe(loading);
  });

  it("keeps the SOLAR card, a selected road-zone chip and the D4 opener in one bottom-left column", async () => {
    const map = retainedMap();
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = map;
    render(<VWorldRenderer onSelection={vi.fn()} simulationDate={simulationDate} />);

    await waitFor(() => expect(map.onClick.addEventListener).toHaveBeenCalled());
    const handleMapClick = map.onClick.addEventListener.mock.calls.at(-1)[0];
    const { zone, longitude, latitude } = roadZonePoint();
    act(() => handleMapClick(null, null, { longitudeDD: longitude, latitudeDD: latitude }, null));

    const chip = (await screen.findByRole("button", { name: "도로 구역 정보 닫기" })).closest('[role="status"]');
    expect(chip.textContent).toContain(zone.name);
    const opener = screen.getByRole("button", { name: "D4 공과대학 3호관 상세 보기" });
    const campus = screen.getByTestId("campus-status");
    const column = opener.parentElement;
    expect(column.getAttribute("data-qa")).toBe("vworld-bottom-stack");
    for (const element of [campus, chip]) expect(element.parentElement).toBe(column);
    const children = Array.from(column.children);
    expect(children.indexOf(campus)).toBeLessThan(children.indexOf(chip));
    expect(children.indexOf(chip)).toBeLessThan(children.indexOf(opener));
    for (const element of [campus, chip, opener]) expect(element.className).not.toMatch(/\babsolute\b/);
    expect(campus.className).toBe("hidden max-w-[280px] lg:block");
  });

  it("lays the map overlays out inside the visible map area", async () => {
    mocks.vw = createVw();
    window.__scnuVWorldMapInstance = retainedMap();
    const { rerender } = render(<VWorldRenderer onSelection={vi.fn()} simulationDate={simulationDate} overlayInsetRight="var(--dashboard-panel-width)" />);

    const overlays = (await screen.findByRole("button", { name: "D4 공과대학 3호관 상세 보기" })).closest('[data-qa="vworld-map-overlays"]');
    expect(overlays.className).toMatch(/\babsolute\b/);
    expect(overlays.style.right).toBe("var(--dashboard-panel-width)");

    rerender(<VWorldRenderer onSelection={vi.fn()} simulationDate={simulationDate} overlayInsetRight="0px" />);
    expect(overlays.style.right).toBe("0px");
  });
});

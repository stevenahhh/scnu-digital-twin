/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createdIds: [],
  receivedBuildingIds: [],
  vw: null,
  loaderError: null,
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
vi.mock("./D4SectionExperience", () => ({ D4SectionExperience: () => <div>D4 상세 화면</div> }));
vi.mock("./VWorldCampusStatus", () => ({ VWorldCampusStatus: () => null }));
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

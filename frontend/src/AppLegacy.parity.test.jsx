/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const installationClient = {
  listDetails: vi.fn(async () => []),
  getRepresentative: vi.fn(async () => null),
};

vi.mock("@react-three/fiber", () => ({ Canvas: ({ children }) => <div>{children}</div> }));
// OrbitControls는 실제 three EventDispatcher 위에 얼임 잡은 가짜 컨트롤을 ref로 내준다. 시점 비행이 진짜 start/end 이벤트와
// camera.position/target 갱신을 거치는지 보기 위해서다. useProgress는 테스트마다 바꿀 수 있는 상태를 돌려준다.
const controlsMock = vi.hoisted(() => ({ current: null, create: null }));
const progressMock = vi.hoisted(() => ({ state: { active: false, loaded: 0, total: 0, progress: 0, item: "", errors: [] } }));
const fileLoaderMock = vi.hoisted(() => ({ loads: [] }));
vi.mock("@react-three/drei", async () => {
  const React = await import("react");
  const { EventDispatcher, Vector3 } = await import("three");
  class FakeControls extends EventDispatcher {
    constructor() {
      super();
      this.object = { position: new Vector3(0, 260, 260) };
      this.target = new Vector3(0, 0, 0);
      this.updates = 0;
      this.events = [];
      this.addEventListener("start", (event) => this.events.push(event.flyTo ? "start:flyTo" : "start"));
      this.addEventListener("end", () => this.events.push("end"));
    }
    update() {
      this.updates += 1;
    }
  }
  controlsMock.create = () => new FakeControls();
  return {
    OrbitControls: React.forwardRef(function OrbitControlsMock({ onStart, onEnd }, ref) {
      React.useImperativeHandle(ref, () => controlsMock.current, []);
      React.useEffect(() => {
        const controls = controlsMock.current;
        const handleStart = (event) => onStart?.(event);
        const handleEnd = (event) => onEnd?.(event);
        controls.addEventListener("start", handleStart);
        controls.addEventListener("end", handleEnd);
        return () => {
          controls.removeEventListener("start", handleStart);
          controls.removeEventListener("end", handleEnd);
        };
      }, [onStart, onEnd]);
      return null;
    }),
    Sky: () => null,
    useProgress: () => progressMock.state,
  };
});
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal();
  class FileLoaderMock {
    setResponseType() {
      return this;
    }
    load(url, onLoad, onProgress) {
      fileLoaderMock.loads.push({ url, onLoad, onProgress });
    }
  }
  return { ...actual, FileLoader: FileLoaderMock };
});
vi.mock("./lighting/CampusLighting", () => ({ CAMPUS_CANVAS_GL: {}, CampusLighting: () => null }));
vi.mock("./lighting/ShadowBaker", () => ({ ShadowBaker: () => null }));
vi.mock("./weather/SceneWeatherBinding", () => ({ SceneWeatherBinding: () => null }));
const sceneMock = vi.hoisted(() => ({ suspend: false, fail: false }));
vi.mock("./CityModel", () => ({
  // suspend가 켜지면 끝나지 않는 Promise를 던져 Suspense fallback이 계속 떠 있게 한다. fail이 켜지면 오류를 던져 3D 실패 안내를 띄운다.
  CityModel: (props) => {
    sceneMock.cityModelProps = props;
    if (sceneMock.fail) throw new Error("3D model failed");
    if (sceneMock.suspend) throw new Promise(() => {});
    return null;
  },
}));
vi.mock("./simulation", () => ({
  CampusTrafficSimulation: () => null,
  TrafficSafetyPanel: () => null,
  useSimulationSocket: vi.fn(),
}));
vi.mock("./vworld/D4SectionExperience", () => ({ D4SectionExperience: () => null }));
vi.mock("./features/energy/analysis", () => ({
  BuildingAnalysis: ({ plansStatus }) => <div data-plans-status={plansStatus}>건물 에너지 분석</div>,
}));
vi.mock("./features/energy/campus/CampusComparisonPanel", () => ({
  CampusComparison: () => <div>캠퍼스 태양광 비교</div>,
}));
vi.mock("./features/energy/dashboard/EnergyDashboard", () => ({
  EnergyDashboard: () => <div>건물 에너지 시뮬레이션</div>,
}));
vi.mock("./vworld/VWorldCampusStatus", () => ({
  VWorldCampusStatus: () => <div>캠퍼스 설치 현황</div>,
}));
vi.mock("./features/energy/installations/installationPlanApi.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createInstallationPlanClient: () => installationClient };
});

import App from "./AppLegacy.jsx";
import { CAMERA_PRESETS } from "./camera/cameraPresets.mjs";

const C5_TABS = ["기본 현황", "주차·안전", "에너지", "환경 시뮬"];
const TRAFFIC_OFFLINE = "영상 분석 서버 연결 없음";
const TRAFFIC_LIVE = "실시간 영상 분석 중";
const WEATHER_NETWORK = "기상 서버에 연결할 수 없습니다";
const SCENE_LOADING = "3D 캠퍼스 모델을 불러오는 중입니다";
const SCENE_SLOW = "3D 캠퍼스 모델 응답이 지연되고 있습니다. 네트워크를 확인하세요.";
const SCENE_SLOW_AFTER_MS = 15000;

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const rejectNetwork = async () => {
  throw new TypeError("Failed to fetch");
};

function stubFetch({
  weather = async () => okJson({ base_weather: null }),
  traffic = async () => okJson({ is_running: true }),
} = {}) {
  const fetchMock = vi.fn(async (url) => {
    const target = String(url);
    if (target.includes("/api/traffic")) return traffic();
    if (target.includes("/environment/full")) return weather();
    return okJson({ base_weather: null });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Not a sleep: a 0 ms macrotask fires only after every pending promise continuation of the rejected poll has run.
const settlePendingFetches = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const countCalls = (fetchMock, fragment) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(fragment)).length;

beforeEach(() => {
  stubFetch();
  window.matchMedia = vi.fn(() => ({ matches: false }));
  controlsMock.current = controlsMock.create();
  progressMock.state = { active: false, loaded: 0, total: 0, progress: 0, item: "", errors: [] };
  fileLoaderMock.loads.length = 0;
});

const presetButtons = (container) => CAMERA_PRESETS.map((preset) => container.querySelector(`[data-qa="camera-preset-${preset.id}"]`));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Legacy and VWorld feature parity", () => {
  it("renders the VWorld campus status and full energy surfaces inside the energy tab", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "에너지" }));
    expect(screen.getByText("캠퍼스 설치 현황")).toBeTruthy();
    expect(screen.getByText("건물 에너지 분석")).toBeTruthy();
    expect(screen.getByText("캠퍼스 태양광 비교")).toBeTruthy();
    expect(screen.getByText("건물 에너지 시뮬레이션")).toBeTruthy();
  });

  it("renders exactly the four C5 dashboard tabs in order", () => {
    const { container } = render(<App />);

    const labels = [...container.querySelectorAll('[data-qa^="dashboard-tab-"]')].map((tab) => tab.textContent.trim());
    expect(labels).toEqual(C5_TABS);
    for (const label of C5_TABS) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
  });

  it("tells the energy analysis whether installation plans are loading, failed or ready", async () => {
    let finishLoading;
    installationClient.listDetails.mockImplementationOnce(() => new Promise((resolve) => { finishLoading = resolve; }));
    const view = render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "에너지" }));
    expect(screen.getByText("건물 에너지 분석").getAttribute("data-plans-status")).toBe("loading");
    await act(async () => finishLoading([]));
    expect(screen.getByText("건물 에너지 분석").getAttribute("data-plans-status")).toBe("ready");
    view.unmount();

    installationClient.listDetails.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "에너지" }));
    expect(await screen.findByText("설치 계획을 불러오지 못했습니다")).toBeTruthy();
    expect(screen.getByText("건물 에너지 분석").getAttribute("data-plans-status")).toBe("error");
  });

  it("shows the traffic offline message in the parking card when the traffic fetch rejects", async () => {
    const fetchMock = stubFetch({ traffic: rejectNetwork });
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "주차·안전" }));
    await waitFor(() => expect(countCalls(fetchMock, "/api/traffic")).toBeGreaterThan(0));
    await settlePendingFetches();

    expect(screen.getByText("D4 입출차 현황")).toBeTruthy();
    expect(screen.getByText(TRAFFIC_OFFLINE)).toBeTruthy();
    expect(screen.queryByText(TRAFFIC_LIVE)).toBeNull();
  });

  it("opens the 설정 dialog from its labelled button and closes it on Escape", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "설정" }));
    const dialog = screen.getByRole("dialog", { name: "설정" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByRole("button", { name: "닫기" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the weather network message with a working 다시 시도 button when the weather fetch rejects", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ weather: rejectNetwork });
    render(<App />);

    const message = await screen.findByText(WEATHER_NETWORK);
    const strip = message.closest("div");
    const retry = within(strip).getByRole("button", { name: "다시 시도" });

    const weatherCallsBefore = countCalls(fetchMock, "/environment/full");
    await user.click(retry);
    await waitFor(() => expect(countCalls(fetchMock, "/environment/full")).toBe(weatherCallsBefore + 1));
    expect(await screen.findByText(WEATHER_NETWORK)).toBeTruthy();
  });

  it("shows the delay message with a reloading 다시 시도 button once the 3D model has been loading for 15 s", async () => {
    sceneMock.suspend = true;
    vi.useFakeTimers();
    try {
      render(<App />);

      const badge = screen.getByText(SCENE_LOADING).closest('[role="status"]');
      expect(badge).toBeTruthy();
      expect(screen.queryByText(SCENE_SLOW)).toBeNull();
      expect(within(badge).queryByRole("button", { name: "다시 시도" })).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(SCENE_SLOW_AFTER_MS - 1);
      });
      expect(screen.queryByText(SCENE_SLOW)).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      const slowBadge = screen.getByText(SCENE_SLOW).closest('[role="status"]');
      const retry = within(slowBadge).getByRole("button", { name: "다시 시도" });
      expect(retry.getAttribute("type")).toBe("button");
      expect(screen.queryByText(SCENE_LOADING)).toBeNull();

      const reload = vi.fn();
      vi.stubGlobal("location", { ...window.location, reload });
      fireEvent.click(retry);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      sceneMock.suspend = false;
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("takes the 3D map out of focus while the open panel covers a narrow viewport, and hands CityModel the panel that hides labels", () => {
    vi.stubGlobal("innerWidth", 390);
    const { container } = render(<App />);
    const mapLayer = container.querySelector('[data-qa="campus-map-layer"]');
    expect(sceneMock.cityModelProps.occluderRef.current).toBe(container.querySelector('[data-qa="dashboard-panel"]'));
    expect(mapLayer.hasAttribute("inert")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
    expect(mapLayer.hasAttribute("inert")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "패널 열기" }));
    expect(mapLayer.hasAttribute("inert")).toBe(true);

    vi.stubGlobal("innerWidth", 1024);
    fireEvent(window, new Event("resize"));
    expect(mapLayer.hasAttribute("inert")).toBe(false);
  });

  it("hands CityModel the map chrome (HUD layer and panel toggle) that campus labels must stay beneath", () => {
    const { container } = render(<App />);
    const chrome = sceneMock.cityModelProps.chromeRefs.map((ref) => ref.current);
    const hud = container.querySelector('[data-qa="campus-hud"]');
    expect(chrome).toContain(hud);
    expect(hud.hasAttribute("data-label-chrome-layer")).toBe(true);
    expect(chrome).toContain(screen.getByRole("button", { name: "패널 닫기" }));
    // 라벨 층은 지면 시점(정문)에서 거리 단계로 바뀌므로 눌린 시점을 함께 받는다.
    expect(sceneMock.cityModelProps.activePresetId).toBe("overview");
    fireEvent.click(container.querySelector('[data-qa="camera-preset-gate"]'));
    expect(sceneMock.cityModelProps.activePresetId).toBe("gate");
  });

  it("titles the selection panel with the building's label name, not its BLD_* id, when the popup API is down", async () => {
    stubFetch();
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/popup")) throw new TypeError("Failed to fetch");
      return okJson({ base_weather: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<App />);
      await act(async () => {
        sceneMock.cityModelProps.onSelect("BLD_E1");
        await sceneMock.cityModelProps.onBuildingClick({
          name: "BLD_E1",
          parent: { name: "BLD_E1" },
          userData: { buildingLabel: "학생회관" },
        });
      });
      expect(screen.getByRole("heading", { level: 3, name: "학생회관" })).toBeTruthy();
      expect(screen.queryByRole("heading", { level: 3, name: "BLD_E1" })).toBeNull();
      // 라벨 강조는 그대로 요소 id로 맞춘다.
      expect(sceneMock.cityModelProps.selectedId).toBe("BLD_E1");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("clicking 도서관 keeps title 도서관 for 5 s with proximity events firing, until the user drags", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/popup")) return okJson({ thermal: { local_temp: 21.4 } });
      return okJson({ base_weather: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      render(<App />);
      // 사용자가 시점에서 벗어난 상태(시점 버튼에 있는 동안은 근접 자동 선택이 원래 꺼져 있다).
      act(() => controlsMock.current.dispatchEvent({ type: "start" }));
      await act(async () => {
        sceneMock.cityModelProps.onSelect("BLD_C1", 1200, [0, 0, 0], "BLD_C1");
        await sceneMock.cityModelProps.onBuildingClick({ name: "BLD_C1", parent: { name: "BLD_C1" }, userData: { buildingLabel: "도서관" } });
      });
      expect(screen.getByRole("heading", { level: 3, name: "도서관" })).toBeTruthy();

      const neighbour = { elementId: "BLD_E5", name: "BLD_E5", displayName: "사범대학 3호관", position: [0, 0, 0] };
      for (let sample = 0; sample < 10; sample += 1) {
        await act(async () => {
          sceneMock.cityModelProps.onBuildingProximity(sample % 3 === 2 ? null : neighbour);
          vi.advanceTimersByTime(500);
        });
        expect(screen.getByRole("heading", { level: 3, name: "도서관" })).toBeTruthy();
        expect(sceneMock.cityModelProps.selectedElementId).toBe("BLD_C1");
      }
      // 칩의 호버 미리보기는 이미 받은 팝업 값에서 온다.
      expect(sceneMock.cityModelProps.headlineById).toEqual({ BLD_C1: "추정 21.4°C" });

      // 드래그를 시작하면 근접 자동 선택이 다시 따른다.
      act(() => sceneMock.cityModelProps.onDragStart());
      await act(async () => {
        sceneMock.cityModelProps.onBuildingProximity(neighbour);
      });
      expect(screen.getByRole("heading", { level: 3, name: "사범대학 3호관" })).toBeTruthy();
      expect(sceneMock.cityModelProps.selectedElementId).toBe("BLD_E5");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the building selection when CityModel reports an empty selection (Esc)", async () => {
    render(<App />);
    await act(async () => {
      sceneMock.cityModelProps.onSelect("BLD_C1", 1200, [0, 0, 0], "BLD_C1");
    });
    expect(sceneMock.cityModelProps.selectedElementId).toBe("BLD_C1");
    act(() => sceneMock.cityModelProps.onSelect(""));
    expect(sceneMock.cityModelProps.selectedElementId).toBe(null);
    expect(sceneMock.cityModelProps.selectedId).toBe("");
  });

  it("centres the 3D loading notice in the map area left of the open panel, clear of the panel toggle", () => {
    sceneMock.suspend = true;
    try {
      render(<App />);
      const notice = screen.getByText(SCENE_LOADING).closest('[role="status"]');
      expect(notice.style.right).toBe("var(--dashboard-panel-width)");
      expect(notice.className).toMatch(/\binset-y-0\b/);
      expect(notice.className).toMatch(/\bpx-10\b/);

      fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
      expect(notice.style.right).toBe("0px");

      fireEvent.click(screen.getByRole("button", { name: "패널 열기" }));
      expect(notice.style.right).toBe("var(--dashboard-panel-width)");
    } finally {
      sceneMock.suspend = false;
    }
  });

  it("puts every camera preset, the tour toggle and the KST time slider in tab order before the panel", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    const presets = presetButtons(container);
    expect(presets.every(Boolean)).toBe(true);
    const tour = container.querySelector('[data-qa="camera-tour-toggle"]');
    const play = screen.getByRole("button", { name: "시간 재생" });
    const slider = screen.getByRole("slider", { name: "시각 (KST)" });
    const expected = [...presets, tour, play, slider];

    const reached = [];
    for (let i = 0; i < expected.length; i += 1) {
      await user.tab();
      reached.push(document.activeElement);
    }
    expect(reached).toEqual(expected);
    for (const button of [...presets, tour, play]) {
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("flies the camera to a clicked preset and marks it pressed; user orbit input clears the pressed state", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      const { container } = render(<App />);
      const controls = controlsMock.current;
      const [overview, gate] = presetButtons(container);
      expect(overview.getAttribute("aria-pressed")).toBe("true");
      expect(gate.getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(gate);
      expect(gate.getAttribute("aria-pressed")).toBe("true");
      expect(overview.getAttribute("aria-pressed")).toBe("false");
      expect(controls.events).toEqual(["start:flyTo"]);

      act(() => {
        vi.advanceTimersByTime(400);
      });
      const midway = controls.object.position.clone();
      expect(midway.x).toBeGreaterThan(0);
      expect(midway.x).toBeLessThan(CAMERA_PRESETS[1].position[0]);

      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(controls.object.position.toArray()).toEqual(CAMERA_PRESETS[1].position);
      expect(controls.target.toArray()).toEqual(CAMERA_PRESETS[1].target);
      expect(controls.events).toEqual(["start:flyTo", "end"]);
      expect(controls.updates).toBeGreaterThan(1);

      act(() => {
        controls.dispatchEvent({ type: "start" });
      });
      expect(gate.getAttribute("aria-pressed")).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("jumps instead of animating when the user prefers reduced motion", () => {
    window.matchMedia = vi.fn((query) => ({ matches: query.includes("prefers-reduced-motion") }));
    const { container } = render(<App />);
    const controls = controlsMock.current;
    const d4 = container.querySelector('[data-qa="camera-preset-d4"]');

    fireEvent.click(d4);
    const preset = CAMERA_PRESETS.find((entry) => entry.id === "d4");
    expect(controls.object.position.toArray()).toEqual(preset.position);
    expect(controls.target.toArray()).toEqual(preset.target);
    expect(controls.events).toEqual(["start:flyTo", "end"]);
    expect(d4.getAttribute("aria-pressed")).toBe("true");
  });

  it("drives the shared sun clock from the KST time slider and switches live mode to simulation", async () => {
    const user = userEvent.setup();
    render(<App />);
    const slider = screen.getByRole("slider", { name: "시각 (KST)" });
    expect(slider.getAttribute("min")).toBe("0");
    expect(slider.getAttribute("max")).toBe("1439");

    fireEvent.change(slider, { target: { value: "930" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("15:30");
    expect(screen.getByText("15:30")).toBeTruthy();

    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(slider.getAttribute("aria-valuetext")).toBe("15:31");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(slider.getAttribute("aria-valuetext")).toBe("15:41");
    await user.keyboard("{PageDown}");
    expect(slider.getAttribute("aria-valuetext")).toBe("14:41");

    fireEvent.change(slider, { target: { value: String(13 * 60 + 37) } });
    expect(slider.getAttribute("aria-valuetext")).toBe("13:37");
    expect(screen.getByText("13:37")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "환경 시뮬" }));
    expect(screen.getByRole("slider", { name: "시" }).value).toBe("13");
    expect(screen.getByRole("slider", { name: "분" }).value).toBe("37");

    fireEvent.click(screen.getByRole("radio", { name: "실측" }));
    expect(screen.getByText("실시간")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "600" } });
    expect(screen.queryByText("실시간")).toBeNull();
    expect(screen.getByRole("slider", { name: "시" }).value).toBe("10");
  });

  it("labels the sky estimate as 추정 for both the project feed and the Open-Meteo fallback", async () => {
    stubFetch({ weather: async () => okJson({ base_weather: { temperature: 21, humidity: 50, wind_speed: 1, cloud_cover: 0.9, precipitation_type: 0 } }) });
    const { container, unmount } = render(<App />);
    const caption = container.querySelector('[data-qa="scene-weather"]');
    await waitFor(() => expect(caption.textContent).toMatch(/기상청 PTY/));
    expect(caption.textContent).toMatch(/하늘 연출 흐림/);
    expect(caption.textContent).toMatch(/추정/);
    expect(caption.textContent).not.toMatch(/관측/);
    expect(caption.getAttribute("data-estimated")).toBe("true");
    unmount();

    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("api.open-meteo.com")) {
        return okJson({ current: { cloud_cover: 20, precipitation: 0, weather_code: 1, visibility: 24140, is_day: 1 } });
      }
      if (target.includes("/api/traffic")) return okJson({ is_running: true });
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const second = render(<App />);
    const fallbackCaption = second.container.querySelector('[data-qa="scene-weather"]');
    await waitFor(() => expect(fallbackCaption.textContent).toMatch(/Open-Meteo/));
    expect(fallbackCaption.textContent).toMatch(/하늘 연출 맑음/);
    expect(fallbackCaption.textContent).toMatch(/추정/);
    expect(fallbackCaption.textContent).toMatch(/2\.5 km/);
    expect(fallbackCaption.textContent).not.toMatch(/관측/);
  });

  it("shows the byte percentage of campus-v2.glb while the model downloads, then a processing note", () => {
    sceneMock.suspend = true;
    progressMock.state = { active: true, loaded: 0, total: 2, progress: 0, item: "/campus-v2.glb", errors: [] };
    try {
      render(<App />);
      expect(fileLoaderMock.loads).toHaveLength(1);
      expect(fileLoaderMock.loads[0].url).toBe("/campus-v2.glb");

      act(() => {
        fileLoaderMock.loads[0].onProgress({ lengthComputable: true, loaded: 1.1 * 1024 * 1024, total: 2.2 * 1024 * 1024 });
      });
      expect(screen.getByText("campus-v2.glb 50% (1.1/2.2 MB)")).toBeTruthy();
      expect(screen.getByText(SCENE_LOADING).closest('[role="status"]')).toBeTruthy();

      act(() => {
        fileLoaderMock.loads[0].onLoad(new ArrayBuffer(0));
      });
      expect(screen.getByText("campus-v2.glb 100% · 모델 처리 중")).toBeTruthy();
    } finally {
      sceneMock.suspend = false;
    }
  });

  it("does not re-request the model for progress once the download has already finished", () => {
    sceneMock.suspend = true;
    progressMock.state = { active: true, loaded: 1, total: 2, progress: 50, item: "/campus-v2.glb", errors: [] };
    try {
      render(<App />);
      expect(fileLoaderMock.loads).toHaveLength(0);
      expect(screen.getByText(SCENE_LOADING)).toBeTruthy();
    } finally {
      sceneMock.suspend = false;
    }
  });

  it("frames the 3D failure notice the same way", () => {
    sceneMock.fail = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<App />);
      const frame = screen.getByText("3D 캠퍼스 모델을 불러오지 못했습니다").closest('[role="alert"]').parentElement;
      expect(frame.style.right).toBe("var(--dashboard-panel-width)");
      expect(frame.className).toMatch(/\binset-y-0\b/);
      expect(frame.className).toMatch(/\bpx-10\b/);

      fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
      expect(frame.style.right).toBe("0px");
    } finally {
      sceneMock.fail = false;
      errorSpy.mockRestore();
    }
  });
});

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
    useGLTF: Object.assign(() => ({ scene: null }), { clear: (url) => sceneMock.clearedModels.push(url) }),
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
vi.mock("./lighting/WaterReflections", () => ({ WaterReflections: () => null }));
vi.mock("./weather/SceneWeatherBinding", () => ({ SceneWeatherBinding: () => null }));
const sceneMock = vi.hoisted(() => ({ suspend: false, fail: false, clearedModels: [] }));
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
  useSimulationStore: (select) => select({ connectionStatus: "연결 중" }),
}));
vi.mock("./vworld/D4SectionExperience", () => ({
  D4SectionExperience: ({ onClose }) => <button type="button" onClick={onClose}>D4 상세 닫기</button>,
}));
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

const C5_TABS = ["건물", "현황", "에너지", "시뮬레이션"];
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
  // 패널을 열어 둔 채 떠난 재방문 사용자. 첫 방문(레일로 시작)은 panel/DashboardShell.test.jsx가 다룬다.
  vi.stubGlobal("localStorage", { getItem: (key) => (key === "scnu.panelOpen" ? "true" : null), setItem() {} });
  stubFetch();
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  controlsMock.current = controlsMock.create();
  progressMock.state = { active: false, loaded: 0, total: 0, progress: 0, item: "", errors: [] };
  fileLoaderMock.loads.length = 0;
});

// 전체 시점은 도구 모음에 있고, 나머지 시점은 `시점` 메뉴 안에 있다. 메뉴 항목은 메뉴를 연 뒤에만 DOM에 있다.
const presetButton = (container, id) => {
  if (id !== "overview" && !container.querySelector(`[data-qa="camera-preset-${id}"]`)) {
    fireEvent.click(container.querySelector('[data-qa="camera-view-menu"]'));
  }
  return container.querySelector(`[data-qa="camera-preset-${id}"]`);
};

afterEach(() => {
  // 대시보드가 화면 상태를 주소에 쓴다(useUrlState): 다음 테스트가 그 주소로 시작하지 않게 되돌린다.
  window.history.replaceState(null, "", "/");
  cleanup();
  vi.unstubAllGlobals();
});

const phoneMatchMedia = vi.fn((query) => ({ matches: query === "(max-width: 639px)" || query === "(max-width: 1023px)", addEventListener() {}, removeEventListener() {} }));

describe("Legacy and VWorld feature parity", () => {
  it("renders the VWorld campus status and full energy surfaces inside the energy tab", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "에너지" }));
    expect(screen.getByText("캠퍼스 설치 현황")).toBeTruthy();
    expect(screen.getByText("건물 에너지 분석")).toBeTruthy();
    expect(screen.getByText("캠퍼스 태양광 비교")).toBeTruthy();
    expect(screen.getByText("건물 에너지 시뮬레이션")).toBeTruthy();
  });

  it("renders exactly the four dashboard tabs in order", () => {
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

    fireEvent.click(screen.getByRole("tab", { name: "현황" }));
    await waitFor(() => expect(countCalls(fetchMock, "/api/traffic")).toBeGreaterThan(0));
    await settlePendingFetches();

    expect(screen.getByText("D4 입출차 현황")).toBeTruthy();
    expect(screen.getByText(TRAFFIC_OFFLINE)).toBeTruthy();
    expect(screen.queryByText(TRAFFIC_LIVE)).toBeNull();
  });

  it("opens 설정 from the 더보기 menu as a non-blocking surface on every tab and closes it on Escape with focus back on 더보기", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "시뮬레이션" }));
    expect(screen.queryByRole("button", { name: "설정" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "더보기" });
    await user.click(trigger);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["설정", "발표 모드P", "링크 복사"]);
    await user.click(screen.getByRole("menuitem", { name: "설정" }));
    const dialog = screen.getByRole("dialog", { name: "설정" });
    expect(dialog.getAttribute("aria-modal")).not.toBe("true");
    expect(container.querySelector(".bg-\\[var\\(--colors-dim\\)\\], .backdrop-blur")).toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
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

  it("shows the delay message with a 다시 시도 button that re-requests the 3D model in place (no page reload) after 15 s", async () => {
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
      sceneMock.clearedModels.length = 0;
      await act(async () => {
        fireEvent.click(retry);
      });
      expect(reload).not.toHaveBeenCalled();
      expect(sceneMock.clearedModels).toHaveLength(1);
      // 다시 받는 동안 안내는 처음 상태로 돌아가 15초를 다시 센다.
      expect(screen.getByText(SCENE_LOADING)).toBeTruthy();
      expect(screen.queryByText(SCENE_SLOW)).toBeNull();
    } finally {
      sceneMock.suspend = false;
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("keeps the 3D map interactive above the phone bottom sheet, and hands CityModel the sheet that hides labels", () => {
    window.matchMedia = phoneMatchMedia;
    const { container } = render(<App />);
    const mapLayer = container.querySelector('[data-qa="campus-map-layer"]');
    const sheet = container.querySelector('[data-qa="dashboard-panel"]');
    expect(sheet.dataset.detent).toBe("peek");
    expect(sceneMock.cityModelProps.occluderRef.current).toBe(sheet);
    expect(mapLayer.hasAttribute("inert")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "패널 열기" }));
    expect(sheet.dataset.detent).toBe("half");
    expect(mapLayer.hasAttribute("inert")).toBe(false);
  });

  it("hands CityModel the map chrome (HUD layer) that campus labels must stay beneath; the panel and its rail are the occluder", () => {
    const { container } = render(<App />);
    const chrome = sceneMock.cityModelProps.chromeRefs.map((ref) => ref.current);
    const hud = container.querySelector('[data-qa="campus-hud"]');
    expect(chrome).toContain(hud);
    expect(hud.hasAttribute("data-label-chrome-layer")).toBe(true);
    expect(sceneMock.cityModelProps.occluderRef.current).toBe(container.querySelector('[data-qa="dashboard-panel"]'));
    // 라벨 층은 지면 시점(정문)에서 거리 단계로 바뀌므로 눌린 시점을 함께 받는다.
    expect(sceneMock.cityModelProps.activePresetId).toBe("overview");
    fireEvent.click(presetButton(container, "gate"));
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

  it("centres the 3D loading notice in the map area left of the open panel, clear of the panel toggle", async () => {
    sceneMock.suspend = true;
    try {
      render(<App />);
      const notice = screen.getByText(SCENE_LOADING).closest('[role="status"]');
      expect(notice.style.right).toBe("var(--dashboard-panel-width)");
      expect(notice.className).toMatch(/\binset-y-0\b/);
      expect(notice.className).toMatch(/\bpx-10\b/);

      // 닫히는 패널은 다 닫힌 뒤(300 ms)에 자리를 내준다. 다시 열 때는 레일의 탭 아이콘을 누른다.
      fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
      expect(notice.style.right).toBe("var(--dashboard-panel-width)");
      await waitFor(() => expect(notice.style.right).toBe("var(--dashboard-rail-width)"));

      fireEvent.click(screen.getByRole("button", { name: "현황" }));
      expect(notice.style.right).toBe("var(--dashboard-panel-width)");
    } finally {
      sceneMock.suspend = false;
    }
  });

  it("puts the freshness stamps, the three camera groups, the time controls and the camera buttons in tab order; the map region is not a tab stop (HUD -> chips -> panel)", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    const overview = container.querySelector('[data-qa="camera-preset-overview"]');
    const menu = container.querySelector('[data-qa="camera-view-menu"]');
    const tour = container.querySelector('[data-qa="camera-tour-toggle"]');
    const presentationToggle = container.querySelector('[data-qa="presentation-toggle"]');
    // 더보기(설정·발표 모드·링크 복사)는 HUD 줄 끝에 온다. 비교 열기는 HUD가 아니라 인스펙터 안에 있다.
    const more = container.querySelector('[data-qa="more-menu"]');
    expect(container.querySelector('[data-qa="compare-open"]')).toBeNull();
    // 건물 검색칸은 카메라 도구 모음 바로 뒤에 온다.
    const search = screen.getByRole("combobox", { name: "건물 검색" });
    const now = screen.getByRole("button", { name: "지금" });
    const play = screen.getByRole("button", { name: "시간 재생" });
    const date = screen.getByLabelText("장면 날짜");
    const typedTime = screen.getByLabelText("장면 시각 입력");
    const slider = screen.getByRole("slider", { name: "시각 (KST)" });
    const cameraButtons = ["확대", "축소", "왼쪽으로 회전", "오른쪽으로 회전", "처음 시점"].map((name) => screen.getByRole("button", { name }));
    const mapLayer = container.querySelector('[data-qa="campus-map-layer"]');
    // 피드 갱신 표시와 새로 고침 단추는 HUD에 없다(현황 탭 묶음 안에 있다).
    expect(container.querySelectorAll('[data-qa="campus-hud"] [data-qa="freshness-stamp"]')).toHaveLength(0);
    const expected = [overview, menu, tour, search, presentationToggle, more, now, play, date, typedTime, slider, ...cameraButtons];

    const reached = [];
    for (let i = 0; i < expected.length; i += 1) {
      await user.tab();
      reached.push(document.activeElement);
    }
    expect(reached).toEqual(expected);
    // Arrow keys reach the camera from the chips inside the map region; the region itself leaves the tab order.
    expect(mapLayer.getAttribute("tabindex")).toBe("-1");
    for (const button of [overview, menu, tour, play, ...cameraButtons]) {
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("reaches every named preset through the 시점 menu and closes it on Escape with focus back on the trigger", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const trigger = container.querySelector('[data-qa="camera-view-menu"]');
    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "시점" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.dataset.qa)).toEqual(CAMERA_PRESETS.slice(1).map((preset) => `camera-preset-${preset.id}`));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("flies the camera to a clicked preset and marks it pressed; user orbit input clears the pressed state", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      const { container } = render(<App />);
      const controls = controlsMock.current;
      const overview = presetButton(container, "overview");
      expect(overview.getAttribute("aria-pressed")).toBe("true");
      const gate = presetButton(container, "gate");
      expect(gate.getAttribute("aria-checked")).toBe("false");

      fireEvent.click(gate);
      expect(overview.getAttribute("aria-pressed")).toBe("false");
      expect(presetButton(container, "gate").getAttribute("aria-checked")).toBe("true");
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
      expect(presetButton(container, "gate").getAttribute("aria-checked")).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves the camera from the on-screen buttons and the keyboard, and clears the pressed preset like a user orbit", () => {
    const { container } = render(<App />);
    const controls = controlsMock.current;
    const overview = presetButton(container, "overview");
    const distance = () => controls.object.position.distanceTo(controls.target);
    const before = distance();

    fireEvent.click(screen.getByRole("button", { name: "확대" }));
    expect(distance()).toBeLessThan(before);
    expect(overview.getAttribute("aria-pressed")).toBe("false");

    const zoomed = distance();
    const mapLayer = container.querySelector('[data-qa="campus-map-layer"]');
    fireEvent.keyDown(mapLayer, { key: "-" });
    expect(distance()).toBeGreaterThan(zoomed);
    const x = controls.object.position.x;
    fireEvent.keyDown(mapLayer, { key: "ArrowLeft" });
    expect(controls.object.position.x).not.toBe(x);
    fireEvent.keyDown(mapLayer, { key: " " });
    expect(controls.events.filter((event) => event === "start")).toHaveLength(3);
  });

  it("jumps instead of animating when the user prefers reduced motion", () => {
    window.matchMedia = vi.fn((query) => ({ matches: query.includes("prefers-reduced-motion"), addEventListener() {}, removeEventListener() {} }));
    const { container } = render(<App />);
    const controls = controlsMock.current;
    const d4 = presetButton(container, "d4");

    fireEvent.click(d4);
    const preset = CAMERA_PRESETS.find((entry) => entry.id === "d4");
    expect(controls.object.position.toArray()).toEqual(preset.position);
    expect(controls.target.toArray()).toEqual(preset.target);
    expect(controls.events).toEqual(["start:flyTo", "end"]);
    expect(presetButton(container, "d4").getAttribute("aria-checked")).toBe("true");
  });

  it("drives the shared sun clock from the KST time slider and switches live mode to simulation", async () => {
    const user = userEvent.setup();
    render(<App />);
    const slider = screen.getByRole("slider", { name: "시각 (KST)" });
    expect(slider.getAttribute("min")).toBe("0");
    expect(slider.getAttribute("max")).toBe("1439");

    fireEvent.change(slider, { target: { value: "930" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("15:30");
    const timeCard = screen.getByRole("region", { name: "시간 조절" });
    expect(within(timeCard).getByText("15:30")).toBeTruthy();

    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(slider.getAttribute("aria-valuetext")).toBe("15:31");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(slider.getAttribute("aria-valuetext")).toBe("15:41");
    await user.keyboard("{PageDown}");
    expect(slider.getAttribute("aria-valuetext")).toBe("14:41");

    fireEvent.change(slider, { target: { value: String(13 * 60 + 37) } });
    expect(slider.getAttribute("aria-valuetext")).toBe("13:37");
    expect(within(timeCard).getByText("13:37")).toBeTruthy();
    // 장면 시각은 시간 카드 한 곳에만 보인다(패널 시계 없음).
    expect(document.querySelector('[data-qa="panel-clock"]')).toBeNull();

    // 시뮬레이션 탭에는 두 번째 시간 슬라이더(월·일·시·분)가 없다.
    fireEvent.click(screen.getByRole("tab", { name: "시뮬레이션" }));
    for (const name of ["월", "일", "시", "분"]) expect(screen.queryByRole("slider", { name })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "실측" }));
    expect(within(timeCard).getByText("실측")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "600" } });
    expect(within(timeCard).queryByText("실측")).toBeNull();
    expect(slider.getAttribute("aria-valuetext")).toBe("10:00");
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

  it("frames the 3D failure notice the same way", async () => {
    sceneMock.fail = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<App />);
      const frame = screen.getByText("3D 캠퍼스 모델을 불러오지 못했습니다").closest('[role="alert"]').parentElement;
      expect(frame.style.right).toBe("var(--dashboard-panel-width)");
      expect(frame.className).toMatch(/\binset-y-0\b/);
      expect(frame.className).toMatch(/\bpx-10\b/);

      fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
      await waitFor(() => expect(frame.style.right).toBe("var(--dashboard-rail-width)"));
    } finally {
      sceneMock.fail = false;
      errorSpy.mockRestore();
    }
  });
  it("shows one alert and one 다시 시도 per down feed in its own group (현황: weather, traffic; 에너지: energy) and none in the HUD", async () => {
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    stubFetch({ weather: offline, traffic: offline });
    installationClient.listDetails.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { container } = render(<App />);
    const panel = container.querySelector('[data-qa="dashboard-panel"]');
    await waitFor(() => expect(within(panel).getAllByRole("alert")).toHaveLength(2));
    expect(within(panel).getAllByRole("alert").map((alert) => alert.dataset.source)).toEqual(["weather", "traffic"]);
    expect(screen.getAllByRole("button", { name: /다시 시도/ })).toHaveLength(2);
    expect(within(container.querySelector('[data-qa="campus-hud"]')).queryAllByRole("button", { name: /다시 시도|새로고침/ })).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "에너지" }));
    await waitFor(() => expect(within(panel).getAllByRole("alert").map((alert) => alert.dataset.source)).toEqual(["energy"]));
    expect(screen.getAllByRole("button", { name: /다시 시도/ })).toHaveLength(1);
    expect(container.querySelector('[data-qa="weather-error-banner"]')).toBeNull();
  });
  it("keeps the 현황 tab and its scrollTop when returning from the D4 section", async () => {
    const { container } = render(<App />);
    const scroller = () => container.querySelector('[data-qa="panel-scroll"]');
    scroller().scrollTop = 300;
    await act(async () => {
      await sceneMock.cityModelProps.onBuildingClick({ name: "BLD_D4", parent: { name: "BLD_D4" }, userData: {} });
    });
    expect(container.querySelector('[data-qa="dashboard-panel"]').dataset.pane).toBe("d4");
    fireEvent.click(screen.getByRole("button", { name: "D4 상세 닫기" }));
    expect(screen.getByRole("tab", { name: "현황" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(Math.abs(scroller().scrollTop - 300)).toBeLessThanOrEqual(8));
    expect(container.querySelector('[data-qa="dashboard-panel"]').dataset.open).toBe("true");
  });
  it("opens the selection inspector as the content of the 건물 tab, and keeps the 에너지 tab when a building is picked there", async () => {
    stubFetch();
    const { container } = render(<App />);
    const pick = () => act(async () => {
      sceneMock.cityModelProps.onSelect("BLD_C1", 1200, [0, 0, 0], "BLD_C1");
      await sceneMock.cityModelProps.onBuildingClick({ name: "BLD_C1", parent: { name: "BLD_C1" }, userData: { buildingLabel: "도서관" } });
    });
    await pick();
    const inspector = container.querySelector('[data-qa="selection-inspector"]');
    expect(inspector).not.toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(C5_TABS);
    expect(screen.getByRole("tab", { name: "건물" }).getAttribute("aria-selected")).toBe("true");
    expect(inspector.closest('[role="tabpanel"]')).not.toBeNull();
    expect(container.querySelector('[data-qa="inspector-card"]')).toBeNull();
    fireEvent.click(within(inspector).getByRole("button", { name: "닫기" }));
    expect(container.querySelector('[data-qa="selection-inspector"]')).toBeNull();
    expect(screen.getByText("지도에서 건물을 누르거나 검색하세요")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "에너지" }));
    await pick();
    expect(screen.getByRole("tab", { name: "에너지" }).getAttribute("aria-selected")).toBe("true");
  });
  it("enters 발표 모드 with P (panel and HUD tools hidden, time kept) and Escape restores the layout", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const panel = () => container.querySelector('[data-qa="dashboard-panel"]');
    const hud = () => container.querySelector('[data-qa="campus-hud"]');
    expect(panel().dataset.open).toBe("true");
    await user.keyboard("p");
    expect(hud().dataset.presenting).toBe("true");
    expect(panel().getAttribute("aria-hidden")).toBe("true");
    expect(hud().querySelector('[data-qa="camera-view-menu"]')).toBeNull();
    expect(hud().querySelector('[data-qa="hud-time-readout"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "발표 모드 끝내기" }).getAttribute("aria-pressed")).toBe("true");
    await user.keyboard("{Escape}");
    expect(hud().dataset.presenting).toBeUndefined();
    expect(panel().getAttribute("aria-hidden")).toBeNull();
    expect(panel().dataset.open).toBe("true");
  });
});

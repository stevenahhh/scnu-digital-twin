/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const installationClient = {
  listDetails: vi.fn(async () => []),
  getRepresentative: vi.fn(async () => null),
};

vi.mock("@react-three/fiber", () => ({ Canvas: ({ children }) => <div>{children}</div> }));
vi.mock("@react-three/drei", () => ({
  OrbitControls: () => null,
  Sky: () => null,
}));
const sceneMock = vi.hoisted(() => ({ suspend: false }));
vi.mock("./CityModel", () => ({
  // suspend가 켜지면 끝나지 않는 Promise를 던져 Suspense fallback이 계속 떠 있게 한다.
  CityModel: () => {
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Legacy and VWorld feature parity", () => {
  it("renders the VWorld campus status and full energy surfaces inside the energy tab", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "에너지" }));
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
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("tells the energy analysis whether installation plans are loading, failed or ready", async () => {
    let finishLoading;
    installationClient.listDetails.mockImplementationOnce(() => new Promise((resolve) => { finishLoading = resolve; }));
    const view = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "에너지" }));
    expect(screen.getByText("건물 에너지 분석").getAttribute("data-plans-status")).toBe("loading");
    await act(async () => finishLoading([]));
    expect(screen.getByText("건물 에너지 분석").getAttribute("data-plans-status")).toBe("ready");
    view.unmount();

    installationClient.listDetails.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "에너지" }));
    expect(await screen.findByText("설치 계획을 불러오지 못했습니다")).toBeTruthy();
    expect(screen.getByText("건물 에너지 분석").getAttribute("data-plans-status")).toBe("error");
  });

  it("shows the traffic offline message in the parking card when the traffic fetch rejects", async () => {
    const fetchMock = stubFetch({ traffic: rejectNetwork });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "주차·안전" }));
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
});

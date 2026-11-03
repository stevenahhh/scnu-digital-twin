/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const installationClient = {
  listDetails: vi.fn(async () => []),
  getRepresentative: vi.fn(async () => null),
};

vi.mock("./vworld/VWorldRenderer", () => ({ default: () => null }));
vi.mock("./simulation", () => ({
  TrafficSafetyPanel: () => null,
  useSimulationSocket: vi.fn(),
  useSimulationStore: (select) => select({ connectionStatus: "연결 중" }),
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
vi.mock("./features/energy/installations/installationPlanApi.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createInstallationPlanClient: () => installationClient };
});

import App from "./AppVWorld.jsx";

const C5_TABS = ["기본 현황", "주차·안전", "에너지", "환경 시뮬"];
const TRAFFIC_OFFLINE = "영상 분석 서버 연결 없음";
const TRAFFIC_LIVE = "실시간 영상 분석 중";
const WEATHER_NETWORK = "기상 서버에 연결할 수 없습니다";

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
});

afterEach(() => {
  // 대시보드가 화면 상태를 주소에 쓴다(useUrlState): 다음 테스트가 그 주소로 시작하지 않게 되돌린다.
  window.history.replaceState(null, "", "/");
  cleanup();
  vi.unstubAllGlobals();
});

describe("VWorld and Legacy feature parity", () => {
  it("renders the full energy surfaces inside the energy tab", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "에너지" }));
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

  it("names the panel toggle with the shared C5 vocabulary and a matching title", async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggle = screen.getByRole("button", { name: "패널 닫기" });
    expect(toggle.getAttribute("title")).toBe("패널 닫기");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "패널 열기" }).getAttribute("title")).toBe("패널 열기");
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

  it("opens 설정 as a non-blocking surface from its labelled button and closes it on Escape with focus back on 설정", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    expect(screen.queryByRole("dialog")).toBeNull();
    const trigger = screen.getByRole("button", { name: "설정" });
    await user.click(trigger);
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
  it("shows exactly 3 alerts and 3 다시 시도 buttons when weather, traffic and energy are down", async () => {
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    stubFetch({ weather: offline, traffic: offline });
    installationClient.listDetails.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { container } = render(<App />);
    const panel = container.querySelector('[data-qa="dashboard-panel"]');
    await waitFor(() => expect(within(panel).getAllByRole("alert")).toHaveLength(3));
    expect(within(panel).getAllByRole("alert").map((alert) => alert.dataset.source)).toEqual(["weather", "traffic", "energy"]);
    expect(within(panel).getAllByRole("button", { name: "다시 시도" })).toHaveLength(3);
    // 패널이 그 피드를 보여 주는 동안 HUD 갱신 표시는 다시 시도를 되풀이하지 않는다(새로 고침 아이콘만).
    expect(screen.getAllByRole("button", { name: /다시 시도/ })).toHaveLength(3);
    expect(container.querySelector('[data-qa="weather-error-banner"]')).toBeNull();
  });
});

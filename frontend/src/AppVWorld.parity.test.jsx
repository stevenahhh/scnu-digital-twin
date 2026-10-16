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
}));
vi.mock("./features/energy/analysis", () => ({
  BuildingAnalysis: () => <div>건물 에너지 분석</div>,
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
  stubFetch();
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("VWorld and Legacy feature parity", () => {
  it("renders the full energy surfaces inside the energy tab", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "에너지" }));
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

  it("names the panel toggle with the shared C5 vocabulary and a matching title", async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggle = screen.getByRole("button", { name: "패널 닫기" });
    expect(toggle.getAttribute("title")).toBe("패널 닫기");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "패널 열기" }).getAttribute("title")).toBe("패널 열기");
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
});

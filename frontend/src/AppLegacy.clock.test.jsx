/* @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 피드는 고정 값으로 둔다(교통 피드는 2초마다 다시 받아 대시보드를 다시 그리므로). 이 테스트가 보는 것은 시계뿐이다.
const renders = vi.hoisted(() => ({ dashboard: 0 }));
const FEED = { data: null, state: "loading", message: "", lastUpdatedAt: null, isRefreshing: false, refresh: () => {} };
vi.mock("./hooks/useWeatherFeed", () => ({ useWeatherFeed: () => FEED }));
vi.mock("./simulation/hooks/useTrafficFeed", () => ({ useTrafficFeed: () => ({ state: "offline", message: "", stats: null }) }));
vi.mock("@react-three/fiber", () => ({ Canvas: () => null }));
vi.mock("@react-three/drei", () => ({ OrbitControls: () => null, useProgress: () => ({ active: false, loaded: 0 }) }));
vi.mock("./lighting/CampusLighting", () => ({ CAMPUS_CANVAS_GL: {}, CampusLighting: () => null }));
vi.mock("./CityModel", () => ({ CityModel: () => null }));
vi.mock("./simulation", () => ({ CampusTrafficSimulation: () => null, TrafficSafetyPanel: () => null, useSimulationSocket: vi.fn(), useSimulationStore: (select) => select({ connectionStatus: "연결 중" }) }));
vi.mock("./vworld/D4SectionExperience", () => ({ D4SectionExperience: () => null }));
vi.mock("./features/energy/installations/installationPlanApi.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  createInstallationPlanClient: () => ({ listDetails: async () => [], getRepresentative: async () => null }),
}));
// 대시보드가 다시 그려질 때마다 새 props로 그려지는 패널 틀을 감싸, 대시보드 커밋 수를 센다.
vi.mock("./panel/DashboardPanel", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal();
  return {
    ...actual,
    DashboardPanel: React.forwardRef(function CountedPanel(props, ref) {
      renders.dashboard += 1;
      return <actual.DashboardPanel {...props} ref={ref} />;
    }),
  };
});

import App from "./AppLegacy.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Legacy dashboard clock", () => {
  it("ticks the panel clock every second without committing the dashboard", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-26T03:00:00.000Z") });
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("localStorage", { getItem: (key) => (key === "scnu.panelOpen" ? "true" : null), setItem() {} });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<App />);
    // 첫 화면의 전환 애니메이션(그리기 루프를 잠시 always로 돌리는 3초)이 끝날 때까지 먼저 보낸다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    const clock = screen.getByText("12:00:04");
    const before = renders.dashboard;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(clock.textContent).toBe("12:00:09");
    expect(renders.dashboard - before).toBe(0);
  });
});

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// @vitest-environment jsdom

vi.mock("../stores/simulationStore", () => {
  const state = {
    status: "stopped",
    connectionStatus: "연결 끊김",
    statistics: {
      car_count: 0,
      person_count: 0,
      scooter_count: 0,
      normal_count: 0,
      caution_count: 0,
      warning_count: 0,
      danger_count: 0,
      completed_trips: {},
      near_miss_count: 0,
      current_risks: 0,
      network_coverage: {},
    },
    simulationTime: 0,
    demandProfile: "daytime",
    riskEvents: [],
    selectedAgentId: null,
    selectedAgentDetails: null,
    selectionError: null,
    timeline: [],
  };
  return {
    simulationStore: { reset: vi.fn(), selectAgent: vi.fn() },
    useSimulationStore: (selector) => selector(state),
  };
});

import { TrafficSafetyPanel } from "./TrafficSafetyPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TrafficSafetyPanel", () => {
  it("shows Korean labels and does not start after scenario setup fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: "scenario unavailable" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TrafficSafetyPanel />);

    for (const label of ["아차사고", "완료된 이동", "캠퍼스 네트워크 범위", "시뮬레이션 타임라인"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "시작" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("오류: 시뮬레이션 서버 요청이 실패했습니다 (HTTP 503)");
    expect(alert.textContent).toContain("scenario unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/simulation/scenario");
  });

  it("names the safety metrics in Korean, keeps lists short and shows connection state with an icon, not a glyph", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { container } = render(<TrafficSafetyPanel />);
    expect(container.textContent).not.toMatch(/[●△↔]/);
    expect(screen.getByText("연결 끊김").dataset.tone).toBe("warning");
    expect(container.querySelector(".overflow-y-auto")).toBeNull();
    expect(screen.getByText("감지된 이벤트가 없습니다.")).toBeTruthy();
  });
});

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// @vitest-environment happy-dom

const panelState = vi.hoisted(() => ({ current: null }));

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
  panelState.current = state;
  return {
    simulationStore: { reset: vi.fn(), selectAgent: vi.fn() },
    useSimulationStore: (selector) => selector(state),
  };
});

import { TrafficSafetyPanel } from "./TrafficSafetyPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete panelState.current.statistics.network_provenance;
});

describe("TrafficSafetyPanel network provenance", () => {
  it("shows the measured and estimated share with 추정, the connected crossings and the 60 s separation", () => {
    panelState.current.statistics.network_provenance = {
      person_measured_share: 29.46, person_estimated_share: 66.06, crossing_connected: 27, crossing_count: 31,
      separation: { person_on_walkable: 99.678, car_on_road: 99.837, seed: 42, seconds: 60 },
    };
    render(<TrafficSafetyPanel />);
    expect(screen.getByText("보행망: NGII 인도 29.5% · 추정 공유통로 66.1% (추정)")).toBeTruthy();
    expect(screen.getByText("횡단보도 27/31 연결")).toBeTruthy();
    expect(screen.getByText("분리 검증(60초): 보행자 99.7% · 차량 99.8%")).toBeTruthy();
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("hides the block without provenance and the separation line without a report, never printing NaN", () => {
    render(<TrafficSafetyPanel />);
    expect(screen.queryByText(/보행망:/)).toBeNull();
    cleanup();
    panelState.current.statistics.network_provenance = { person_measured_share: null, person_estimated_share: 66.06, crossing_connected: null, crossing_count: 31, separation: null };
    render(<TrafficSafetyPanel />);
    expect(screen.getByText("보행망: NGII 인도 -% · 추정 공유통로 66.1% (추정)")).toBeTruthy();
    expect(screen.getByText("횡단보도 -/31 연결")).toBeTruthy();
    expect(screen.queryByText(/분리 검증/)).toBeNull();
    expect(document.body.textContent).not.toContain("NaN");
  });
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

describe("TrafficSafetyPanel estimate labelling", () => {
  it("marks the simulated coverage, risk events and agent metrics as estimates", () => {
    vi.stubGlobal("fetch", vi.fn());
    panelState.current.statistics.network_coverage = { car: { visited_percent: 40, planned_percent: 60 } };
    panelState.current.selectedAgentId = "car-1";
    panelState.current.selectedAgentDetails = { id: "car-1", type: "car", speed: 5, metrics: {} };
    try {
      const { container } = render(<TrafficSafetyPanel />);
      const estimateHeaders = [...container.querySelectorAll("[data-tone=estimate]")].map((badge) => badge.closest("div")?.textContent ?? "");
      expect(estimateHeaders.some((text) => text.includes("위험 이벤트"))).toBe(true);
      expect(estimateHeaders.some((text) => text.includes("안전"))).toBe(true);
      expect(estimateHeaders.some((text) => text.includes("이동"))).toBe(true);
      expect(container.textContent).toContain("40% · 계획 60% (추정)");
      expect(container.textContent).not.toMatch(/실주행|실시간 위험 이벤트/);
    } finally {
      panelState.current.statistics.network_coverage = {};
      panelState.current.selectedAgentId = null;
      panelState.current.selectedAgentDetails = null;
    }
  });
});

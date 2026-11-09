import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// @vitest-environment jsdom

const panelState = vi.hoisted(() => ({ current: null }));
const debugGate = vi.hoisted(() => ({ on: false }));

vi.mock("../utils/simulationDebug.mjs", () => ({ simulationDebugEnabled: () => debugGate.on }));

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

const DEFAULTS = { status: "stopped", connectionStatus: "연결 끊김", simulationTime: 0, riskEvents: [], timeline: [] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  debugGate.on = false;
  Object.assign(panelState.current, DEFAULTS);
  panelState.current.statistics.car_count = 0;
  panelState.current.statistics.network_coverage = {};
  delete panelState.current.statistics.network_provenance;
});

const exposedControls = (container) => [...container.querySelectorAll("button, select, input")].filter((el) => !el.closest("[hidden]"));

describe("TrafficSafetyPanel layout", () => {
  it("carries the C5 hook and exposes only scenario, speed, one run toggle, 초기화 and 고급", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { container } = render(<TrafficSafetyPanel />);
    expect(container.querySelector("[data-qa=traffic-simulation-panel]")).toBeTruthy();
    const names = exposedControls(container).map((el) => el.getAttribute("aria-label") || el.closest("label")?.firstChild.textContent.trim() || el.textContent.trim());
    expect(names).toEqual(["시나리오", "속도", "시작", "초기화", "고급"]);
  });

  it("swaps 시작 for 정지 while running and 재개 while paused", () => {
    vi.stubGlobal("fetch", vi.fn());
    panelState.current.status = "running";
    render(<TrafficSafetyPanel />);
    expect(screen.getByRole("button", { name: "정지" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "시작" })).toBeNull();
    cleanup();
    panelState.current.status = "paused";
    render(<TrafficSafetyPanel />);
    expect(screen.getByRole("button", { name: "재개" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "정지" })).toBeNull();
  });

  it("shows four headline results, and 데이터 없음 instead of zeros while disconnected", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { container } = render(<TrafficSafetyPanel />);
    const headline = container.querySelector("[data-qa=metric-list]");
    expect([...headline.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["차량", "보행자", "위험 이벤트", "경과 시각"]);
    expect(within(headline).getAllByText("데이터 없음")).toHaveLength(4);
    cleanup();
    panelState.current.connectionStatus = "연결됨";
    panelState.current.statistics.car_count = 12;
    panelState.current.simulationTime = 75;
    const live = render(<TrafficSafetyPanel />).container.querySelector("[data-qa=metric-list]");
    expect(live.textContent).toContain("12대");
    expect(live.textContent).toContain("1분 15초");
    expect(live.querySelector("[data-tone=warning]")).toBeNull();
  });

  it("keeps one 추정 badge on the panel header", () => {
    vi.stubGlobal("fetch", vi.fn());
    panelState.current.selectedAgentId = "car-1";
    panelState.current.selectedAgentDetails = { id: "car-1", type: "car", speed: 5, metrics: {} };
    try {
      const { container } = render(<TrafficSafetyPanel />);
      const badges = [...container.querySelectorAll("[data-tone=estimate]")];
      expect(badges).toHaveLength(1);
      expect(badges[0].closest("[data-qa=section-header]").textContent).toContain("캠퍼스 교통 시뮬레이션");
      expect(container.textContent).not.toMatch(/실주행|실시간 위험 이벤트/);
    } finally {
      panelState.current.selectedAgentId = null;
      panelState.current.selectedAgentDetails = null;
    }
  });

  it("prints risk engine values in Korean, not as engine enums", () => {
    vi.stubGlobal("fetch", vi.fn());
    panelState.current.riskEvents = [{
      event_id: "e1", risk_level: "danger", risk_score: 91, location_id: "CW_01", object_ids: ["car-1", "person-2"],
      ttc: 1.2, pet: null, minimum_distance: 2, minimum_clearance: 0.4, prediction_model: "route_swept_envelope",
      interaction_state: "CROSSING", safety_event: "TRAFFIC_CONFLICT",
    }];
    const { container } = render(<TrafficSafetyPanel />);
    expect(container.textContent).toContain("교차 · 교통 상충");
    expect(container.textContent).toContain("경로 기반 예측");
    expect(container.textContent).not.toMatch(/TRAFFIC_CONFLICT|CROSSING|route_swept_envelope/);
  });
});

describe("TrafficSafetyPanel developer tools gate", () => {
  it("hides coverage, timeline and the route editor without the debug gate", () => {
    vi.stubGlobal("fetch", vi.fn());
    panelState.current.statistics.network_coverage = { car: { visited_percent: 40, planned_percent: 60 } };
    const { container } = render(<TrafficSafetyPanel />);
    for (const word of ["캠퍼스 네트워크 범위", "시뮬레이션 타임라인", "경로 편집"]) expect(container.textContent).not.toContain(word);
  });

  it("shows them with the debug gate open, coverage still marked 추정", () => {
    vi.stubGlobal("fetch", vi.fn());
    debugGate.on = true;
    panelState.current.statistics.network_coverage = { car: { visited_percent: 40, planned_percent: 60 } };
    const { container } = render(<TrafficSafetyPanel />);
    for (const word of ["캠퍼스 네트워크 범위", "시뮬레이션 타임라인", "경로 편집"]) expect(container.textContent).toContain(word);
    expect(container.textContent).toContain("40% · 계획 60% (추정)");
  });
});

describe("TrafficSafetyPanel network provenance", () => {
  it("shows the measured and estimated share with 추정, the connected crossings and the 60 s separation", () => {
    debugGate.on = true;
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

  it("hides the block without provenance and says 데이터 없음 for missing numbers, never a bare dash or NaN", () => {
    debugGate.on = true;
    render(<TrafficSafetyPanel />);
    expect(screen.queryByText(/보행망:/)).toBeNull();
    cleanup();
    panelState.current.statistics.network_provenance = { person_measured_share: null, person_estimated_share: 66.06, crossing_connected: null, crossing_count: 31, separation: null };
    render(<TrafficSafetyPanel />);
    expect(screen.getByText("보행망: NGII 인도 데이터 없음 · 추정 공유통로 66.1% (추정)")).toBeTruthy();
    expect(screen.getByText("횡단보도 연결 데이터 없음")).toBeTruthy();
    expect(screen.queryByText(/분리 검증/)).toBeNull();
    expect(document.body.textContent).not.toContain("NaN");
  });
});

describe("TrafficSafetyPanel requests", () => {
  it("shows Korean labels and does not start after scenario setup fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: "scenario unavailable" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TrafficSafetyPanel />);

    for (const label of ["아차사고", "완료된 이동", "위험 이벤트"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
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

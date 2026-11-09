/* @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampusComparison, createCampusComparisonClient } from "./CampusComparisonPanel.jsx";
import { CampusComparisonContractError, parseCampusComparison } from "./campusComparison.mjs";

const parsed = parseCampusComparison({
  date: "2026-05-18", weather_preset: "clear",
  assumptions: { annualization_days: 365, weights: { annualized_yield: .3 }, demand_quality: "predicted", weather_source: "scenario", comparability: "same date and deterministic weather preset only" },
  rankings: [
    { scenario_id: "D4-s", building_id: "D4", building_name: "D4 / 공대 3호관", building_status: "simulated", status: "ranked", rank: 1, score: .71, total_generation_energy_kwh: 40, capacity_kwp: 7.056, exclusion_reason: null, component_scores: { annualized_yield: .8, roof_utilization: .3, self_sufficiency: .2, grid_reduction: .2, constraints: 1 }, metrics: { annualized_kwh_per_kwp: 2070, roof_utilization_ratio: .022, self_sufficiency_ratio: .04, grid_reduction_ratio: .04, constraint_violation_count: 0 } },
    { scenario_id: "D1-s", building_id: "D1", building_name: "D1 / 창업보육센터", building_status: "simulated", status: "ranked", rank: 2, score: .61, total_generation_energy_kwh: 30, capacity_kwp: 5.292, exclusion_reason: null, component_scores: { annualized_yield: .7, roof_utilization: .2, self_sufficiency: .2, grid_reduction: .2, constraints: 1 }, metrics: { annualized_kwh_per_kwp: 1900, roof_utilization_ratio: .02, self_sufficiency_ratio: .03, grid_reduction_ratio: .03, constraint_violation_count: 0 } },
    { scenario_id: null, building_id: "C1", building_name: "C1 / 도서관", building_status: "incomplete", status: "excluded", rank: null, score: null, total_generation_energy_kwh: null, capacity_kwp: null, exclusion_reason: "missing_roof_metadata", component_scores: null, metrics: null },
  ],
});

afterEach(cleanup);
describe("CampusComparison", () => {
  it("creates recommendation copies through the canonical /energy namespace", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ source_scenario_id: "source/s", scenario: { id: "copy-s", building_id: "D3" } }) });
    const result = await createCampusComparisonClient("http://api.test", fetchImpl).recommend({ sourceScenarioId: "source/s", date: "2026-05-18" });
    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/energy/scenarios/source%2Fs/recommend", expect.objectContaining({ method: "POST" }));
    expect(result).toEqual({ id: "copy-s", buildingId: "D3" });
  });

  it("rejects ranking responses outside the requested date and weather context", async () => {
    for (const mismatch of [
      { date: "2026-05-17", weather_preset: "clear", field: "date" },
      { date: "2026-05-18", weather_preset: "overcast", field: "weather_preset" },
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
        date: mismatch.date,
        weather_preset: mismatch.weather_preset,
        assumptions: { annualization_days: 365, weights: {}, demand_quality: "predicted", weather_source: "scenario" },
        rankings: [],
      }) });
      await expect(createCampusComparisonClient("http://api.test", fetchImpl).load({ date: "2026-05-18", weatherPreset: "clear" }))
        .rejects.toMatchObject({ name: "CampusComparisonContractError", field: mismatch.field });
    }
  });

  it("rejects a recommendation copied from a source other than the selected scenario", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({
      source_scenario_id: "other-source", scenario: { id: "copy-s", building_id: "D3" },
    }) });
    await expect(createCampusComparisonClient("http://api.test", fetchImpl).recommend({ sourceScenarioId: "source-s", date: "2026-05-18" }))
      .rejects.toBeInstanceOf(CampusComparisonContractError);
  });

  it("shows one sortable 캠퍼스 비교 table with rank, score, yield, roof use, violations and 배치 편집", async () => {
    const user = userEvent.setup();
    const client = { load: vi.fn().mockResolvedValue(parsed) };
    const open = vi.fn();
    render(<CampusComparison client={client} date="2026-05-18" weatherPreset="clear" onOpenRecommendation={open} />);
    expect(client.load).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-05-18", weatherPreset: "clear" }));
    const table = await screen.findByRole("table", { name: /캠퍼스 비교/ });
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(document.querySelector("ol")).toBeNull();
    expect(screen.queryByRole("button", { name: /1위 추천/ })).toBeNull();
    expect(screen.queryByLabelText("캠퍼스 비교 날짜")).toBeNull();
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent.trim());
    expect(headers).toEqual(["건물", "순위", "점수", "kWh/kWp", "옥상 사용률", "위반", "배치"]);
    const buildings = () => within(table).getAllByRole("rowheader").map((cell) => cell.textContent);
    expect(buildings()).toEqual(["D4 / 공대 3호관", "D1 / 창업보육센터"]);
    expect(screen.getByText(/추정 · 시뮬레이션 기준일 5월 18일/)).toBeTruthy();
    // 정렬: 순위 머리글을 누르면 내림차순으로 뒤집힌다.
    await user.click(within(table).getByRole("button", { name: "순위" }));
    expect(buildings()).toEqual(["D1 / 창업보육센터", "D4 / 공대 3호관"]);
    expect(within(table).getByRole("columnheader", { name: "순위" }).getAttribute("aria-sort")).toBe("descending");
    // 제외 건물은 펼침 안에 이유와 함께 있다.
    expect(screen.getByRole("button", { name: "비교 제외 건물 1곳" })).toBeTruthy();
    expect(screen.getByText(/옥상 메타데이터/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "D1 / 창업보육센터 배치 편집" }));
    expect(open).toHaveBeenCalledWith({ scenarioId: "D1-s", buildingId: "D1" });
  });

  it("keeps the table frame with an empty-state row when no rankings exist", async () => {
    const client = { load: vi.fn().mockResolvedValue({ ...parsed, ranked: [] }) };
    render(<CampusComparison client={client} date="2026-05-18" />);
    expect(await screen.findByText("비교할 대표 설치안이 없습니다")).toBeTruthy();
    expect(screen.getByRole("table", { name: /캠퍼스 비교/ })).toBeTruthy();
    expect(screen.getByText(/추정 · 시뮬레이션 기준일 5월 18일/)).toBeTruthy();
  });

  it("shows a skeleton without a spinner while loading", () => {
    const client = { load: vi.fn(() => new Promise(() => {})) };
    render(<CampusComparison client={client} date="2026-05-18" />);
    expect(document.querySelector('[data-qa="skeleton"]')).not.toBeNull();
    expect(document.querySelector(".animate-spin")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("비교 중");
  });

  it("waits quietly while the energy feed is down and offers 다시 시도 only when the feed is up", async () => {
    const failing = { load: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) };
    const view = render(<CampusComparison client={failing} date="2026-05-18" feedDown />);
    expect((await screen.findByText(/에너지 연결을 기다리는 중/)).getAttribute("role")).toBe("status");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("table", { name: /캠퍼스 비교/ })).toBeTruthy();
    view.rerender(<CampusComparison client={failing} date="2026-05-18" feedDown={false} />);
    expect(await screen.findByRole("button", { name: "다시 시도" })).toBeTruthy();
  });
});

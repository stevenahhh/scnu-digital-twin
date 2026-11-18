/* @vitest-environment happy-dom */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildingAnalysis } from "./BuildingAnalysis.jsx";
import { analysisRunFixture, analysisScenarioFixture, directAnalysisRunFixture } from "./analysisFixtures.test.mjs";

const plans = [{ id: "plan-representative", name: "Representative south roof", isRepresentative: true }, { id: "plan-alternative", name: "Alternative compact roof" }];
const clientWith = (overrides = {}) => ({
  createScenario: vi.fn().mockResolvedValue(analysisScenarioFixture()),
  updateScenario: vi.fn().mockResolvedValue(analysisScenarioFixture()),
  listScenarios: vi.fn().mockResolvedValue([]),
  runScenario: vi.fn().mockResolvedValue(analysisRunFixture()),
  getRun: vi.fn(),
  listRuns: vi.fn().mockResolvedValue([]),
  ...overrides,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(cleanup);
// 건물 분석은 기본으로 접혀 있다. 요금·탄소 계수와 이전 실행은 그 안의 고급 펼침에 있다.
async function expand(user) {
  await user.click(screen.getByRole("button", { name: "분석 조건과 결과" }));
  const advanced = screen.queryByRole("button", { name: /^고급/ });
  if (advanced) await user.click(advanced);
}

describe("BuildingAnalysis", () => {
  it("adopts asynchronously loaded plans and representative selection", async () => {
    const client = clientWith();
    const { rerender } = render(<BuildingAnalysis buildingId="D4" plans={[]} representativePlanId={null} date="2026-05-18" client={client} />);
    expect(screen.getByText("분석할 설치 계획이 없습니다.")).toBeTruthy();
    rerender(<BuildingAnalysis buildingId="D4" plans={plans} representativePlanId="plan-representative" date="2026-05-18" client={client} />);
    await waitFor(() => expect(screen.getByLabelText("대표 설치 계획").value).toBe("plan-representative"));
    await expand(userEvent.setup());
    expect(screen.getByRole("button", { name: "분석 실행" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("tells plan loading and a failed plan load apart from an empty plan list", async () => {
    const client = clientWith();
    const view = render(<BuildingAnalysis buildingId="D4" plans={[]} plansStatus="loading" date="2026-05-18" client={client} />);
    expect(screen.getByText("설치 계획을 불러오는 중입니다.")).toBeTruthy();
    view.rerender(<BuildingAnalysis buildingId="D4" plans={[]} plansStatus="error" date="2026-05-18" client={client} />);
    expect(screen.getByText("설치 계획을 불러오지 못해 분석할 수 없습니다.")).toBeTruthy();
    expect(screen.queryByText("분석할 설치 계획이 없습니다.")).toBeNull();
    view.rerender(<BuildingAnalysis buildingId="D4" plans={[]} plansStatus="ready" date="2026-05-18" client={client} />);
    expect(screen.getByText("분석할 설치 계획이 없습니다.")).toBeTruthy();
    // Not a sleep: lets the mocked client's listScenarios/listRuns promises settle inside act before the test ends.
    await act(async () => {});
  });

  it("creates a persisted definition and sends one atomic comparison run request", async () => {
    const user = userEvent.setup();
    const client = clientWith();
    render(<BuildingAnalysis buildingId="D4" buildingName="D4 / 공대 3호관" plans={plans} date="2026-05-18" client={client} />);
    await waitFor(() => expect(client.listRuns).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "분석 조건과 결과" }).getAttribute("aria-expanded")).toBe("false");
    await expand(user);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    await waitFor(() => expect(client.runScenario).toHaveBeenCalledTimes(1));
    expect(client.createScenario).toHaveBeenCalledTimes(1);
    expect(client.updateScenario).not.toHaveBeenCalled();
    expect(client.createScenario.mock.calls[0][0]).toMatchObject({
      buildingId: "D4", representativePlanId: "plan-representative", alternativePlanId: "plan-alternative", weatherPreset: "clear",
      electricityPriceKrwPerKwh: 160, carbonIntensityKgCo2ePerKwh: 0.45,
    });
    expect(client.runScenario.mock.calls[0].slice(0, 2)).toEqual(["analysis-scenario-D4", "2026-05-18"]);
    expect(client.runScenario.mock.calls[0][3]).toEqual({
      demandSource: "predicted", weatherPreset: "clear",
      electricityPriceKrwPerKwh: 160, carbonIntensityKgCo2ePerKwh: 0.45,
    });
  });

  it("loads and updates the persisted definition conditions before another atomic run", async () => {
    const user = userEvent.setup();
    const saved = analysisScenarioFixture({ conditions: {
      demand_source: "predicted", weather_preset: "clear",
      electricity_price_krw_per_kwh: 245,
      carbon_intensity_kg_co2e_per_kwh: 0.58,
    } });
    const client = clientWith({ listScenarios: vi.fn().mockResolvedValue([saved]) });
    const view = render(<BuildingAnalysis buildingId="D4" plans={plans} date="2026-05-18" weatherPreset="clear" client={client} />);
    await waitFor(() => expect(screen.getByLabelText("전기요금 (KRW/kWh)").value).toBe("245"));
    expect(screen.getByLabelText("탄소배출계수 (kgCO2/kWh)").value).toBe("0.58");
    expect(screen.queryByLabelText("분석 날짜")).toBeNull();
    expect(screen.queryByLabelText("기준선")).toBeNull();
    // 기상 프리셋은 에너지 탭 맨 위의 선택 하나가 정한다.
    view.rerender(<BuildingAnalysis buildingId="D4" plans={plans} date="2026-05-19" weatherPreset="overcast" client={client} />);
    await expand(user);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    await waitFor(() => expect(client.runScenario).toHaveBeenCalledTimes(1));
    expect(client.createScenario).not.toHaveBeenCalled();
    expect(client.updateScenario.mock.calls[0][0]).toBe("analysis-scenario-D4");
    expect(client.updateScenario.mock.calls[0][1]).toMatchObject({
      weatherPreset: "overcast",
      electricityPriceKrwPerKwh: 245,
      carbonIntensityKgCo2ePerKwh: 0.58,
    });
    expect(client.runScenario.mock.calls[0][1]).toBe("2026-05-19");
  });

  it("submits editable cost conditions and renders their snapshot KPIs", async () => {
    const user = userEvent.setup();
    const customRun = analysisRunFixture({ scenarioOverrides: { conditions: {
      demand_source: "predicted", weather_preset: "clear",
      electricity_price_krw_per_kwh: 275,
      carbon_intensity_kg_co2e_per_kwh: 0.61,
    } } });
    const client = clientWith({ runScenario: vi.fn().mockResolvedValue(customRun) });
    render(<BuildingAnalysis buildingId="D4" plans={plans} date="2026-05-18" client={client} />);
    await expand(user);
    await user.clear(screen.getByLabelText("전기요금 (KRW/kWh)"));
    await user.type(screen.getByLabelText("전기요금 (KRW/kWh)"), "275");
    await user.clear(screen.getByLabelText("탄소배출계수 (kgCO2/kWh)"));
    await user.type(screen.getByLabelText("탄소배출계수 (kgCO2/kWh)"), "0.61");
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    await waitFor(() => expect(client.runScenario).toHaveBeenCalledTimes(1));
    expect(client.createScenario.mock.calls[0][0]).toMatchObject({
      electricityPriceKrwPerKwh: 275,
      carbonIntensityKgCo2ePerKwh: 0.61,
    });
    // 결과는 규칙 기반 해석이 맨 위이고, 헤드라인 지표 4개가 뒤따른다(나머지는 펼침 안).
    const report = document.querySelector('[data-qa="analysis-report"]');
    expect(report.firstElementChild.textContent).toContain("규칙 기반 해석");
    expect(screen.getByText("비용 절감")).toBeTruthy();
    expect(screen.getByText("탄소 감축")).toBeTruthy();
  });

  it("renders the alternate comparison plus grid-draw series and legend from 96 slots", async () => {
    const user = userEvent.setup();
    const client = clientWith();
    render(<BuildingAnalysis buildingId="D4" plans={plans} date="2026-05-18" client={client} />);
    await expand(user);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect(await screen.findByText("대안 계획 발전")).toBeTruthy();
    expect(screen.getByText(/대표 계획은 대안보다/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /96개 15분 구간의 수요, 계통 인입/ })).toBeTruthy();
    expect(screen.getByText("계통 인입")).toBeTruthy();
    expect(document.querySelector('path[data-series="grid-draw"]')?.getAttribute("d")?.split("L")).toHaveLength(96);
  });

  it("loads mixed history and selects the newest run independent of backend order", async () => {
    const newestDirect = directAnalysisRunFixture({ id: "newest-direct", created_at: "2026-05-20T09:01:00+09:00" });
    const olderScenario = analysisRunFixture({ id: "older-scenario", created_at: "2026-05-19T09:01:00+09:00" });
    const client = clientWith({ listRuns: vi.fn().mockResolvedValue([olderScenario, newestDirect]) });
    render(<BuildingAnalysis buildingId="D4" plans={plans} date="2026-05-18" client={client} />);
    await waitFor(() => expect(screen.getByLabelText("이전 실행 스냅샷").value).toBe("newest-direct"));
    fireEvent.click(screen.getByLabelText("이전 실행 스냅샷"));
    expect(await screen.findAllByRole("option")).toHaveLength(3);
  });

  it("reloads immutable history after remount even when its live definition was deleted", async () => {
    const history = analysisRunFixture({ id: "persisted-run" });
    const client = clientWith({ listScenarios: vi.fn().mockResolvedValue([]), listRuns: vi.fn().mockResolvedValue([history]) });
    const first = render(<BuildingAnalysis buildingId="D4" plans={plans} date="2026-05-18" client={client} />);
    await waitFor(() => expect(screen.getByLabelText("이전 실행 스냅샷").value).toBe("persisted-run"));
    expect(document.querySelector('[data-qa="analysis-report"]')).not.toBeNull();
    first.unmount();
    render(<BuildingAnalysis buildingId="D4" plans={plans} date="2026-05-18" client={client} />);
    await waitFor(() => expect(screen.getByLabelText("이전 실행 스냅샷").value).toBe("persisted-run"));
    expect(client.listRuns).toHaveBeenCalledTimes(2);
    expect(client.listScenarios).toHaveBeenCalledTimes(2);
  });

  it("aborts execution on context change and ignores a stale completion", async () => {
    const pending = deferred();
    const pendingUnmount = deferred();
    const onRun = vi.fn();
    const client = clientWith({ createScenario: vi.fn().mockReturnValueOnce(pending.promise).mockReturnValueOnce(pendingUnmount.promise) });
    const user = userEvent.setup();
    const view = render(<BuildingAnalysis buildingId="D4" plans={plans} date="2026-05-18" client={client} onRun={onRun} />);
    await waitFor(() => expect(client.listRuns).toHaveBeenCalled());
    await expand(user);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    const signal = client.createScenario.mock.calls[0][1];
    view.rerender(<BuildingAnalysis buildingId="D3" plans={[{ id: "D3-plan", name: "D3 plan", isRepresentative: true }]} date="2026-05-18" client={client} onRun={onRun} />);
    expect(signal.aborted).toBe(true);
    pending.resolve(analysisScenarioFixture());
    await waitFor(() => expect(screen.getByLabelText("대표 설치 계획").value).toBe("D3-plan"));
    expect(client.runScenario).not.toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByText("대표 계획 발전")).toBeNull();

    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    const unmountSignal = client.createScenario.mock.calls[1][1];
    view.unmount();
    expect(unmountSignal.aborted).toBe(true);
  });

  it("reports definition and run errors without fabricating results", async () => {
    const user = userEvent.setup();
    const client = clientWith({ createScenario: vi.fn().mockRejectedValue(new Error("definition offline")) });
    const view = render(<BuildingAnalysis buildingId="D4" plans={plans} date="2026-05-18" client={client} />);
    await expand(user);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect((await screen.findByRole("alert")).textContent).toContain("요청을 처리하지 못했습니다");
    expect(client.runScenario).not.toHaveBeenCalled();
    expect(screen.queryByText("대표 계획 발전")).toBeNull();

    const runFailure = clientWith({ runScenario: vi.fn().mockRejectedValue(new Error("atomic run failed")) });
    view.unmount();
    render(<BuildingAnalysis buildingId="D4" plans={plans} date="2026-05-18" client={runFailure} />);
    await expand(user);
    await user.click(screen.getByRole("button", { name: "분석 실행" }));
    expect((await screen.findByRole("alert")).textContent).toContain("요청을 처리하지 못했습니다");
    expect(screen.queryByText("대표 계획 발전")).toBeNull();
  });
});

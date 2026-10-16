/* @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let resolveRepresentative;
const representativeLoad = new Promise((resolve) => { resolveRepresentative = resolve; });
const installationClient = {
  listDetails: vi.fn().mockResolvedValue([]),
  getRepresentative: vi.fn().mockReturnValue(representativeLoad),
};

vi.mock("./features/energy/installations/installationPlanApi.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createInstallationPlanClient: () => installationClient };
});
vi.mock("./vworld/VWorldRenderer", () => ({
  default: ({ onSelection, onRepresentativeInstallationPlanChange, onD4SectionChange }) => <div>
    <button type="button" onClick={() => onSelection({ elementId: "BLD_D4", buildingId: "D4", displayName: "D4" })}>D4 선택</button>
    <button type="button" onClick={() => onRepresentativeInstallationPlanChange({ buildingId: "D4", installationPlanId: "plan-new" })}>새 대표 선택</button>
    <button type="button" onClick={() => { onSelection({ elementId: "BLD_D4", buildingId: "D4", displayName: "D4" }); onD4SectionChange(true); }}>D4 상세 열기</button>
    <button type="button" onClick={() => onD4SectionChange(false)}>D4 상세 닫기</button>
  </div>,
}));
vi.mock("./features/energy/analysis", () => ({ BuildingAnalysis: ({ representativePlanId }) => <div data-testid="app-representative">{representativePlanId ?? "none"}</div> }));
vi.mock("./features/energy/dashboard/EnergyDashboard", () => ({ EnergyDashboard: () => null }));
vi.mock("./features/energy/campus/CampusComparisonPanel", () => ({ CampusComparison: () => null }));

import App from "./AppVWorld.jsx";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url) => String(url).includes("/popup")
    ? { ok: false, status: 404, json: async () => null }
    : { ok: true, status: 200, json: async () => ({ base_weather: { temperature: 20 }, weather_timeline: [] }) }));
  window.matchMedia = vi.fn(() => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AppVWorld installation selection lifecycle", () => {
  it("does not let an older same-building representative load overwrite a newer selection", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "D4 선택" }));
    await user.click(screen.getByRole("button", { name: "새 대표 선택" }));
    expect((await screen.findByTestId("app-representative")).textContent).toBe("plan-new");

    await act(async () => { resolveRepresentative({ buildingId: "D4", installationPlanId: "plan-old" }); });
    expect(screen.getByTestId("app-representative").textContent).toBe("plan-new");
  });

  it("holds the building popup while the D4 detail experience is open and shows it after the experience closes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "D4 상세 열기" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "D4 상세 닫기" }));
    expect(await screen.findByRole("dialog", { name: "D4" })).toBeTruthy();
  });
});

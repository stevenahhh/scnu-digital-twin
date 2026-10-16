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
  default: ({ onSelection, onRepresentativeInstallationPlanChange, onD4SectionChange, overlaysCovered }) => <div data-testid="vworld-renderer" data-overlays-covered={String(Boolean(overlaysCovered))}>
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

  it("marks the map overlays covered only while the open panel spans a narrow viewport", async () => {
    vi.stubGlobal("innerWidth", 390);
    const user = userEvent.setup();
    render(<App />);
    const renderer = screen.getByTestId("vworld-renderer");
    expect(renderer.dataset.overlaysCovered).toBe("true");

    await user.click(screen.getByRole("button", { name: "패널 닫기" }));
    expect(renderer.dataset.overlaysCovered).toBe("false");

    await user.click(screen.getByRole("button", { name: "패널 열기" }));
    expect(renderer.dataset.overlaysCovered).toBe("true");

    vi.stubGlobal("innerWidth", 1024);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(renderer.dataset.overlaysCovered).toBe("false");
  });

  it("hides the dashboard panel and its toggle while the D4 detail experience is open and restores them after it closes", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const panel = () => container.querySelector('[data-qa="dashboard-panel"]');

    expect(screen.getByRole("button", { name: "패널 닫기" })).toBeTruthy();
    expect(panel().hasAttribute("aria-hidden")).toBe(false);
    expect(panel().hasAttribute("inert")).toBe(false);

    await user.click(screen.getByRole("button", { name: "D4 상세 열기" }));
    expect(screen.queryByRole("button", { name: "패널 닫기" })).toBeNull();
    expect(panel().getAttribute("aria-hidden")).toBe("true");
    expect(panel().hasAttribute("inert")).toBe(true);

    await user.click(screen.getByRole("button", { name: "D4 상세 닫기" }));
    expect(screen.getByRole("button", { name: "패널 닫기" })).toBeTruthy();
    expect(panel().hasAttribute("aria-hidden")).toBe(false);
    expect(panel().hasAttribute("inert")).toBe(false);
  });
});

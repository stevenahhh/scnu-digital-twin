/* @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The three energy sections are stubbed: this test pins their order in the tab, not their content.
vi.mock("../features/energy/dashboard/EnergyDashboard", () => ({ EnergyDashboard: () => <div data-qa="energy-dashboard" /> }));
vi.mock("../features/energy/analysis", () => ({ BuildingAnalysis: () => <div data-qa="building-analysis" /> }));
vi.mock("../features/energy/campus/CampusComparisonPanel", () => ({ CampusComparison: () => <div data-qa="campus-comparison" /> }));

const { EnergyTab } = await import("./EnergyTab.jsx");

afterEach(cleanup);

const plans = { plans: [], status: "ready", representativePlanId: null };
const order = () => [...document.querySelectorAll("[data-qa=energy-dashboard],[data-qa=building-analysis],[data-qa=campus-comparison]")]
  .map((node) => node.dataset.qa);

describe("EnergyTab section order", () => {
  it("opens on the campus comparison when no building is selected", () => {
    render(<EnergyTab buildingId="D4" hasSelection={false} plans={plans} feedStatus={{ state: "live" }} sceneDate="2026-11-10" />);
    expect(order()[0]).toBe("campus-comparison");
  });

  it("keeps building summary, analysis, then comparison when a building is selected", () => {
    render(<EnergyTab buildingId="D4" hasSelection plans={plans} feedStatus={{ state: "live" }} sceneDate="2026-11-10" />);
    expect(order()).toEqual(["energy-dashboard", "building-analysis", "campus-comparison"]);
  });
});

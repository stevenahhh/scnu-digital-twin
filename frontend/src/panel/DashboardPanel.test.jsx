/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPanel, normalizeTab } from "./DashboardPanel.jsx";

afterEach(cleanup);

const renderPanel = (props = {}) =>
  render(
    <DashboardPanel activeTab="status" onTabChange={() => {}} {...props}>
      <p>본문</p>
    </DashboardPanel>,
  );

describe("DashboardPanel", () => {
  it("renders the four dashboard tabs as one Segmented tablist with their QA hooks and one tabpanel", () => {
    renderPanel();
    const tablist = screen.getByRole("tablist", { name: "대시보드 보기" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["건물", "현황", "에너지", "시뮬레이션"]);
    expect(tabs.map((tab) => tab.dataset.qa)).toEqual([
      "dashboard-tab-building",
      "dashboard-tab-status",
      "dashboard-tab-energy",
      "dashboard-tab-simulation",
    ]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[1].id);
    expect(tabs[1].getAttribute("aria-controls")).toBe(panel.id);
    expect(within(panel).getByText("본문")).toBeTruthy();
  });

  it("reports tab changes with the arrow keys", () => {
    const onTabChange = vi.fn();
    renderPanel({ onTabChange });
    fireEvent.click(screen.getByRole("tab", { name: "시뮬레이션" }));
    expect(onTabChange).toHaveBeenCalledWith("simulation");
    fireEvent.keyDown(screen.getByRole("tab", { name: "현황" }), { key: "ArrowRight" });
    expect(onTabChange).toHaveBeenLastCalledWith("energy");
  });

  it("is an opaque surface with no blur or heavy shadow, titled with the tab name alone", () => {
    const { container, rerender } = renderPanel();
    // The panel is a named region, not a card section (V-F-27: no h2 inside a card).
    const surface = screen.getByRole("region", { name: "대시보드" });
    expect(container.querySelector("section")).toBeNull();
    expect(surface.className).toMatch(/\bbg-surface-1\b/);
    expect(surface.className).not.toMatch(/backdrop|shadow-2xl|color-mix/);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("현황");
    rerender(
      <DashboardPanel activeTab="energy" onTabChange={() => {}}>
        <p>본문</p>
      </DashboardPanel>,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("에너지");
    rerender(
      <DashboardPanel activeTab="energy" onTabChange={() => {}} showTitle={false}>
        <p>본문</p>
      </DashboardPanel>,
    );
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("reads the pre-redesign tab values as the tab their content moved to", () => {
    expect(["dashboard", "parking_safety", "environment", "energy", "building", "evil"].map(normalizeTab))
      .toEqual(["status", "status", "simulation", "energy", "building", null]);
  });
});

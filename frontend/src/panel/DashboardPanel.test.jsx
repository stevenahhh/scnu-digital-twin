/* @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPanel } from "./DashboardPanel.jsx";

afterEach(cleanup);

const renderPanel = (props = {}) =>
  render(
    <DashboardPanel activeTab="dashboard" onTabChange={() => {}} {...props}>
      <p>본문</p>
    </DashboardPanel>,
  );

describe("DashboardPanel", () => {
  it("renders the four dashboard tabs as one Segmented tablist with their QA hooks", () => {
    renderPanel();
    const tablist = screen.getByRole("tablist", { name: "대시보드 보기" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["기본 현황", "주차·안전", "에너지", "환경 시뮬"]);
    expect(tabs.map((tab) => tab.dataset.qa)).toEqual([
      "dashboard-tab-dashboard",
      "dashboard-tab-parking_safety",
      "dashboard-tab-energy",
      "dashboard-tab-environment",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("reports tab changes and appends extra tabs after the fixed four", () => {
    const onTabChange = vi.fn();
    renderPanel({ onTabChange, extraTabs: [{ value: "compare", label: "비교" }] });
    fireEvent.click(screen.getByRole("tab", { name: "비교" }));
    expect(onTabChange).toHaveBeenCalledWith("compare");
    fireEvent.keyDown(screen.getByRole("tab", { name: "기본 현황" }), { key: "ArrowRight" });
    expect(onTabChange).toHaveBeenLastCalledWith("parking_safety");
  });

  it("is an opaque surface with no blur or heavy shadow, titled with the view it shows", () => {
    const { container, rerender } = renderPanel();
    // The panel is a named region, not a card section (V-F-27: no h2 inside a card).
    const surface = screen.getByRole("region", { name: "대시보드" });
    expect(container.querySelector("section")).toBeNull();
    expect(surface.className).toMatch(/\bbg-surface-1\b/);
    expect(surface.className).not.toMatch(/backdrop|shadow-2xl|color-mix/);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("순천대 캠퍼스 · 기본 현황");
    rerender(
      <DashboardPanel activeTab="energy" onTabChange={() => {}}>
        <p>본문</p>
      </DashboardPanel>,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("순천대 캠퍼스 · 에너지");
  });
});

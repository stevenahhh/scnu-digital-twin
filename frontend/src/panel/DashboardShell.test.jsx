/* @vitest-environment happy-dom */
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewportMode } from "../hooks/useViewportMode.mjs";
import { DashboardShell, SETTLE_MS, shellInsetRight } from "./DashboardShell.jsx";
import { PANEL_OPEN_KEY, usePanelState } from "./usePanelState.mjs";

// 폭(px)에 맞춰 useViewportMode의 두 미디어 쿼리에 답하는 matchMedia.
const mediaFor = (width) => vi.fn((query) => ({
  matches: query === "(max-width: 639px)" ? width <= 639 : query === "(max-width: 1023px)" ? width <= 1023 : false,
  addEventListener() {},
  removeEventListener() {},
}));

let stored;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", { getItem: (key) => stored.get(key) ?? null, setItem: vi.fn((key, value) => stored.set(key, value)) });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ hasSelection = false, tabAlerts }) {
  const mode = useViewportMode();
  const panel = usePanelState(mode);
  const [tab, setTab] = useState("status");
  return (
    <DashboardShell
      mode={mode}
      open={panel.open}
      onOpenChange={panel.setUserOpen}
      detent={panel.detent}
      onDetentChange={panel.setDetent}
      activeTab={tab}
      onTabChange={setTab}
      hasSelection={hasSelection}
      tabAlerts={tabAlerts}
    >
      <p>본문</p>
    </DashboardShell>
  );
}

const shell = (container) => container.querySelector('[data-qa="dashboard-panel"]');

describe("DashboardShell", () => {
  it("puts a dot and the count on the tab that has something to check, on the rail and on the phone's closed sheet", () => {
    window.matchMedia = mediaFor(1440);
    const desktop = render(<Harness tabAlerts={{ status: 2 }} />);
    const rail = screen.getByRole("button", { name: "현황, 확인할 알림 2건" });
    expect(rail.querySelector("[data-qa=alert-dot]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "에너지" }).querySelector("[data-qa=alert-dot]")).toBeNull();
    desktop.unmount();
    window.matchMedia = mediaFor(390);
    render(<Harness tabAlerts={{ status: 2 }} />);
    expect(screen.getByRole("button", { name: "패널 열기, 확인할 알림 2건" }).querySelector("[data-qa=alert-dot]")).toBeTruthy();
  });

  it("renders the 56 px rail on a first visit at 1440 px with tab icons only, adding 건물 once something is selected", () => {
    window.matchMedia = mediaFor(1440);
    const { container, rerender } = render(<Harness />);
    expect(shell(container).dataset.mode).toBe("desktop");
    expect(shell(container).dataset.open).toBe("false");
    expect(shell(container).style.transform).toBe("translateX(calc(100% - var(--dashboard-rail-width)))");
    const railNames = () => [...container.querySelectorAll('[data-qa="dashboard-rail"] button')].map((button) => button.getAttribute("aria-label"));
    expect(railNames()).toEqual(["현황", "에너지", "시뮬레이션"]);
    rerender(<Harness hasSelection />);
    expect(railNames()).toEqual(["건물", "현황", "에너지", "시뮬레이션"]);
    expect(shellInsetRight("desktop", false)).toBe("var(--dashboard-rail-width)");
    expect(shellInsetRight("desktop", true)).toBe("var(--dashboard-panel-width)");
  });

  it("keeps the content visible while the panel slides closed and mounts the rail only after the slide", () => {
    vi.useFakeTimers();
    window.matchMedia = mediaFor(1440);
    stored.set(PANEL_OPEN_KEY, "true");
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
    expect(shell(container).dataset.open).toBe("false");
    expect(container.querySelector('[data-qa="dashboard-rail"]')).toBeNull();
    expect(screen.getByRole("tablist", { name: "대시보드 보기" }).closest("[aria-hidden]")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(container.querySelector('[data-qa="dashboard-rail"]')).not.toBeNull();
    vi.useRealTimers();
  });

  it("persists the user's toggle and opens at the tab picked on the rail", () => {
    window.matchMedia = mediaFor(1440);
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "에너지" }));
    expect(shell(container).dataset.open).toBe("true");
    expect(localStorage.setItem).toHaveBeenLastCalledWith(PANEL_OPEN_KEY, "true");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("에너지");

    fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
    expect(localStorage.setItem).toHaveBeenLastCalledWith(PANEL_OPEN_KEY, "false");
    cleanup();
    stored.set(PANEL_OPEN_KEY, "true");
    const again = render(<Harness />);
    expect(shell(again.container).dataset.open).toBe("true");
  });

  it("renders the bottom sheet at peek on a phone with the tab name only, keeps it at half when a tab is tapped (full only by dragging), and never covers the scene with a scrim", () => {
    window.matchMedia = mediaFor(390);
    const { container } = render(<Harness />);
    const sheet = shell(container);
    expect(sheet.dataset.qa).toBe("dashboard-panel");
    expect(sheet.dataset.detent).toBe("peek");
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["현황"]);
    expect(container.querySelector('[data-qa="sheet-time"]')).toBeNull();
    expect(container.querySelector("[data-qa=scrim], .backdrop-blur, [aria-modal=true]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "패널 열기" }));
    expect(sheet.dataset.detent).toBe("half");
    fireEvent.click(screen.getByRole("tab", { name: "시뮬레이션" }));
    expect(sheet.dataset.detent).toBe("half");
    expect(shellInsetRight("phone", true)).toBe("0px");
  });

  it("closes the tablet drawer on Escape and returns focus to the current tab on the rail once it appears", () => {
    vi.useFakeTimers();
    window.matchMedia = mediaFor(800);
    stored.set(PANEL_OPEN_KEY, "true");
    const { container } = render(<Harness />);
    expect(shell(container).dataset.mode).toBe("tablet");
    expect(shell(container).style.width).toBe("var(--dashboard-drawer-width)");
    const tab = screen.getByRole("tab", { name: "현황" });
    tab.focus();
    act(() => {
      fireEvent.keyDown(tab, { key: "Escape" });
    });
    expect(shell(container).dataset.open).toBe("false");
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(document.activeElement).toBe(container.querySelector('[data-qa="dashboard-rail"] [aria-current="page"]'));
    vi.useRealTimers();
  });
});

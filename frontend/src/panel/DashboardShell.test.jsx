/* @vitest-environment jsdom */
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewportMode } from "../hooks/useViewportMode.mjs";
import { DashboardShell, shellInsetRight } from "./DashboardShell.jsx";
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

function Harness() {
  const mode = useViewportMode();
  const panel = usePanelState(mode);
  const [tab, setTab] = useState("dashboard");
  return (
    <DashboardShell
      mode={mode}
      open={panel.open}
      onOpenChange={panel.setUserOpen}
      detent={panel.detent}
      onDetentChange={panel.setDetent}
      activeTab={tab}
      onTabChange={setTab}
      timeReadout="장면 19:00"
    >
      <p>본문</p>
    </DashboardShell>
  );
}

const shell = (container) => container.querySelector('[data-qa="dashboard-panel"]');

describe("DashboardShell", () => {
  it("renders the 56 px rail on a first visit at 1440 px, with four tab buttons and the open toggle", () => {
    window.matchMedia = mediaFor(1440);
    const { container } = render(<Harness />);
    expect(shell(container).dataset.mode).toBe("desktop");
    expect(shell(container).dataset.open).toBe("false");
    expect(shell(container).style.transform).toBe("translateX(calc(100% - var(--dashboard-rail-width)))");
    const rail = container.querySelector('[data-qa="dashboard-rail"]');
    expect([...rail.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")))
      .toEqual(["패널 열기", "기본 현황", "주차·안전", "에너지", "환경 시뮬"]);
    expect(shellInsetRight("desktop", false)).toBe("var(--dashboard-rail-width)");
  });

  it("persists the user's toggle and opens at the tab picked on the rail", () => {
    window.matchMedia = mediaFor(1440);
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "에너지" }));
    expect(shell(container).dataset.open).toBe("true");
    expect(localStorage.setItem).toHaveBeenLastCalledWith(PANEL_OPEN_KEY, "true");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("순천대 캠퍼스 · 에너지");

    fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
    expect(localStorage.setItem).toHaveBeenLastCalledWith(PANEL_OPEN_KEY, "false");
    cleanup();
    stored.set(PANEL_OPEN_KEY, "true");
    const again = render(<Harness />);
    expect(shell(again.container).dataset.open).toBe("true");
  });

  it("renders the bottom sheet at peek on a phone, goes to full when a tab is tapped, and never covers the scene with a scrim", () => {
    window.matchMedia = mediaFor(390);
    const { container } = render(<Harness />);
    const sheet = shell(container);
    expect(sheet.dataset.qa).toBe("dashboard-panel");
    expect(sheet.dataset.detent).toBe("peek");
    expect(screen.getByText("장면 19:00")).toBeTruthy();
    expect(screen.getByRole("img", { name: "순천대학교" })).toBeTruthy();
    expect(container.querySelector("[data-qa=scrim], .backdrop-blur, [aria-modal=true]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "패널 열기" }));
    expect(sheet.dataset.detent).toBe("half");
    fireEvent.click(screen.getByRole("tab", { name: "환경 시뮬" }));
    expect(sheet.dataset.detent).toBe("full");
    expect(shellInsetRight("phone", true)).toBe("0px");
  });

  it("closes the tablet drawer on Escape and returns focus to the open toggle", () => {
    window.matchMedia = mediaFor(800);
    stored.set(PANEL_OPEN_KEY, "true");
    const { container } = render(<Harness />);
    expect(shell(container).dataset.mode).toBe("tablet");
    expect(shell(container).style.width).toBe("min(440px, 85vw)");
    const tab = screen.getByRole("tab", { name: "기본 현황" });
    tab.focus();
    act(() => {
      fireEvent.keyDown(tab, { key: "Escape" });
    });
    expect(shell(container).dataset.open).toBe("false");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "패널 열기" }));
  });
});

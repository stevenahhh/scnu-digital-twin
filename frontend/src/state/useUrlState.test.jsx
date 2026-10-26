/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUrlState } from "./useUrlState.mjs";
import { LINK_COPIED, LinkCopyButton } from "../panel/LinkCopyButton.jsx";

const KNOWN = ["BLD_C1", "BLD_D4"];
const baseState = { building: null, minute: 600, date: "2026-10-26", mode: "simulation", panelOpen: false, tab: "dashboard" };

describe("useUrlState", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it("restores selection, time and tab from the address on load and drops invalid params", () => {
    window.history.replaceState(null, "", "/?model=uni&b=BLD_C1&t=720&tab=energy&cam=NaN,1,2,3,4,5");
    const apply = { building: vi.fn(), minute: vi.fn(), tab: vi.fn(), date: vi.fn(), mode: vi.fn(), panelOpen: vi.fn() };
    renderHook(() => useUrlState({ knownIds: KNOWN, state: baseState, apply }));
    expect(apply.building).toHaveBeenCalledWith("BLD_C1");
    expect(apply.minute).toHaveBeenCalledWith(720);
    expect(apply.tab).toHaveBeenCalledWith("energy");
    expect(new URLSearchParams(window.location.search).get("cam")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("model")).toBe("uni");
  });

  it("writes the current state with one replaceState after the debounce, never pushState", () => {
    const push = vi.spyOn(window.history, "pushState");
    const { rerender } = renderHook(({ state }) => useUrlState({ knownIds: KNOWN, state, apply: {} }), { initialProps: { state: baseState } });
    rerender({ state: { ...baseState, building: "BLD_D4", minute: 1260 } });
    rerender({ state: { ...baseState, building: "BLD_D4", minute: 1261 } });
    expect(new URLSearchParams(window.location.search).get("t")).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("b")).toBe("BLD_D4");
    expect(params.get("t")).toBe("1261");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("LinkCopyButton", () => {
  afterEach(cleanup);

  it("copies the address and confirms with a status line", async () => {
    vi.useRealTimers();
    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
    render(<LinkCopyButton getHref={() => "http://campus.test/?b=BLD_C1"} clipboard={clipboard} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "링크 복사" })));
    expect(clipboard.writeText).toHaveBeenCalledWith("http://campus.test/?b=BLD_C1");
    expect(screen.getByRole("status").textContent).toBe(LINK_COPIED);
  });

  it("shows the address in a read-only field when the clipboard is unavailable", async () => {
    render(<LinkCopyButton getHref={() => "http://campus.test/?t=60"} clipboard={undefined} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "링크 복사" })));
    const field = screen.getByRole("textbox", { name: "공유 링크" });
    expect(field.value).toBe("http://campus.test/?t=60");
    expect(field.readOnly).toBe(true);
  });
});

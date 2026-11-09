/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUrlState } from "./useUrlState.mjs";

const KNOWN = ["BLD_C1", "BLD_D4"];
const baseState = { building: null, minute: 600, date: "2026-10-26", mode: "simulation", panelOpen: false, tab: "status" };

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

/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePresentationMode } from "./usePresentationMode.mjs";

afterEach(cleanup);

const panelState = { open: true, detent: "half", setOpen: vi.fn(), setDetent: vi.fn() };

// The camera tour as AppLegacy wires it: touring state plus stopTour.
function usePresentationWithTour() {
  const [touring, setTouring] = useState(false);
  const presentation = usePresentationMode({
    panelState, activeTab: "status", setActiveTab: vi.fn(), touring, stopTour: () => setTouring(false),
  });
  return { ...presentation, touring, startTour: () => setTouring(true) };
}

const press = (key) => act(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
});

describe("usePresentationMode tour lifecycle", () => {
  it("stops a running tour on the first Esc and keeps presenting, then exits on the second Esc", () => {
    const { result } = renderHook(() => usePresentationWithTour());
    act(() => result.current.toggle());
    act(() => result.current.startTour());
    expect(result.current.presenting).toBe(true);
    expect(result.current.touring).toBe(true);

    press("Escape");
    expect(result.current.touring).toBe(false);
    expect(result.current.presenting).toBe(true);

    press("Escape");
    expect(result.current.presenting).toBe(false);
  });

  it("exits on the first Esc when no tour is running", () => {
    const { result } = renderHook(() => usePresentationWithTour());
    act(() => result.current.toggle());
    press("Escape");
    expect(result.current.presenting).toBe(false);
  });

  it.each([
    ["P", () => press("p")],
    ["발표 모드 끝내기 (toggle)", (result) => act(() => result.current.toggle())],
    ["exit", (result) => act(() => result.current.exit())],
  ])("stops the tour whenever presentation ends by %s", (_, leave) => {
    const { result } = renderHook(() => usePresentationWithTour());
    act(() => result.current.toggle());
    act(() => result.current.startTour());
    leave(result);
    expect(result.current.presenting).toBe(false);
    expect(result.current.touring).toBe(false);
  });
});

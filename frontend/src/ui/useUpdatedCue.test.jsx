/* @vitest-environment happy-dom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTINUOUS_GAP_MS, UPDATED_CUE_MS, isDiscreteJump, useUpdatedCue } from "./useUpdatedCue.mjs";

afterEach(() => vi.useRealTimers());

describe("useUpdatedCue", () => {
  it("is off on mount, on right after the value changes and off again after the cue time", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useUpdatedCue(value), { initialProps: { value: 1140 } });
    expect(result.current).toBe(false);
    rerender({ value: 1260 });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(UPDATED_CUE_MS + 1);
    });
    expect(result.current).toBe(false);
  });

  it("stays off for one-minute steps (playback and the live minute tick)", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useUpdatedCue(value), { initialProps: { value: 1140 } });
    for (let minute = 1141; minute < 1146; minute += 1) {
      act(() => {
        vi.advanceTimersByTime(100);
      });
      rerender({ value: minute });
      expect(result.current).toBe(false);
    }
  });

  it("turns off when the value keeps changing quickly (slider drag)", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useUpdatedCue(value), { initialProps: { value: 600 } });
    rerender({ value: 660 });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(CONTINUOUS_GAP_MS - 1);
    });
    rerender({ value: 720 });
    expect(result.current).toBe(false);
  });
});

describe("isDiscreteJump", () => {
  it("treats the midnight wrap as a one-minute step", () => {
    expect(isDiscreteJump(1439, 0, Infinity)).toBe(false);
    expect(isDiscreteJump(1439, 600, Infinity)).toBe(true);
  });
});

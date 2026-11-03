/* @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UPDATED_CUE_MS, useUpdatedCue } from "./useUpdatedCue.mjs";

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
});

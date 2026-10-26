/* @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Spinner } from "./Spinner.jsx";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Spinner", () => {
  it("stays hidden until delayMs and then names the operation", () => {
    render(<Spinner label="KMA 예보 가져오는 중" />);
    act(() => vi.advanceTimersByTime(999));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status").textContent).toBe("KMA 예보 가져오는 중");
  });

  it("never renders when the operation ends before delayMs", () => {
    const { unmount, container } = render(<Spinner label="미기후 계산 중" />);
    act(() => vi.advanceTimersByTime(999));
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(container.innerHTML).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours a custom delay", () => {
    render(<Spinner label="교통 시뮬레이션 연결 중" delayMs={2000} />);
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("status")).toBeTruthy();
  });
});

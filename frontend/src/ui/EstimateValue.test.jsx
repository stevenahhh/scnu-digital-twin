/* @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EstimateValue } from "./EstimateValue.jsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EstimateValue", () => {
  it("labels an estimate 추정 with unit and a one-dot provenance line", () => {
    const { container } = render(<EstimateValue value={24.3} digits={1} unit="°C" source="KMA 초단기실황" at="2026-10-26T00:40:00Z" />);
    const root = container.querySelector("[data-qa=estimate-value]");
    expect(root.dataset.estimated).toBe("true");
    expect(screen.getByText("24.3").className).toContain("tabular-nums");
    expect(screen.getByText("°C")).toBeTruthy();
    expect(screen.getByText("추정")).toBeTruthy();
    expect(screen.getByText("KMA 초단기실황 · 09:40")).toBeTruthy();
  });

  it("renders a measured value without the 추정 badge", () => {
    const { container } = render(<EstimateValue value={12} unit="대" estimated={false} source="정문 카메라" />);
    expect(container.querySelector("[data-qa=measured-value]")).toBeTruthy();
    expect(container.querySelector("[data-qa=estimate-value]")).toBeNull();
    expect(screen.queryByText("추정")).toBeNull();
  });

  it("renders 데이터 없음 and the action instead of a placeholder when the value is absent", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { container } = render(<EstimateValue value={undefined} unit="°C" onAction={onAction} />);
    expect(screen.getByText("데이터 없음")).toBeTruthy();
    expect(screen.queryByText("°C")).toBeNull();
    expect(container.textContent).not.toMatch(/(^|\s)-(\s|°|$)/);
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("highlights a changed value for 200ms and announces 갱신됨", () => {
    vi.useFakeTimers();
    const { rerender } = render(<EstimateValue value={24.3} unit="°C" />);
    expect(screen.getByText("24.3").className).not.toContain("bg-surface-3");
    rerender(<EstimateValue value={24.8} unit="°C" />);
    expect(screen.getByText("24.8").className).toContain("bg-surface-3");
    expect(screen.getByText("갱신됨").getAttribute("aria-live")).toBe("polite");
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText("24.8").className).not.toContain("bg-surface-3");
  });
});

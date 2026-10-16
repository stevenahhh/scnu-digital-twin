/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelErrorBoundary } from "./PanelErrorBoundary.jsx";

afterEach(cleanup);

function ThrowingChild() {
  throw new Error("child failed");
}

describe("PanelErrorBoundary", () => {
  it("renders the fallback when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <PanelErrorBoundary label="Weather">
        <ThrowingChild />
      </PanelErrorBoundary>,
    );

    expect(screen.getByRole("alert").textContent).toContain("이 영역을 표시하는 중 문제가 발생했습니다");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("retries with a healthy child and supports a custom message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <PanelErrorBoundary label="Canvas" message="3D 캠퍼스 모델을 불러오지 못했습니다">
        <ThrowingChild />
      </PanelErrorBoundary>,
    );

    expect(screen.getByRole("alert").textContent).toContain("3D 캠퍼스 모델을 불러오지 못했습니다");
    rerender(
      <PanelErrorBoundary label="Canvas" message="3D 캠퍼스 모델을 불러오지 못했습니다">
        <span>healthy child</span>
      </PanelErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(screen.getByText("healthy child")).toBeTruthy();
    vi.restoreAllMocks();
  });
});

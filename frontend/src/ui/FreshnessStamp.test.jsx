/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FreshnessStamp } from "./FreshnessStamp.jsx";

afterEach(cleanup);

describe("FreshnessStamp", () => {
  it("shows 갱신 HH:mm with the feed hook and a named refresh button", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const { container } = render(<FreshnessStamp at="2026-10-26T00:40:00Z" feed="weather" feedLabel="기상 데이터" onRefresh={onRefresh} />);
    const stamp = container.querySelector("[data-qa=freshness-stamp]");
    expect(stamp.dataset.feed).toBe("weather");
    expect(screen.getByText("갱신 09:40")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "기상 데이터 새로고침" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("says 갱신 없음 when nothing has arrived yet and still offers the refresh", () => {
    render(<FreshnessStamp at={null} feed="traffic" feedLabel="교통" onRefresh={vi.fn()} />);
    expect(screen.getByText("갱신 없음")).toBeTruthy();
    expect(screen.getByRole("button", { name: "교통 새로고침" })).toBeTruthy();
  });

  it("marks the refresh busy while refreshing", () => {
    render(<FreshnessStamp at="2026-10-26T00:40:00Z" feed="energy" onRefresh={vi.fn()} refreshing />);
    expect(screen.getByRole("button", { name: "데이터 새로고침" }).getAttribute("aria-busy")).toBe("true");
  });
});

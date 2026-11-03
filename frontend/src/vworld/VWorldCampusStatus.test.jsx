/* @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VWorldCampusStatus } from "./VWorldCampusStatus.jsx";

afterEach(cleanup);

const client = {
  load: async () => ({
    ranked: [{ buildingId: "D4", buildingName: "D4 / 공대 3호관", buildingStatus: "simulated" }],
    excluded: [{ buildingId: "C1", buildingName: "C1 / 도서관", buildingStatus: "incomplete" }],
  }),
};

describe("VWorldCampusStatus", () => {
  it("leaves placement to the host and keeps only the classes it is given", () => {
    const { container } = render(<VWorldCampusStatus client={client} onSelection={() => {}} className="w-full" />);
    const aside = container.querySelector('[data-qa="vworld-campus-status"]');
    expect(aside.className).toMatch(/\bw-full\b/);
    expect(aside.className).not.toMatch(/\babsolute\b|bottom-20|left-6|\bhidden\b|max-w-\[280px\]/);
  });

  it("shows status as text badges and the selected building with the selection style", async () => {
    const onSelection = vi.fn();
    render(<VWorldCampusStatus client={client} onSelection={onSelection} selectedBuildingId="D4" />);
    const selected = await screen.findByRole("button", { name: "D4 / 공대 3호관 완료 시나리오 열기" });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.className).toMatch(/\bbg-surface-2\b/);
    expect(screen.getByText("불완전").dataset.tone).toBe("warning");
    expect(screen.getByText("시뮬레이션 기준일 5월 18일")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "C1 / 도서관 불완전 시나리오 열기" }));
    expect(onSelection).toHaveBeenCalledWith({ elementId: "BLD_C1", buildingId: "C1", displayName: "C1 / 도서관" });
  });

  it("waits quietly while the energy feed is down and reports a failure only when the feed is up", async () => {
    const failing = { load: async () => { throw new Error("down"); } };
    const { unmount } = render(<VWorldCampusStatus client={failing} onSelection={() => {}} feedDown />);
    expect((await screen.findByText(/에너지 연결을 기다리는 중/)).getAttribute("role")).toBe("status");
    expect(screen.queryByText(/못했습니다/)).toBeNull();
    unmount();
    render(<VWorldCampusStatus client={failing} onSelection={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("연결하지 못했습니다");
  });
});

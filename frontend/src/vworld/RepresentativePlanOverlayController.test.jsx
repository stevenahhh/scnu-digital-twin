/* @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepresentativePlanOverlayController } from "./RepresentativePlanOverlayController.jsx";

const overlay = { buildingId: "D4", installationPlanId: "plan-1", coordinateSystem: "roof-local-meters", arrays: [] };
const deferred = () => {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
};
afterEach(cleanup);

describe("RepresentativePlanOverlayController", () => {
  it("publishes roof-local representative data and clears it while the panel layer is hidden", async () => {
    const user = userEvent.setup();
    const loadOverlays = vi.fn().mockResolvedValue([overlay]);
    const onOverlayDataChange = vi.fn();
    render(<RepresentativePlanOverlayController buildingIds={["D4"]} loadOverlays={loadOverlays} onOverlayDataChange={onOverlayDataChange} />);
    await waitFor(() => expect(onOverlayDataChange).toHaveBeenCalledWith([overlay]));
    expect(screen.getByRole("button", { name: "대표 설치 계획 숨기기" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "대표 설치 계획 숨기기" }));
    expect(onOverlayDataChange).toHaveBeenLastCalledWith([]);
    await user.click(screen.getByRole("button", { name: "대표 설치 계획 표시하기" }));
    expect(onOverlayDataChange).toHaveBeenLastCalledWith([overlay]);
  });

  it("can publish the map layer without rendering the left control panel", async () => {
    const onOverlayDataChange = vi.fn();
    render(
      <RepresentativePlanOverlayController
        buildingIds={["D4"]}
        loadOverlays={vi.fn().mockResolvedValue([overlay])}
        onOverlayDataChange={onOverlayDataChange}
        renderPanel={false}
      />,
    );

    await waitFor(() => expect(onOverlayDataChange).toHaveBeenCalledWith([overlay]));
    expect(screen.queryByRole("button", { name: "대표 설치 계획 숨기기" })).toBeNull();
  });

  it("does not republish a pending result after the layer is hidden", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onOverlayDataChange = vi.fn();
    render(<RepresentativePlanOverlayController buildingIds={["D4"]} loadOverlays={() => pending.promise} onOverlayDataChange={onOverlayDataChange} />);
    await user.click(screen.getByRole("button", { name: "대표 설치 계획 숨기기" }));
    pending.resolve([overlay]);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(onOverlayDataChange).not.toHaveBeenLastCalledWith([overlay]);
    expect(onOverlayDataChange).toHaveBeenLastCalledWith([]);
  });

  it("reloads representative-only data when selection changes", async () => {
    const loadOverlays = vi.fn()
      .mockResolvedValueOnce([overlay])
      .mockResolvedValueOnce([]);
    const onOverlayDataChange = vi.fn();
    const view = render(<RepresentativePlanOverlayController buildingIds={["D4"]} refreshKey={0} loadOverlays={loadOverlays} onOverlayDataChange={onOverlayDataChange} />);
    await waitFor(() => expect(onOverlayDataChange).toHaveBeenLastCalledWith([overlay]));
    view.rerender(<RepresentativePlanOverlayController buildingIds={["D4"]} refreshKey={1} loadOverlays={loadOverlays} onOverlayDataChange={onOverlayDataChange} />);
    await waitFor(() => expect(loadOverlays).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onOverlayDataChange).toHaveBeenLastCalledWith([]));
  });

  it("renders only the layer toggle: building plans live in the 캠퍼스 비교 table", async () => {
    const onOverlayDataChange = vi.fn();
    render(<RepresentativePlanOverlayController buildingIds={["D3", "D4"]} loadOverlays={vi.fn().mockResolvedValue([overlay])} onOverlayDataChange={onOverlayDataChange} />);
    await waitFor(() => expect(onOverlayDataChange).toHaveBeenCalledWith([overlay]));
    expect(screen.getByRole("group", { name: "대표 설치 계획 지도 레이어" })).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: /상세 분석/ })).toBeNull();
  });

  it("shows no spinner while loading (MOT-12)", () => {
    render(<RepresentativePlanOverlayController buildingIds={["D4"]} loadOverlays={() => new Promise(() => {})} onOverlayDataChange={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("불러오는 중");
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("reports loading failures without publishing stale data", async () => {
    const onOverlayDataChange = vi.fn();
    render(<RepresentativePlanOverlayController buildingIds={["D4"]} loadOverlays={vi.fn().mockRejectedValue(new Error("대표안 조회 실패"))} onOverlayDataChange={onOverlayDataChange} />);
    expect((await screen.findByRole("alert")).textContent).toContain("요청을 처리하지 못했습니다");
    expect(onOverlayDataChange).toHaveBeenCalledWith([]);
  });
  it("leaves the alert and retry to the energy feed row while that feed is down, and reloads when it comes back", async () => {
    const loadOverlays = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const view = render(<RepresentativePlanOverlayController buildingIds={["D4"]} loadOverlays={loadOverlays} feedDown />);
    await waitFor(() => expect(document.querySelector('[data-qa="overlay-feed-deferred"]')).not.toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
    const calls = loadOverlays.mock.calls.length;
    view.rerender(<RepresentativePlanOverlayController buildingIds={["D4"]} loadOverlays={loadOverlays} feedDown={false} />);
    await waitFor(() => expect(loadOverlays.mock.calls.length).toBe(calls + 1));
    await waitFor(() => expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy());
  });

});

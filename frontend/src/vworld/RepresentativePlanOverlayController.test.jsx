/* @vitest-environment jsdom */
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

  it("shows each representative plan name and installed kWp while preserving status-only non-D4 buildings", async () => {
    const user = userEvent.setup();
    const d3Overlay = { ...overlay, buildingId: "D3", installationPlanId: "plan-d3", name: "D3 남측 대표안", installedCapacityKwp: 7.056, arrays: [{ id: "array-d3" }] };
    const d4Overlay = { ...overlay, name: "D4 기준 대표안", installedCapacityKwp: 13.056, arrays: [{ id: "array-d4" }, { id: "array-d4-east" }] };
    const onBuildingSelect = vi.fn();
    render(<RepresentativePlanOverlayController buildingIds={["D3", "D4", "D2"]} loadOverlays={vi.fn().mockResolvedValue([d3Overlay, d4Overlay])} onOverlayDataChange={vi.fn()} onBuildingSelect={onBuildingSelect} />);

    expect(await screen.findByText("D3 남측 대표안")).toBeTruthy();
    expect(screen.getByText("7.056 kWp · 1개 배열 · 검증된 지도 좌표 없음")).toBeTruthy();
    expect(screen.getByText("D4 기준 대표안")).toBeTruthy();
    expect(screen.getByText("13.056 kWp · 2개 배열 · 지도 표시 가능")).toBeTruthy();
    expect(screen.getByText("대표 설치안 미지정")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "D3 상세 분석 보기" }));
    expect(onBuildingSelect).toHaveBeenCalledWith("D3");
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

  it("lets only the plan list scroll inside a height-bounded column (phone), so the card shrinks instead of covering the HUD", async () => {
    const view = render(<RepresentativePlanOverlayController buildingIds={["D4"]} loadOverlays={vi.fn().mockResolvedValue([overlay])} onOverlayDataChange={vi.fn()} fitHeight />);
    const list = await screen.findByRole("list", { name: "건물별 대표 설치 계획 상태" });
    expect(list.className).toMatch(/\boverflow-y-auto\b/);
    expect(list.closest("aside").className).toMatch(/\bmin-h-0\b/);
    view.unmount();
    render(<RepresentativePlanOverlayController buildingIds={["D4"]} loadOverlays={vi.fn().mockResolvedValue([overlay])} onOverlayDataChange={vi.fn()} />);
    expect((await screen.findByRole("list", { name: "건물별 대표 설치 계획 상태" })).className).not.toMatch(/overflow-y-auto/);
  });
});

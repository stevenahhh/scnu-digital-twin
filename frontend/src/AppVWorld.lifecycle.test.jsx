/* @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let resolveRepresentative;
const representativeLoad = new Promise((resolve) => { resolveRepresentative = resolve; });
const installationClient = {
  listDetails: vi.fn().mockResolvedValue([]),
  getRepresentative: vi.fn().mockReturnValue(representativeLoad),
};

vi.mock("./features/energy/installations/installationPlanApi.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createInstallationPlanClient: () => installationClient };
});
vi.mock("./vworld/VWorldRenderer", () => ({
  default: ({ onSelection, onRepresentativeInstallationPlanChange, onD4SectionChange, overlaysCovered, overlayInsetRight, mapBackdrop }) => <div data-testid="vworld-renderer" data-overlays-covered={String(Boolean(overlaysCovered))} data-overlay-inset-right={overlayInsetRight}>
    {mapBackdrop}
    <button type="button" onClick={() => onSelection({ elementId: "BLD_D4", buildingId: "D4", displayName: "D4" })}>D4 선택</button>
    <button type="button" onClick={() => onRepresentativeInstallationPlanChange({ buildingId: "D4", installationPlanId: "plan-new" })}>새 대표 선택</button>
    <button type="button" onClick={() => { onSelection({ elementId: "BLD_D4", buildingId: "D4", displayName: "D4" }); onD4SectionChange(true); }}>D4 상세 열기</button>
    <button type="button" onClick={() => onD4SectionChange(false)}>D4 상세 닫기</button>
  </div>,
}));
vi.mock("./features/energy/analysis", () => ({ BuildingAnalysis: ({ representativePlanId }) => <div data-testid="app-representative">{representativePlanId ?? "none"}</div> }));
vi.mock("./features/energy/dashboard/EnergyDashboard", () => ({ EnergyDashboard: () => null }));
vi.mock("./features/energy/campus/CampusComparisonPanel", () => ({ CampusComparison: () => null }));

import App from "./AppVWorld.jsx";

beforeEach(() => {
  // 패널을 열어 둔 채 떠난 재방문 사용자. 첫 방문(레일로 시작)은 panel/DashboardShell.test.jsx가 다룬다.
  vi.stubGlobal("localStorage", { getItem: (key) => (key === "scnu.panelOpen" ? "true" : null), setItem() {} });
  vi.stubGlobal("fetch", vi.fn(async (url) => String(url).includes("/popup")
    ? { ok: false, status: 404, json: async () => null }
    : { ok: true, status: 200, json: async () => ({ base_weather: { temperature: 20 }, weather_timeline: [] }) }));
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const phoneMatchMedia = vi.fn((query) => ({ matches: query === "(max-width: 639px)" || query === "(max-width: 1023px)", addEventListener() {}, removeEventListener() {} }));

describe("AppVWorld installation selection lifecycle", () => {
  it("does not let an older same-building representative load overwrite a newer selection", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "D4 선택" }));
    // 선택은 탭을 바꾸지 않는다. 사용자가 에너지 탭을 연다.
    expect(screen.getByRole("tab", { name: "기본 현황" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "에너지" }));
    await user.click(screen.getByRole("button", { name: "새 대표 선택" }));
    expect((await screen.findByTestId("app-representative")).textContent).toBe("plan-new");

    await act(async () => { resolveRepresentative({ buildingId: "D4", installationPlanId: "plan-old" }); });
    expect(screen.getByTestId("app-representative").textContent).toBe("plan-new");
  });

  it("holds the selection inspector while the D4 detail experience is open and shows it after the experience closes", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("button", { name: "D4 상세 열기" }));
    expect(container.querySelector('[data-qa="selection-inspector"]')).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "D4 상세 닫기" }));
    expect(await screen.findByRole("region", { name: "선택한 건물 D4" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the 기본 현황 tab and its scrollTop when returning from the D4 section (VWorld)", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const scroller = () => container.querySelector('[data-qa="panel-scroll"]');
    scroller().scrollTop = 300;
    await user.click(screen.getByRole("button", { name: "D4 상세 열기" }));
    await user.click(screen.getByRole("button", { name: "D4 상세 닫기" }));
    expect(screen.getByRole("tab", { name: "기본 현황" }).getAttribute("aria-selected")).toBe("true");
    // 패널 내용은 다시 그려지고, 스크롤은 다음 화면 갱신에서 되돌린다.
    await waitFor(() => expect(Math.abs(scroller().scrollTop - 300)).toBeLessThanOrEqual(8));
  });

  it("keeps the map overlays full width and interactive above the phone bottom sheet", async () => {
    window.matchMedia = phoneMatchMedia;
    const user = userEvent.setup();
    const { container } = render(<App />);
    const renderer = screen.getByTestId("vworld-renderer");
    const sheet = container.querySelector('[data-qa="dashboard-panel"]');
    expect(sheet.dataset.detent).toBe("peek");
    expect(renderer.dataset.overlayInsetRight).toBe("0px");
    expect(renderer.dataset.overlaysCovered).toBe("false");

    await user.click(screen.getByRole("button", { name: "패널 열기" }));
    expect(sheet.dataset.detent).toBe("half");
    expect(renderer.dataset.overlaysCovered).toBe("false");
  });

  it("keeps the map overlays inside the map area left of the open panel", async () => {
    const user = userEvent.setup();
    render(<App />);
    const renderer = screen.getByTestId("vworld-renderer");
    expect(renderer.dataset.overlayInsetRight).toBe("var(--dashboard-panel-width)");

    await user.click(screen.getByRole("button", { name: "패널 닫기" }));
    expect(renderer.dataset.overlayInsetRight).toBe("var(--dashboard-rail-width)");

    await user.click(screen.getByRole("button", { name: "패널 열기" }));
    expect(renderer.dataset.overlayInsetRight).toBe("var(--dashboard-panel-width)");

    // 폰 폭에서는 패널이 바텀 시트라 지도 오버레이가 화면 폭 전체를 쓴다.
    window.matchMedia = phoneMatchMedia;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(renderer.dataset.overlayInsetRight).toBe("0px");
  });

  it("hands the night tint to the map renderer, which draws it under the map controls", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const renderer = screen.getByTestId("vworld-renderer");
    const tint = container.querySelector("#vworld-available-area");
    expect(renderer.contains(tint)).toBe(true);
    expect(tint.style.right).toBe("var(--dashboard-panel-width)");

    await user.click(screen.getByRole("button", { name: "패널 닫기" }));
    expect(tint.style.right).toBe("var(--dashboard-rail-width)");
  });

  it("turns the panel into the D4 pane beside the rail while the D4 detail is open and restores the panel after it closes", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const panel = () => container.querySelector('[data-qa="dashboard-panel"]');

    expect(screen.getByRole("button", { name: "패널 닫기" })).toBeTruthy();
    expect(panel().hasAttribute("aria-hidden")).toBe(false);
    expect(panel().hasAttribute("inert")).toBe(false);

    await user.click(screen.getByRole("button", { name: "D4 상세 열기" }));
    expect(screen.queryByRole("button", { name: "패널 닫기" })).toBeNull();
    // 패널 자리는 D4 패인(레일 왼쪽)이 되고, 레일의 탭 넷은 그대로 보인다.
    expect(panel().dataset.pane).toBe("d4");
    expect(screen.getByRole("navigation", { name: "대시보드 레일" })).toBeTruthy();
    expect(screen.getByTestId("vworld-renderer").dataset.overlayInsetRight).toBe("calc(min(720px, 50vw) + var(--dashboard-rail-width))");

    await user.click(screen.getByRole("button", { name: "D4 상세 닫기" }));
    expect(screen.getByRole("button", { name: "패널 닫기" })).toBeTruthy();
    expect(panel().hasAttribute("aria-hidden")).toBe(false);
    expect(panel().hasAttribute("inert")).toBe(false);
  });
});

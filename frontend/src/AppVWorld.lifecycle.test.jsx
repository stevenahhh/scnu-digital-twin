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
vi.mock("./features/energy/dashboard/EnergyDashboard", () => ({
  EnergyDashboard: ({ buildingId }) => <div data-testid="building-energy-dashboard">{buildingId} 전력 현황</div>,
}));
vi.mock("./features/energy/campus/CampusComparisonPanel", () => ({
  CampusComparison: () => <div data-testid="campus-comparison">캠퍼스 비교</div>,
}));

vi.mock("./vworld/VWorldCampusStatus", () => ({ VWorldCampusStatus: () => <div>캠퍼스 설치 현황</div> }));

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
  // 대시보드가 화면 상태를 주소에 쓴다(useUrlState): 다음 테스트가 그 주소로 시작하지 않게 되돌린다.
  window.history.replaceState(null, "", "/");
  cleanup();
  vi.unstubAllGlobals();
});

const phoneMatchMedia = vi.fn((query) => ({ matches: query === "(max-width: 639px)" || query === "(max-width: 1023px)", addEventListener() {}, removeEventListener() {} }));

describe("AppVWorld installation selection lifecycle", () => {
  it("shows selected building energy before analysis when the energy tab opens", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "패널 닫기" }));
    expect(await screen.findByRole("navigation", { name: "대시보드 레일" })).toBeTruthy();

    // D4는 D4 상세(패인)로 열리므로 고르기만 해서는 패널을 열지 않는다. 레일의 현황 아이콘으로 연다.
    await user.click(screen.getByRole("button", { name: "D4 선택" }));
    await user.click(screen.getByRole("button", { name: "현황" }));
    expect(screen.getByRole("tab", { name: "현황" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "에너지" }));

    expect(screen.getByRole("button", { name: "패널 닫기" })).toBeTruthy();
    // 탭을 바꿔도 패널 폭은 같다.
    expect(document.querySelector(".dashboard-root")?.classList.contains("dashboard-root--building-focus")).toBe(false);
    const region = screen.getByRole("region", { name: "D4 건물 전력 현황" });
    const dashboard = screen.getByTestId("building-energy-dashboard");
    const analysis = screen.getByTestId("app-representative");
    const comparison = screen.getByTestId("campus-comparison");
    expect(region.contains(dashboard)).toBe(true);
    expect(region.compareDocumentPosition(analysis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(analysis.compareDocumentPosition(comparison) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "건물" }));
    await user.click(screen.getByRole("button", { name: "닫기", exact: true }));
    expect(document.querySelector(".dashboard-root")?.classList.contains("dashboard-root--building-focus")).toBe(false);
  });

  it("does not let an older same-building representative load overwrite a newer selection", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "D4 선택" }));
    // D4 선택은 탭을 바꾸지 않는다(D4 상세가 따로 열린다). 사용자가 에너지 탭을 연다.
    expect(screen.getByRole("tab", { name: "현황" }).getAttribute("aria-selected")).toBe("true");
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
    // 나오면 들어가기 전 탭으로 돌아오고, 고른 D4는 건물 탭의 인스펙터에 `실내 보기`와 함께 있다.
    await user.click(screen.getByRole("tab", { name: "건물" }));
    expect(await screen.findByRole("region", { name: "선택한 건물 D4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "실내 보기" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the 현황 tab and its scrollTop when returning from the D4 section (VWorld)", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const scroller = () => container.querySelector('[data-qa="panel-scroll"]');
    scroller().scrollTop = 300;
    await user.click(screen.getByRole("button", { name: "D4 상세 열기" }));
    await user.click(screen.getByRole("button", { name: "D4 상세 닫기" }));
    expect(screen.getByRole("tab", { name: "현황" }).getAttribute("aria-selected")).toBe("true");
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

    // 닫히는 패널은 다 닫힌 뒤(300 ms)에 자리를 내준다.
    await user.click(screen.getByRole("button", { name: "패널 닫기" }));
    await waitFor(() => expect(renderer.dataset.overlayInsetRight).toBe("var(--dashboard-rail-width)"));

    await user.click(screen.getByRole("button", { name: "현황" }));
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
    await waitFor(() => expect(tint.style.right).toBe("var(--dashboard-rail-width)"));
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
    // 패널 자리는 D4 패인(레일 왼쪽)이 되고, 레일의 탭 아이콘은 그대로 보인다.
    expect(panel().dataset.pane).toBe("d4");
    expect(screen.getByRole("navigation", { name: "대시보드 레일" })).toBeTruthy();
    expect(screen.getByTestId("vworld-renderer").dataset.overlayInsetRight).toBe("calc(var(--dashboard-pane-width) + var(--dashboard-rail-width))");

    await user.click(screen.getByRole("button", { name: "D4 상세 닫기" }));
    expect(screen.getByRole("button", { name: "패널 닫기" })).toBeTruthy();
    expect(panel().hasAttribute("aria-hidden")).toBe(false);
    expect(panel().hasAttribute("inert")).toBe(false);
  });
});

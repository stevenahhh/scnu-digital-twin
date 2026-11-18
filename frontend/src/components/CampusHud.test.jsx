/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampusHud } from "./CampusHud.jsx";

afterEach(cleanup);

const clock = {
  sceneMinuteOfDay: 19 * 60, setSceneMinuteOfDay: vi.fn(), sceneDate: "2026-10-25", setSceneDate: vi.fn(), snapToNow: vi.fn(), isLiveMode: false,
};
const mainCamera = () => ({
  controlsRef: { current: null }, activePresetId: "overview", selectPreset: vi.fn(), goHome: vi.fn(), touring: false, toggleTour: vi.fn(),
});

const renderHud = (props = {}) => render(
  <CampusHud insetRight="56px" camera={mainCamera()} clock={clock} playing={false} onPlayingChange={vi.fn()} onTogglePresentation={vi.fn()} {...props} />,
);

describe("CampusHud", () => {
  it("puts one bar with the 시점 menu and the more menu, and keeps the scene time in the time card only", () => {
    renderHud({ moreMenu: <button type="button" data-qa="more-menu">더보기</button>, statusSlot: <span data-qa="freshness-stamp">갱신 19:00</span> });
    const hud = document.querySelector('[data-qa="campus-hud"]');
    const bar = within(hud.querySelector('[data-qa="hud-bar"]'));
    expect(bar.getByRole("button", { name: /시점/ })).toBeTruthy();
    expect(bar.getByRole("button", { name: "더보기" })).toBeTruthy();
    expect(hud.querySelector('[data-qa="freshness-stamp"]')).toBeNull();
    expect(hud.querySelector('[data-qa="hud-time-readout"]')).toBeNull();
    for (const name of ["발표 모드", "투어 시작", "전체", "처음 시점"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(hud.textContent.match(/19:00/g)).toHaveLength(1);
  });

  it("shows the school name once as plain scene text, with no status box or retry control in the HUD", () => {
    renderHud();
    const brand = screen.getByRole("img", { name: "국립순천대학교 디지털 트윈" });
    expect(brand.textContent).toBe("국립순천대학교 디지털 트윈");
    expect(brand.closest("h1").className).toContain("left-1/2");
    expect(brand.closest("h1").className).not.toMatch(/\bbg-/);
    expect(screen.queryByRole("button", { name: /연결 끊김|새로고침|다시 시도/ })).toBeNull();
  });

  // Phone: the search field gets about 80 px beside the 시점, chip and more buttons; the long example placeholder was cut mid-word.
  it("uses the short search placeholder on the phone and keeps the example placeholder on the desktop", () => {
    const search = { registry: [], onPick: vi.fn() };
    const { unmount } = renderHud({ search });
    expect(screen.getByRole("combobox", { name: "건물 검색" }).getAttribute("placeholder")).toBe("건물 이름, 코드 (예: 도서관, D4)");
    unmount();
    renderHud({ search, mode: "phone" });
    expect(screen.getByRole("combobox", { name: "건물 검색" }).getAttribute("placeholder")).toBe("건물 검색");
  });

  // Phone presentation: the read-only time, 투어 시작 and 발표 모드 끝내기 do not fit one 358 px row; the labels broke onto two lines.
  it("keeps every presentation label on one line and lets the phone row wrap instead", () => {
    const { unmount } = renderHud({ presenting: true, mode: "phone" });
    const classes = (el) => el.className.split(/\s+/);
    expect(classes(document.querySelector('[data-qa="hud-bar"]'))).toContain("flex-wrap");
    for (const el of [
      document.querySelector('[data-qa="hud-time-readout"]'),
      screen.getByRole("button", { name: /투어 시작/ }),
      screen.getByRole("button", { name: /발표 모드 끝내기/ }),
    ]) expect(classes(el)).toContain("whitespace-nowrap");
    unmount();
    renderHud({ presenting: true });
    expect(classes(document.querySelector('[data-qa="hud-bar"]'))).not.toContain("flex-wrap");
  });

  it("mounts the VWorld camera through zoomBy and rotateBy and hides camera tools until it is ready", () => {
    const zoomBy = vi.fn();
    const camera = { ...mainCamera(), controlsRef: undefined, zoomBy, rotateBy: vi.fn(), ready: true };
    const { rerender } = renderHud({ camera });
    fireEvent.click(screen.getByRole("button", { name: "확대" }));
    expect(zoomBy).toHaveBeenCalledTimes(1);
    rerender(<CampusHud insetRight="56px" camera={{ ...camera, ready: false }} clock={clock} playing={false} onPlayingChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "확대" })).toBeNull();
    expect(screen.queryByRole("button", { name: /시점/ })).toBeNull();
  });

  it("leaves only the read-only time, the tour toggle and 발표 모드 끝내기 in presentation mode", () => {
    renderHud({ presenting: true, insetRight: "0px" });
    const hud = document.querySelector('[data-qa="campus-hud"]');
    expect(hud.dataset.presenting).toBe("true");
    expect(within(hud).getAllByRole("button").map((button) => button.textContent)).toEqual(["투어 시작", "발표 모드 끝내기"]);
    expect(hud.querySelector('[data-qa="hud-time-readout"]').textContent).toBe("장면 19:00");
    expect(hud.querySelector('[data-qa="time-slider"]')).toBeNull();
  });

  it("opts the HUD root out of the global reduced-motion transition so its right edge reaches the panel in the same frame", () => {
    // index.css clamps every element to transition-duration 0.01ms under prefers-reduced-motion. With the default
    // transition-property (all) that turns the root's untransitioned \`right\` into a 0.01ms transition, and the HUD
    // keeps its old edge until the next frame while the panel has already snapped open (IS-34 under reduced motion).
    renderHud();
    const hud = document.querySelector('[data-qa="campus-hud"]');
    expect(hud.className.split(/\s+/)).toContain("motion-reduce:transition-none");
  });

  it("never transitions the HUD root (no default transition-property all) in either layout", () => {
    // The root only changes right/bottom, which must not animate (V-F-68); the right-hand group moves by transform.
    for (const presenting of [false, true]) {
      const { unmount } = renderHud({ presenting });
      const hud = document.querySelector('[data-qa="campus-hud"]');
      expect(hud.className.split(/\s+/)).toContain("transition-none");
      unmount();
    }
  });
});

/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampusHud } from "./CampusHud.jsx";

afterEach(cleanup);

const clock = {
  sceneMinuteOfDay: 19 * 60, setSceneMinuteOfDay: vi.fn(), sceneDate: "2026-10-25", setSceneDate: vi.fn(), snapToNow: vi.fn(), isLiveMode: false,
};
const legacyCamera = () => ({
  controlsRef: { current: null }, activePresetId: "overview", selectPreset: vi.fn(), goHome: vi.fn(), touring: false, toggleTour: vi.fn(),
});

const renderHud = (props = {}) => render(
  <CampusHud insetRight="56px" camera={legacyCamera()} clock={clock} playing={false} onPlayingChange={vi.fn()} onTogglePresentation={vi.fn()} {...props} />,
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

  it("shows one status chip with the count only while a feed is down, and it opens the status tab", () => {
    const onOpenStatus = vi.fn();
    const { rerender } = renderHud({ feedIssueCount: 0, onOpenStatus });
    expect(document.querySelector('[data-qa="feed-status-chip"]')).toBeNull();
    rerender(
      <CampusHud insetRight="56px" camera={legacyCamera()} clock={clock} playing={false} onPlayingChange={vi.fn()} feedIssueCount={3} onOpenStatus={onOpenStatus} />,
    );
    const chip = document.querySelector('[data-qa="feed-status-chip"]');
    expect(chip.textContent).toContain("3");
    // A status element: its warning hue is status colour, not a second accent (V-Q-10).
    expect(chip.dataset.status).toBe("warning");
    expect(screen.queryByRole("button", { name: /새로고침|다시 시도/ })).toBeNull();
    fireEvent.click(chip);
    expect(onOpenStatus).toHaveBeenCalledTimes(1);
  });

  it("mounts the VWorld camera through zoomBy and rotateBy and hides camera tools until it is ready", () => {
    const zoomBy = vi.fn();
    const camera = { ...legacyCamera(), controlsRef: undefined, zoomBy, rotateBy: vi.fn(), ready: true };
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

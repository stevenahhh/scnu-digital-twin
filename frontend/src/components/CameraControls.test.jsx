/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { CameraControls } from "./CameraControls.jsx";

afterEach(cleanup);

function fakeControls() {
  return { object: { position: new Vector3(0, 100, 100) }, target: new Vector3(0, 0, 0), update: vi.fn(), dispatchEvent: vi.fn() };
}

const NAMES = ["확대", "축소", "왼쪽으로 회전", "오른쪽으로 회전", "전체 보기"];

describe("CameraControls", () => {
  it("offers five labelled icon buttons that zoom, rotate and show the whole campus", () => {
    const controls = fakeControls();
    const onHome = vi.fn();
    render(<CameraControls controlsRef={{ current: controls }} onHome={onHome} />);
    const group = screen.getByRole("group", { name: "카메라 조작" });
    expect(group.dataset.qa).toBe("camera-controls");
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(NAMES);
    const distance = () => controls.object.position.distanceTo(controls.target);
    const start = distance();

    fireEvent.click(screen.getByRole("button", { name: "확대" }));
    expect(distance()).toBeLessThan(start);
    fireEvent.click(screen.getByRole("button", { name: "축소" }));
    expect(distance()).toBeCloseTo(start, 6);
    fireEvent.click(screen.getByRole("button", { name: "왼쪽으로 회전" }));
    expect(controls.object.position.x).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "오른쪽으로 회전" }));
    expect(controls.object.position.x).toBeCloseTo(0, 6);
    fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(controls.update).toHaveBeenCalledTimes(4);
  });

  it("names the matching map key in each tooltip", () => {
    render(<CameraControls controlsRef={{ current: fakeControls() }} onHome={() => {}} />);
    const home = screen.getByRole("button", { name: "전체 보기" });
    expect(home.getAttribute("title")).toBe("전체 보기 (H)");
    expect(home.getAttribute("aria-keyshortcuts")).toBe("H");
    expect(screen.getByRole("button", { name: "왼쪽으로 회전" }).getAttribute("aria-keyshortcuts")).toBe("ArrowLeft");
  });

  it("moves a VWorld camera through onZoom and onRotate", () => {
    const onZoom = vi.fn();
    const onRotate = vi.fn();
    render(<CameraControls onZoom={onZoom} onRotate={onRotate} onHome={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "확대" }));
    fireEvent.click(screen.getByRole("button", { name: "오른쪽으로 회전" }));
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onRotate).toHaveBeenCalledTimes(1);
  });

  it("does nothing before the controls exist", () => {
    render(<CameraControls controlsRef={{ current: null }} onHome={() => {}} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "확대" }))).not.toThrow();
  });

  it("collapses behind one 카메라 조작 toggle on the phone and closes when the map is touched", () => {
    render(<CameraControls controlsRef={{ current: fakeControls() }} onHome={() => {}} collapsible />);
    const toggle = screen.getByRole("button", { name: "카메라 조작" });
    expect(screen.queryByRole("button", { name: "확대" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(NAMES.every((name) => screen.getByRole("button", { name }))).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "확대" })).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

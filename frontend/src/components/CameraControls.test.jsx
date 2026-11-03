/* @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { CameraControls } from "./CameraControls.jsx";

afterEach(cleanup);

function fakeControls() {
  return { object: { position: new Vector3(0, 100, 100) }, target: new Vector3(0, 0, 0), update: vi.fn(), dispatchEvent: vi.fn() };
}

describe("CameraControls", () => {
  it("offers five labelled icon buttons that zoom, rotate and go home", () => {
    const controls = fakeControls();
    const onHome = vi.fn();
    render(<CameraControls controlsRef={{ current: controls }} onHome={onHome} />);
    const group = screen.getByRole("group", { name: "카메라 조작" });
    expect(group.dataset.qa).toBe("camera-controls");
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
    fireEvent.click(screen.getByRole("button", { name: "처음 시점" }));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(controls.update).toHaveBeenCalledTimes(4);
  });

  it("does nothing before the controls exist", () => {
    render(<CameraControls controlsRef={{ current: null }} onHome={() => {}} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "확대" }))).not.toThrow();
  });
});

/* @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { HudToolbar } from "./HudToolbar.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderBar = (props = {}) => render(
  <HudToolbar presets={CAMERA_PRESETS} activeId="overview" onSelect={vi.fn()} {...props} />,
);

describe("HudToolbar", () => {
  it("is the 시점 menu alone: 전체 and the tour toggle are not in the HUD bar", () => {
    renderBar();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.dataset.qa)).toEqual(["camera-view-menu"]);
    expect(screen.queryByRole("button", { name: "전체" })).toBeNull();
    expect(screen.queryByRole("button", { name: /투어/ })).toBeNull();
  });

  it("opens the menu, moves with arrow keys, selects a preset and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderBar({ onSelect });
    const trigger = screen.getByRole("button", { name: /시점/ });
    await user.click(trigger);
    const items = within(screen.getByRole("menu", { name: "시점" })).getAllByRole("menuitemradio");
    expect(items).toHaveLength(CAMERA_PRESETS.length - 1);
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(CAMERA_PRESETS[2]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape, and names the active preset on the trigger with one pressed style", async () => {
    const user = userEvent.setup();
    renderBar({ activeId: "library" });
    const trigger = screen.getByRole("button", { name: /도서관/ });
    expect(trigger.dataset.active).toBe("true");
    expect(trigger.className).not.toMatch(/border-primary|text-primary|!/);
    await user.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: /도서관/ }).getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("is an icon button named by the active preset in compact (phone) mode", () => {
    renderBar({ activeId: "library", compact: true });
    const trigger = screen.getByRole("button", { name: "시점: 도서관" });
    expect(trigger.textContent).toBe("");
  });

  // Phone: with the feed chip after it the trigger sits mid-row, so a menu aligned to the trigger ran off the left edge.
  // The compact menu lines up with the HUD row's right edge; desktop keeps the trigger's left edge.
  it("anchors the compact (phone) menu to the HUD row, not to the trigger", async () => {
    const user = userEvent.setup();
    const row = { left: 0, right: 390 };
    const triggerRect = { x: 200, y: 16, left: 200, right: 244, top: 16, bottom: 60, width: 44, height: 44 };
    // happy-dom's viewport has no size, so every placement would count as a collision.
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1024);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(768);
    for (const [compact, expectedX] of [[false, triggerRect.left], [true, row.right]]) {
      const { unmount } = renderBar({ compact });
      const trigger = screen.getByRole("button", { name: /시점/ });
      Object.defineProperty(trigger, "offsetParent", { value: { getBoundingClientRect: () => row } });
      trigger.getBoundingClientRect = () => triggerRect;
      await user.click(trigger);
      const placed = screen.getByRole("menu", { name: "시점" }).parentElement;
      await waitFor(() => expect(placed.style.transform).toMatch(new RegExp(`^translate\\(${expectedX}px,`)));
      unmount();
    }
  });
});

/* @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { HudToolbar } from "./HudToolbar.jsx";

afterEach(cleanup);

const renderBar = (props = {}) => render(
  <HudToolbar presets={CAMERA_PRESETS} activeId="overview" onSelect={vi.fn()} onToggleTour={vi.fn()} {...props} />,
);

describe("HudToolbar", () => {
  it("has exactly three groups: 전체, the 시점 menu and the tour toggle with verb labels", () => {
    renderBar();
    const bar = screen.getByRole("toolbar", { name: "카메라 시점" });
    const buttons = within(bar).getAllByRole("button");
    expect(buttons.map((button) => button.dataset.qa)).toEqual(["camera-preset-overview", "camera-view-menu", "camera-tour-toggle"]);
    expect(screen.getByRole("button", { name: "투어 시작" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed")).toBe("true");
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
    renderBar({ activeId: "library", touring: true });
    const trigger = screen.getByRole("button", { name: /도서관/ });
    expect(trigger.className).toMatch(/\bbg-surface-2\b/);
    expect(trigger.className).not.toMatch(/border-primary|text-primary/);
    expect(screen.getByRole("button", { name: "투어 멈춤" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: /도서관/ }).getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

/* @vitest-environment happy-dom */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUALITY_COPY, SettingsSheet } from "./SettingsSheet.jsx";
import { SURFACE_MS } from "./DashboardShell.jsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const quality = (onChange = vi.fn()) => ({ tiers: ["low", "medium", "high"], labels: { low: "낮음", medium: "보통", high: "높음" }, value: "low", onChange, source: "stored" });

describe("SettingsSheet", () => {
  it("opens a titled non-modal popover on desktop with no scrim, applies quality at once and closes on Escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<SettingsSheet mode="desktop" open onClose={onClose} themeMode="dark" onThemeChange={vi.fn()} quality={quality(onChange)} />);
    const dialog = screen.getByRole("dialog", { name: "설정" });
    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute("aria-modal")).not.toBe("true");
    expect(screen.getByRole("heading", { level: 2, name: "설정" })).toBeTruthy();
    expect(document.body.querySelector("[class*='colors-dim'], .backdrop-blur, [aria-modal='true']")).toBeNull();
    expect(container.querySelector('[data-qa="render-quality"] p').textContent).toBe(QUALITY_COPY.low);
    await user.click(screen.getByRole("radio", { name: "높음" }));
    expect(onChange).toHaveBeenCalledWith("high");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("raises a half sheet on a phone from below and lowers it the same way before it unmounts", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const props = { mode: "phone", onClose, themeMode: "dark", onThemeChange: vi.fn(), quality: quality() };
    const view = render(<SettingsSheet {...props} open />);
    const sheet = document.body.querySelector('[data-qa="sheet"]');
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(sheet.dataset.detent).toBe("half");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    view.rerender(<SettingsSheet {...props} open={false} />);
    expect(sheet.dataset.detent).toBe("peek");
    act(() => {
      vi.advanceTimersByTime(SURFACE_MS);
    });
    expect(document.body.querySelector('[data-qa="sheet"]')).toBeNull();
  });

  it("keeps each quality sentence to one full stop", () => {
    for (const sentence of Object.values(QUALITY_COPY)) expect((sentence.match(/\./g) ?? []).length).toBe(1);
  });
});

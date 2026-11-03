/* @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUALITY_COPY, SettingsSheet } from "./SettingsSheet.jsx";

afterEach(cleanup);

const quality = (onChange = vi.fn()) => ({ tiers: ["low", "medium", "high"], labels: { low: "낮음", medium: "보통", high: "높음" }, value: "low", onChange, source: "stored" });

describe("SettingsSheet", () => {
  it("opens a non-modal popover on desktop with no scrim, applies quality at once and closes on Escape back to 설정", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<SettingsSheet mode="desktop" themeMode="dark" onThemeChange={vi.fn()} quality={quality(onChange)} />);
    const trigger = screen.getByRole("button", { name: "설정" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "설정" });
    expect(dialog.getAttribute("aria-modal")).not.toBe("true");
    expect(document.body.querySelector("[class*='colors-dim'], .backdrop-blur, [aria-modal='true']")).toBeNull();
    expect(container.querySelector('[data-qa="render-quality"] p').textContent).toBe(QUALITY_COPY.low);
    await user.click(screen.getByRole("radio", { name: "높음" }));
    expect(onChange).toHaveBeenCalledWith("high");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("opens a half sheet on a phone, collapses the dashboard sheet and closes on Escape back to 설정", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SettingsSheet mode="phone" themeMode="dark" onThemeChange={vi.fn()} quality={quality()} onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "설정" });
    await user.click(trigger);
    const sheet = document.body.querySelector('[data-qa="sheet"]');
    expect(sheet.dataset.detent).toBe("half");
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps each quality sentence to one full stop", () => {
    for (const sentence of Object.values(QUALITY_COPY)) expect((sentence.match(/\./g) ?? []).length).toBe(1);
  });
});

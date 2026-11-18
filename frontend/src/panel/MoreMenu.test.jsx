/* @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LINK_COPIED, MoreMenu } from "./MoreMenu.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const quality = { tiers: ["low", "high"], labels: { low: "낮음", high: "높음" }, value: "low", onChange: vi.fn(), source: "stored" };
const renderMenu = (props = {}) => render(
  <MoreMenu mode="desktop" onTogglePresentation={vi.fn()} themeMode="system" onThemeChange={vi.fn()} quality={quality} {...props} />,
);

describe("MoreMenu", () => {
  it("lists 설정, 발표 모드 and 링크 복사 as menu items behind one 더보기 button", async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole("button", { name: "더보기" });
    expect(trigger.dataset.qa).toBe("more-menu");
    await user.click(trigger);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["설정", "발표 모드P", "링크 복사"]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement.textContent).toBe("발표 모드P");
  });

  it("opens 설정 from the menu and returns focus to 더보기 when it closes", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "더보기" }));
    await user.click(screen.getByRole("menuitem", { name: "설정" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "설정" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "더보기" }));
  });

  it("drops 발표 모드 and adds the account line and 로그아웃 when the screen passes an account", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    renderMenu({ onTogglePresentation: null, accountLabel: "게스트 · 학생", onLogout });
    await user.click(screen.getByRole("button", { name: "더보기" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["설정", "링크 복사", "로그아웃"]);
    expect(screen.getByText("게스트 · 학생")).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "로그아웃" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("toggles presentation mode from the menu", async () => {
    const user = userEvent.setup();
    const onTogglePresentation = vi.fn();
    renderMenu({ onTogglePresentation });
    await user.click(screen.getByRole("button", { name: "더보기" }));
    await user.click(screen.getByRole("menuitem", { name: /발표 모드/ }));
    expect(onTogglePresentation).toHaveBeenCalledTimes(1);
  });

  it("copies the address and confirms with a status line", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderMenu({ getHref: () => "http://campus.test/?b=BLD_C1" });
    await user.click(screen.getByRole("button", { name: "더보기" }));
    await act(async () => user.click(screen.getByRole("menuitem", { name: "링크 복사" })));
    expect(writeText).toHaveBeenCalledWith("http://campus.test/?b=BLD_C1");
    expect(screen.getByRole("status").textContent).toBe(LINK_COPIED);
  });

  it("shows the address in a read-only field when the clipboard is unavailable", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {});
    renderMenu({ getHref: () => "http://campus.test/?t=60" });
    await user.click(screen.getByRole("button", { name: "더보기" }));
    await act(async () => user.click(screen.getByRole("menuitem", { name: "링크 복사" })));
    const field = screen.getByRole("textbox", { name: "공유 링크" });
    expect(field.value).toBe("http://campus.test/?t=60");
    expect(field.readOnly).toBe(true);
  });
});

/* @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Disclosure } from "./Disclosure.jsx";

afterEach(cleanup);

describe("Disclosure", () => {
  it("toggles aria-expanded and the hidden panel with the mouse and the keyboard", async () => {
    const user = userEvent.setup();
    render(<Disclosure summary="설치 계획">계획 도구</Disclosure>);
    const button = screen.getByRole("button", { name: "설치 계획" });
    const panel = document.getElementById(button.getAttribute("aria-controls"));
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    await user.keyboard("{Enter}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps what was typed inside when it is closed and reopened", async () => {
    const user = userEvent.setup();
    render(<Disclosure summary="고급" defaultOpen><input aria-label="계수" /></Disclosure>);
    await user.type(screen.getByRole("textbox", { name: "계수" }), "12");
    const button = screen.getByRole("button", { name: "고급" });
    await user.click(button);
    await user.click(button);
    expect(screen.getByRole("textbox", { name: "계수" }).value).toBe("12");
  });

  it("starts open with defaultOpen", () => {
    render(<Disclosure summary="자세히" defaultOpen>내용</Disclosure>);
    expect(screen.getByRole("button", { name: "자세히" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("내용")).toBeTruthy();
  });
});

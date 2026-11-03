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

  it("starts open with defaultOpen", () => {
    render(<Disclosure summary="자세히" defaultOpen>내용</Disclosure>);
    expect(screen.getByRole("button", { name: "자세히" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("내용")).toBeTruthy();
  });
});

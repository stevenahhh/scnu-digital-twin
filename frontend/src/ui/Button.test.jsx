/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button.jsx";

afterEach(cleanup);

describe("Button", () => {
  it.each([
    ["primary", ["bg-primary", "text-on-primary"]],
    ["secondary", ["bg-surface-1", "border-hairline-strong", "text-ink"]],
    ["ghost", ["bg-transparent", "text-ink-muted"]],
  ])("renders the %s variant from token classes", (variant, expected) => {
    render(<Button variant={variant}>저장</Button>);
    const classes = screen.getByRole("button", { name: "저장" }).className.split(" ");
    for (const name of expected) expect(classes).toContain(name);
  });

  it.each([
    ["sm", "min-h-8"],
    ["md", "min-h-10"],
  ])("gives the %s size its desktop height and a 44px coarse-pointer height", (size, height) => {
    render(<Button size={size}>저장</Button>);
    const classes = screen.getByRole("button").className.split(" ");
    expect(classes).toContain(height);
    expect(classes).toContain("[@media(pointer:coarse)]:min-h-11");
  });

  it("always carries the focus-visible ring", () => {
    render(<Button>저장</Button>);
    const classes = screen.getByRole("button").className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["focus-visible:outline-2", "focus-visible:outline-primary", "focus-visible:outline-offset-2"]));
  });

  it("names an icon-only button through aria-label and title", () => {
    render(<Button iconOnly label="기상 데이터 새로고침" icon={<svg aria-hidden="true" />} />);
    const button = screen.getByRole("button", { name: "기상 데이터 새로고침" });
    expect(button.getAttribute("title")).toBe("기상 데이터 새로고침");
    expect(button.className.split(" ")).toContain("[@media(pointer:coarse)]:min-w-11");
  });

  it("gives icon-only buttons the same text step as their size, so each size has one style", () => {
    render(
      <>
        <Button iconOnly size="sm" label="작게" icon={<svg aria-hidden="true" />} />
        <Button iconOnly size="md" label="보통" icon={<svg aria-hidden="true" />} />
      </>,
    );
    expect(screen.getByRole("button", { name: "작게" }).className.split(" ")).toContain("text-caption");
    expect(screen.getByRole("button", { name: "보통" }).className.split(" ")).toContain("text-body");
  });

  it("stays focusable when disabled, explains why and ignores clicks", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button disabled disabledReason="연결이 없어 저장할 수 없습니다" onClick={onClick}>저장</Button>);
    const button = screen.getByRole("button", { name: "저장" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("title")).toBe("연결이 없어 저장할 수 없습니다");
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("swaps the label for exactly one spinner while loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = render(<Button loading onClick={onClick}>저장</Button>);
    const button = screen.getByRole("button", { name: "저장" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-qa=button-spinner]")).toHaveLength(1);
    expect(button.querySelector(".invisible")?.textContent).toBe("저장");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

/* @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Skeleton } from "./Skeleton.jsx";

afterEach(cleanup);

describe("Skeleton", () => {
  it("is hidden from assistive technology and static under reduced motion", () => {
    const { container } = render(<Skeleton shape="block" />);
    const root = container.querySelector("[data-qa=skeleton]");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    const block = root.firstElementChild;
    expect(block.className).toContain("bg-surface-2");
    expect(block.className).toContain("motion-reduce:animate-none");
  });

  it("renders the requested number of lines with a shorter last line", () => {
    const { container } = render(<Skeleton lines={3} />);
    const lines = container.querySelector("[data-qa=skeleton]").children;
    expect(lines).toHaveLength(3);
    expect(lines[2].className).toContain("w-2/3");
  });
});

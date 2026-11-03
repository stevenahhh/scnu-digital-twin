/* @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionHeader } from "./SectionHeader.jsx";
import { StatusBadge } from "./StatusBadge.jsx";

afterEach(cleanup);

describe("SectionHeader", () => {
  it("renders an h3 by default and honours the level prop", () => {
    const { rerender } = render(<SectionHeader title="미기후" />);
    expect(screen.getByRole("heading", { level: 3, name: "미기후" })).toBeTruthy();
    rerender(<SectionHeader title="태양광 현황" level={2} />);
    expect(screen.getByRole("heading", { level: 2, name: "태양광 현황" })).toBeTruthy();
  });

  it("has no uppercase eyebrow, tracking or accent colour", () => {
    const { container } = render(<SectionHeader title="미기후" subtitle="건물 표면 온도 추정" badge={<StatusBadge tone="estimate" />} />);
    expect(container.innerHTML).not.toMatch(/uppercase|tracking-|text-primary/);
    expect(screen.getByText("건물 표면 온도 추정").tagName).toBe("P");
    expect(screen.getByText("추정")).toBeTruthy();
  });
});

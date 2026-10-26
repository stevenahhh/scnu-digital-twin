/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge.jsx";

afterEach(cleanup);

const textNodes = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
};

describe("StatusBadge", () => {
  it("renders its text with the tone on a data attribute", () => {
    render(<StatusBadge tone="success">실시간</StatusBadge>);
    const badge = screen.getByText("실시간");
    expect(badge.dataset.tone).toBe("success");
    expect(badge.className).toContain("text-micro");
    expect(badge.className).toContain("rounded-control");
  });

  it("marks sample data with the sample-badge hook and a default label", () => {
    const { container } = render(<StatusBadge tone="sample" />);
    const badge = container.querySelector("[data-qa=sample-badge]");
    expect(badge.textContent).toBe("샘플 데이터");
  });

  it("labels an estimate 추정 by default", () => {
    render(<StatusBadge tone="estimate" />);
    expect(screen.getByText("추정").dataset.tone).toBe("estimate");
  });

  it("never outputs an empty text node", () => {
    const { container } = render(
      <div>
        <StatusBadge tone="neutral">{"  "}</StatusBadge>
        <StatusBadge tone="danger" />
        <StatusBadge tone="warning">지연</StatusBadge>
      </div>,
    );
    expect(container.querySelectorAll("[data-tone]")).toHaveLength(1);
    for (const node of textNodes(container)) expect(node.textContent.trim()).not.toBe("");
  });

  it("hides the icon from assistive technology", () => {
    const Icon = (props) => <svg data-testid="icon" {...props} />;
    render(<StatusBadge tone="warning" icon={Icon}>지연</StatusBadge>);
    expect(screen.getByTestId("icon").getAttribute("aria-hidden")).toBe("true");
  });
});

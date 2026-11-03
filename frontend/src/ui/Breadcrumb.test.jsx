/* @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Breadcrumb } from "./Breadcrumb.jsx";

afterEach(cleanup);

describe("Breadcrumb", () => {
  it("renders a labelled nav where every segment but the last is a button", async () => {
    const user = userEvent.setup();
    const toCampus = vi.fn();
    const toBuilding = vi.fn();
    render(
      <Breadcrumb
        items={[
          { label: "캠퍼스", onSelect: toCampus },
          { label: "공과대학 3호관", onSelect: toBuilding },
          { label: "3층" },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(nav.dataset.qa).toBe("breadcrumb");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["캠퍼스", "공과대학 3호관"]);
    expect(screen.getByText("3층").getAttribute("aria-current")).toBe("page");
    await user.click(screen.getByRole("button", { name: "캠퍼스" }));
    expect(toCampus).toHaveBeenCalledOnce();
    expect(toBuilding).not.toHaveBeenCalled();
  });
});

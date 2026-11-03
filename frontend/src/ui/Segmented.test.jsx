/* @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Segmented } from "./Segmented.jsx";

afterEach(cleanup);

const TABS = [
  { value: "basic", label: "기본 현황" },
  { value: "parking", label: "주차·안전" },
  { value: "energy", label: "에너지" },
];

function Controlled({ kind = "tabs", options = TABS, initial = "basic" }) {
  const [value, setValue] = useState(initial);
  return <Segmented kind={kind} label="대시보드 탭" options={options} value={value} onChange={setValue} />;
}

describe("Segmented", () => {
  it("renders a tablist with aria-selected and roving tabindex", () => {
    render(<Controlled />);
    expect(screen.getByRole("tablist", { name: "대시보드 탭" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it("renders a radiogroup with aria-checked when kind is radio", () => {
    render(<Controlled kind="radio" />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("moves the active segment and focus with the arrow keys, wrapping at the ends", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "기본 현황" }));
    await user.keyboard("{ArrowRight}");
    const parking = screen.getByRole("tab", { name: "주차·안전" });
    expect(parking.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(parking);
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "에너지" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "기본 현황" }).getAttribute("aria-selected")).toBe("true");
  });

  it("skips disabled segments with the keyboard", async () => {
    const user = userEvent.setup();
    const options = [TABS[0], { ...TABS[1], disabled: true, disabledReason: "준비 중" }, TABS[2]];
    render(<Controlled options={options} />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "에너지" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "주차·안전" }).getAttribute("title")).toBe("준비 중");
  });

  it("uses one active style with a dot and never the accent", () => {
    render(<Controlled />);
    const active = screen.getByRole("tab", { name: "기본 현황" });
    const classes = active.className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["bg-surface-2", "text-ink"]));
    expect(active.className).not.toMatch(/(bg|border|text)-primary/);
    expect(active.querySelector("[data-qa=segment-dot]")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "에너지" }).querySelector("[data-qa=segment-dot]")).toBeNull();
  });

  it("gives every segment the focus ring and a 44px coarse-pointer height", () => {
    render(<Controlled />);
    for (const tab of screen.getAllByRole("tab")) {
      const classes = tab.className.split(" ");
      expect(classes).toContain("[@media(pointer:coarse)]:min-h-11");
      expect(classes).toContain("focus-visible:outline-primary");
    }
  });
});

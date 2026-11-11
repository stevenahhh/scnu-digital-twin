/* @vitest-environment happy-dom */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DotMarker, LABEL_HIT, LABEL_TEXT, SCENE_LABEL_STATES, SceneLabel, ZoneLabel } from "./SceneLabel.jsx";

afterEach(cleanup);

const chipOf = (button) => button.querySelector("[data-qa=label-chip]");

describe("SceneLabel", () => {
  it("is a campus-label button carrying id, tier and state", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SceneLabel name="공과대학 3호관" elementId="BLD_D4" tier={1} code="D4" onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: /공과대학 3호관/ });
    expect(button.dataset.qa).toBe("campus-label");
    expect(button.dataset.elementId).toBe("BLD_D4");
    expect(button.dataset.tier).toBe("1");
    expect(button.dataset.state).toBe("idle");
    expect(screen.getByText("D4").dataset.tone).toBe("neutral");
    await user.click(button);
    expect(onSelect).toHaveBeenCalledWith("BLD_D4");
  });

  it("uses the 12px caption step with a 14px coarse-pointer step and a 40x40 / 44x44px hit area", () => {
    render(<SceneLabel name="도서관" elementId="BLD_L" />);
    const button = screen.getByRole("button");
    const chip = chipOf(button);
    expect(chip.className.split(" ")).toEqual(expect.arrayContaining(LABEL_TEXT.split(" ")));
    expect(LABEL_TEXT).toContain("text-caption");
    expect(LABEL_TEXT).toContain("[@media(pointer:coarse)_and_(min-width:640px)]:text-body");
    expect(button.className.split(" ")).toEqual(expect.arrayContaining(LABEL_HIT.split(" ")));
    expect(LABEL_HIT.split(" ")).toEqual([
      "min-h-10", "min-w-10", "[@media(pointer:coarse)]:min-h-11", "[@media(pointer:coarse)]:min-w-11", "max-[639px]:min-h-11", "max-[639px]:min-w-11",
    ]);
  });

  // At P (15 px) a one-word name wider than max-w-40 was cut mid-letter (C4 환경친화형물질공정연구센터); below 640 px it breaks.
  it("lets a long one-word name break inside the word below 640 px only", () => {
    render(<SceneLabel name="환경친화형물질공정연구센터" elementId="BLD_C4" code="C4" />);
    const name = screen.getByText("환경친화형물질공정연구센터");
    expect(name.className.split(" ")).toEqual(expect.arrayContaining([
      "line-clamp-2", "break-keep", "max-[639px]:[overflow-wrap:anywhere]", "max-[639px]:[text-wrap:balance]",
    ]));
  });

  it.each(SCENE_LABEL_STATES)("maps the %s state to data-state", (state) => {
    render(<SceneLabel name="학생회관" elementId="BLD_S" state={state} value="24.3 °C 추정" />);
    expect(screen.getByRole("button").dataset.state).toBe(state);
  });

  it("styles selection with the accent border, semibold weight and aria-pressed", () => {
    render(<SceneLabel name="도서관" elementId="BLD_L" state="selected" />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    const classes = chipOf(button).className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["border-primary", "font-semibold"]));
  });

  it("dims to 60 % and shows hollow and grey dots for no-data and stale", () => {
    const { rerender } = render(<SceneLabel name="체육관" elementId="BLD_G" state="dimmed" />);
    expect(chipOf(screen.getByRole("button")).className).toContain("opacity-60");
    rerender(<SceneLabel name="체육관" elementId="BLD_G" state="no-data" />);
    expect(screen.getByRole("button").querySelector("[data-qa=label-dot]").className).toContain("border");
    rerender(<SceneLabel name="체육관" elementId="BLD_G" state="stale" />);
    expect(screen.getByRole("button").querySelector("[data-qa=label-dot]").className).toContain("bg-ink-subtle");
  });

  it("marks an estimated name with a dashed border, the glyph and the aria suffix", () => {
    render(<SceneLabel name="운동장 본부석" code="A15" elementId="BLD_A15" state="estimated" />);
    const button = screen.getByRole("button", { name: "A15 운동장 본부석, 명칭 추정" });
    expect(button.querySelector("[data-qa=label-estimated-glyph]").textContent).toBe("≈");
    expect(chipOf(button).className).toContain("border-dashed");
  });

  it("marks the selected chip with a check glyph besides the accent border", () => {
    const { container, rerender } = render(<SceneLabel name="도서관" elementId="BLD_L" state="selected" />);
    expect(container.querySelector("button [data-qa=label-selected-glyph]")).not.toBeNull();
    rerender(<SceneLabel name="도서관" elementId="BLD_L" state="idle" />);
    expect(container.querySelector("[data-qa=label-selected-glyph]")).toBeNull();
  });

  it("lifts the hovered chip one step and leaves the other states in place", () => {
    const { container, rerender } = render(<SceneLabel name="도서관" elementId="BLD_L" state="hover" />);
    expect(container.querySelector("button").className).toMatch(/(^|\s)-translate-y-0\.5(\s|$)/);
    rerender(<SceneLabel name="도서관" elementId="BLD_L" state="idle" />);
    // Idle: lifted only while the pointer is over it (CSS hover), never by default.
    const idle = container.querySelector("button").className.split(" ");
    expect(idle).toContain("hover:-translate-y-0.5");
    expect(idle).not.toContain("-translate-y-0.5");
  });

  it("shows the headline value in the hover state", () => {
    render(<SceneLabel name="도서관" elementId="BLD_L" state="hover" value="24.3 °C 추정" />);
    expect(screen.getByText("24.3 °C 추정").className).toContain("inline");
  });

  it("wraps to two lines within 160px and never uses nowrap, black weight, pixel sizes or a transform scale", () => {
    render(<SceneLabel name="사범대학 3호관 부속 실험 실습동 및 교육 연구 지원 센터 별관" elementId="BLD_X" />);
    const chip = chipOf(screen.getByRole("button"));
    expect(chip.className).toContain("max-w-40");
    expect(chip.querySelector(".line-clamp-2")).toBeTruthy();
    cleanup();
    const { container } = render(
      <>
        {SCENE_LABEL_STATES.map((state) => (
          <SceneLabel key={state} name="도서관" elementId={`BLD_${state}`} state={state} code="L1" value="24.3 °C 추정" leader={{ dx: 4, dy: 8 }} />
        ))}
        <DotMarker name="별관" elementId="BLD_A" />
        <ZoneLabel name="공학 구역" />
      </>,
    );
    expect(container.innerHTML).not.toMatch(/whitespace-nowrap|font-black|text-\[11px\]|rounded-\[10px\]|scale-/);
  });

  it("draws a leader line to the anchor when displaced", () => {
    render(<SceneLabel name="도서관" elementId="BLD_L" leader={{ dx: 12, dy: 18 }} />);
    const line = screen.getByRole("button").querySelector("[data-qa=label-leader] line");
    expect(line.getAttribute("x2")).toBe("12");
    expect(line.getAttribute("y2")).toBe("18");
  });
});

describe("DotMarker", () => {
  it("expands on the first tap and selects on the second", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<DotMarker name="공과대학 3호관 별관" elementId="BLD_D4A" onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: "공과대학 3호관 별관" });
    expect(button.dataset.expanded).toBe("false");
    act(() => button.click());
    expect(button.dataset.expanded).toBe("true");
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(button);
    expect(onSelect).toHaveBeenCalledWith("BLD_D4A");
  });

  it("has a 44px coarse-pointer hit area", () => {
    render(<DotMarker name="별관" elementId="BLD_A" />);
    const classes = screen.getByRole("button").className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["[@media(pointer:coarse)]:min-h-11", "[@media(pointer:coarse)]:min-w-11"]));
  });
});

describe("ZoneLabel", () => {
  it("is a non-interactive, aria-hidden tier-0 label", () => {
    const { container } = render(<ZoneLabel name="공학 구역" />);
    const zone = container.querySelector("[data-qa=zone-label]");
    expect(zone.getAttribute("aria-hidden")).toBe("true");
    expect(zone.dataset.tier).toBe("0");
    expect(zone.className).toContain("pointer-events-none");
    // Same translucent plate as the chips, so the name stays readable over a dark night scene.
    expect(zone.className).toContain("bg-[var(--colors-label-bg)]");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("SceneLabel pressed state", () => {
  it("settles 1px while pressed, from idle, hover and selected alike (V-F-36)", () => {
    for (const state of ["idle", "hover", "selected"]) {
      const { unmount } = render(<SceneLabel name="학생회관" elementId="BLD_E1" state={state} />);
      expect(screen.getByRole("button").className.split(/\s+/)).toContain("active:translate-y-px");
      unmount();
    }
  });
});

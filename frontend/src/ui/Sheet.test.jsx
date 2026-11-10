/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REDUCED_MOTION_DIM_OPACITY, Sheet } from "./Sheet.jsx";

afterEach(cleanup);

const renderSheet = (props = {}) =>
  render(
    <Sheet label="대시보드" {...props}>
      <p>내용</p>
    </Sheet>,
  );

describe("Sheet", () => {
  it("is a labelled region that starts at peek, not covering the screen", () => {
    renderSheet();
    const sheet = screen.getByRole("region", { name: "대시보드" });
    expect(sheet.dataset.detent).toBe("peek");
    expect(sheet.style.transform).toBe("translateY(calc(100% - 96px))");
    expect(sheet.style.transitionProperty).toBe("transform");
  });

  it("has a 44x44 handle that moves one detent per arrow key", async () => {
    const user = userEvent.setup();
    const onDetentChange = vi.fn();
    renderSheet({ onDetentChange });
    const handle = screen.getByRole("button", { name: "패널 크기 조절" });
    expect(handle.dataset.qa).toBe("sheet-handle");
    expect(handle.className.split(" ")).toEqual(expect.arrayContaining(["h-11", "w-11"]));

    handle.focus();
    await user.keyboard("{ArrowUp}");
    const sheet = screen.getByRole("region");
    expect(sheet.dataset.detent).toBe("half");
    expect(sheet.style.transform).toBe("translateY(calc(100% - 50dvh))");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(sheet.dataset.detent).toBe("full");
    expect(sheet.style.transform).toBe("translateY(0px)");
    await user.keyboard("{ArrowDown}");
    expect(sheet.dataset.detent).toBe("half");
    expect(onDetentChange.mock.calls.map(([detent]) => detent)).toEqual(["half", "full", "half"]);
  });

  it("returns to peek on Escape without trapping focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Sheet label="대시보드" defaultDetent="half">
          <button type="button">시트 안</button>
        </Sheet>
        <button type="button">장면</button>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "시트 안" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("region").dataset.detent).toBe("peek");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "장면" }));
  });

  it("scrolls its body only at full", async () => {
    const user = userEvent.setup();
    renderSheet({ defaultDetent: "half" });
    const body = screen.getByText("내용").parentElement;
    expect(body.className).toContain("overflow-hidden");
    screen.getByRole("button", { name: "패널 크기 조절" }).focus();
    await user.keyboard("{ArrowUp}");
    expect(body.className).toContain("overflow-y-auto");
  });

  it("cross-fades with opacity instead of sliding under reduced motion", () => {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} });
    try {
      renderSheet();
      expect(screen.getByRole("region").style.transitionProperty).toBe("opacity");
    } finally {
      window.matchMedia = original;
    }
  });

  it("dims at the old height, then moves and brightens under reduced motion (never vanishes)", () => {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} });
    vi.useFakeTimers();
    try {
      renderSheet();
      const sheet = screen.getByRole("region");
      fireEvent.keyDown(screen.getByRole("button", { name: "패널 크기 조절" }), { key: "ArrowUp" });
      expect(sheet.dataset.detent).toBe("half");
      expect(sheet.style.opacity).toBe(String(REDUCED_MOTION_DIM_OPACITY));
      expect(sheet.style.transform).toBe("translateY(calc(100% - 96px))");
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(sheet.style.transform).toBe("translateY(calc(100% - 50dvh))");
      expect(sheet.style.opacity).toBe("1");
    } finally {
      vi.useRealTimers();
      window.matchMedia = original;
    }
  });

  it("follows a drag with the element transform and settles on the nearest detent on release", () => {
    renderSheet();
    const sheet = screen.getByRole("region");
    const handle = screen.getByRole("button", { name: "패널 크기 조절" });
    // jsdom에는 PointerEvent가 없어 fireEvent.pointer*가 clientY를 싣지 못한다. 같은 이름의 MouseEvent로 보낸다.
    const pointer = (type, clientY) => fireEvent(handle, new MouseEvent(type, { bubbles: true, clientY }));
    pointer("pointerdown", 800);
    pointer("pointermove", 790);
    expect(sheet.style.transitionDuration).toBe("0ms");
    expect(sheet.style.transform).toMatch(/^translateY\(calc\(100% - \d+px\)\)$/);
    pointer("pointerup", 790);
    expect(sheet.style.transitionDuration).toBe("var(--motion-surface)");
    // 빠르게 위로 민 짧은 끌기라 속도로 투영한 단계로 간다. 어느 단계든 끄는 동안 쓴 transform이 그 단계 자리로 돌아와야 한다.
    const offsets = { peek: "translateY(calc(100% - 96px))", half: "translateY(calc(100% - 50dvh))", full: "translateY(0px)" };
    expect(sheet.style.transform).toBe(offsets[sheet.dataset.detent]);
  });
});

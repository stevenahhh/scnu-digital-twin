/* @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet.jsx";

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
});

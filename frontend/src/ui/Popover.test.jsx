/* @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Popover } from "./Popover.jsx";

afterEach(cleanup);

function Legend() {
  return (
    <div>
      <Popover label="범례" qa="legend" renderTrigger={(props) => <button type="button" {...props}>범례</button>}>
        <button type="button">점선 칩 = 명칭 추정</button>
      </Popover>
      <button type="button">바깥</button>
    </div>
  );
}

describe("Popover", () => {
  it("opens a labelled dialog and moves focus into it", async () => {
    const user = userEvent.setup();
    render(<Legend />);
    const trigger = screen.getByRole("button", { name: "범례" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "범례" });
    expect(dialog.dataset.qa).toBe("legend");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "점선 칩 = 명칭 추정" }));
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Legend />);
    const trigger = screen.getByRole("button", { name: "범례" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    render(<Legend />);
    await user.click(screen.getByRole("button", { name: "범례" }));
    await user.click(screen.getByRole("button", { name: "바깥" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

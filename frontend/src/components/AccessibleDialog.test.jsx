/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessibleDialog } from "./AccessibleDialog.jsx";

afterEach(cleanup);

describe("AccessibleDialog", () => {
  it("renders a labelled modal dialog and returns null when closed", () => {
    const { rerender } = render(
      <AccessibleDialog open title="Details" onClose={vi.fn()}>
        <button type="button">Close</button>
      </AccessibleDialog>,
    );
    expect(screen.getByRole("dialog", { name: "Details" }).getAttribute("aria-modal")).toBe("true");
    rerender(<AccessibleDialog open={false} title="Details" onClose={vi.fn()}>Hidden</AccessibleDialog>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AccessibleDialog open title="Details" onClose={onClose}><button>Close</button></AccessibleDialog>);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("focuses the first control and restores focus when closed", () => {
    const { rerender } = render(
      <>
        <button type="button">Open</button>
        <AccessibleDialog open title="Details" onClose={vi.fn()}>
          <button type="button">First</button>
        </AccessibleDialog>
      </>,
    );
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    rerender(<><button type="button">Open</button><AccessibleDialog open={false} title="Details" onClose={vi.fn()}>Hidden</AccessibleDialog></>);
    expect(document.activeElement).toBe(opener);
  });

  it("cycles Tab and Shift+Tab among dialog controls", async () => {
    const user = userEvent.setup();
    render(
      <AccessibleDialog open title="Details" onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </AccessibleDialog>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    expect(document.activeElement).toBe(first);
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(last);
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(first);
  });
});

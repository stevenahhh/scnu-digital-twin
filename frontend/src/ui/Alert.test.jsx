/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Alert } from "./Alert.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Alert", () => {
  it("uses role=alert only for danger and role=status otherwise", () => {
    const { rerender } = render(<Alert tone="danger" title="기상 서버에 연결할 수 없습니다" source="weather" />);
    const alert = screen.getByRole("alert");
    expect(alert.dataset.qa).toBe("alert");
    expect(alert.dataset.source).toBe("weather");
    rerender(<Alert tone="warning" title="기상 서버 응답이 지연되고 있습니다" source="weather" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").dataset.tone).toBe("warning");
  });

  it("renders exactly one retry when one action is given and runs it", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<Alert tone="danger" title="불러오지 못했습니다" actions={[{ label: "다시 시도", onClick: retry }]} />);
    const buttons = screen.getAllByRole("button", { name: "다시 시도" });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows the last good value next to the cause", () => {
    render(<Alert tone="warning" title="지연" lastValue="23.4 °C · 09:40" />);
    expect(screen.getByText("23.4 °C · 09:40")).toBeTruthy();
    expect(screen.getByText(/마지막 정상 값/)).toBeTruthy();
  });

  it("keeps a 자세히 disclosure and a copy button when there is a detail but no action", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText });
    render(<Alert tone="danger" title="미기후 데이터를 불러오지 못했습니다" detail="HTTP 503 /microclimate/elements/BLD_D4/popup" />);

    expect(screen.getByRole("alert")).toBeTruthy();
    const summary = screen.getByRole("button", { name: "자세히" });
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    await user.click(summary);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByRole("button", { name: "자세한 내용 복사" }));
    expect(writeText).toHaveBeenCalledWith("HTTP 503 /microclimate/elements/BLD_D4/popup");
    expect(await screen.findByRole("button", { name: "복사됨" })).toBeTruthy();
  });

  it("says so when the clipboard refuses, leaving the text selectable", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) });
    render(<Alert tone="danger" title="실패" detail="HTTP 500" />);
    await user.click(screen.getByRole("button", { name: "자세히" }));
    await user.click(screen.getByRole("button", { name: "자세한 내용 복사" }));
    expect(await screen.findByRole("button", { name: /복사하지 못했습니다/ })).toBeTruthy();
    expect(screen.getByText("HTTP 500").className).toContain("select-text");
  });
});

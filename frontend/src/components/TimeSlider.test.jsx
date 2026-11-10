/* @vitest-environment happy-dom */
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeSlider } from "./TimeSlider.jsx";
import { dateToDayOfYear } from "./timeControl.mjs";

afterEach(cleanup);

function Harness({ onNow = vi.fn(), collapsible = false }) {
  const [minute, setMinute] = useState(19 * 60);
  const [date, setDate] = useState("2026-10-25");
  const [live, setLive] = useState(false);
  return (
    <>
      <TimeSlider
        minuteOfDay={minute}
        onMinuteChange={(next) => {
          setMinute(next);
          setLive(false);
        }}
        dateValue={date}
        onDateChange={({ year, month, day }) => setDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)}
        onNow={() => {
          onNow();
          setLive(true);
        }}
        live={live}
        onPlayingChange={() => {}}
        collapsible={collapsible}
      />
      <output data-testid="day">{dateToDayOfYear(date)}</output>
    </>
  );
}

const openEditor = () => fireEvent.click(screen.getByRole("button", { name: /날짜와 시각 바꾸기/ }));

describe("TimeSlider (one time control)", () => {
  it("shows no date or time field until the time value button opens the editor", () => {
    render(<Harness />);
    expect(screen.queryByLabelText("장면 날짜")).toBeNull();
    expect(screen.queryByLabelText("장면 시각 입력")).toBeNull();
    const value = screen.getByRole("button", { name: /날짜와 시각 바꾸기/ });
    expect(value.querySelector('[data-qa="time-slider-value"]').textContent).toBe("19:00");
    openEditor();
    expect(screen.getByRole("dialog", { name: "장면 날짜와 시각" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("장면 날짜"));
  });

  it("changes the day of year from the date input", () => {
    render(<Harness />);
    expect(screen.getByTestId("day").textContent).toBe("298");
    openEditor();
    fireEvent.change(screen.getByLabelText("장면 날짜"), { target: { value: "2026-12-21" } });
    expect(screen.getByTestId("day").textContent).toBe("355");
  });

  it("sets the minute from a typed time and leaves it for an invalid one", () => {
    render(<Harness />);
    const slider = screen.getByRole("slider", { name: "시각 (KST)" });
    openEditor();
    const typed = screen.getByLabelText("장면 시각 입력");
    fireEvent.change(typed, { target: { value: "06:45" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("06:45");
    expect(typed.getAttribute("aria-invalid")).toBe("false");
    fireEvent.change(typed, { target: { value: "" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("06:45");
    expect(typed.getAttribute("aria-invalid")).toBe("true");
  });

  it("switches to live mode with 지금, which then reads 실시간, and still steps with ArrowRight", () => {
    const onNow = vi.fn();
    render(<Harness onNow={onNow} />);
    fireEvent.click(screen.getByRole("button", { name: "지금" }));
    expect(onNow).toHaveBeenCalledTimes(1);
    const now = screen.getByRole("button", { name: "지금 실시간" });
    expect(now.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("실측")).toBeNull();
    const slider = screen.getByRole("slider", { name: "시각 (KST)" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider.getAttribute("aria-valuetext")).toBe("19:01");
  });

  it("marks all 25 hours at the caption size, labels every 3 h at desktop and 0/6/12/18/24 at phone", () => {
    const { container } = render(<Harness />);
    const ticks = [...container.querySelectorAll('[data-qa="time-tick"]')];
    expect(ticks).toHaveLength(25);
    const labels = ticks.map((tick) => tick.lastElementChild);
    expect(labels.filter((label) => label.className === "").map((label) => label.textContent)).toEqual(["00", "06", "12", "18", "24"]);
    expect(labels.filter((label) => label.className === "hidden sm:inline").map((label) => label.textContent)).toEqual(["03", "09", "15", "21"]);
    expect(ticks[0].parentElement.className).toMatch(/\btext-caption\b/);
  });

  it("collapses to a scene-time chip when collapsible, expands with the date and time fields and collapses again", () => {
    render(<Harness collapsible />);
    const chip = screen.getByRole("button", { name: /시간 조작 펼치기/ });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(chip.textContent).toContain("19:00");
    const range = document.querySelector('[data-qa="time-slider"] input[type="range"]');
    expect(range.closest("[hidden]")).not.toBeNull();
    expect(screen.queryByLabelText("장면 날짜")?.closest("[hidden]")).not.toBeNull();
    fireEvent.click(chip);
    expect(screen.queryByRole("button", { name: /시간 조작 펼치기/ })).toBeNull();
    expect(range.closest("[hidden]")).toBeNull();
    expect(screen.getByLabelText("장면 날짜").closest("[hidden]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "시간 조작 접기" }));
    expect(screen.getByRole("button", { name: /시간 조작 펼치기/ })).toBeTruthy();
  });
});

describe("TimeSlider updated cue (one 1 s wash on a discrete change)", () => {
  const readout = () => document.querySelector('[data-qa="time-slider-value"]');
  const range = () => screen.getByRole("slider", { name: "시각 (KST)" });

  it("marks the time readout for 1 s when a slider change is committed", () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      expect(readout().getAttribute("data-updated")).toBeNull();
      fireEvent.change(range(), { target: { value: String(21 * 60) } });
      expect(readout().textContent).toBe("21:00");
      expect(readout().getAttribute("data-updated")).toBe("true");
      act(() => vi.advanceTimersByTime(1000));
      expect(readout().getAttribute("data-updated")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark the readout while the slider is dragged (input events only)", () => {
    render(<Harness />);
    fireEvent.input(range(), { target: { value: String(20 * 60) } });
    expect(readout().textContent).toBe("20:00");
    expect(readout().getAttribute("data-updated")).toBeNull();
  });

  it("marks the readout when 지금 is pressed", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /지금/ }));
    expect(readout().getAttribute("data-updated")).toBe("true");
  });
});

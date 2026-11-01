/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PanelClock } from "./PanelClock.jsx";

afterEach(cleanup);

describe("PanelClock", () => {
  it("shows the scene date as a Korean date and keeps the ISO value for machines", () => {
    render(<PanelClock sceneMinuteOfDay={1140} sceneDate="2026-10-25" />);
    const date = screen.getByText("10월 25일");
    expect(date.tagName).toBe("TIME");
    expect(date.getAttribute("datetime")).toBe("2026-10-25");
    expect(screen.queryByText("2026-10-25")).toBeNull();
  });
});

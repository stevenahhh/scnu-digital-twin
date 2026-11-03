/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./vworld/VWorldRenderer.jsx", () => ({
  default: ({ presentationMode }) => <div data-testid="vworld-solar-map">{presentationMode ? "presentation" : "default"}</div>,
}));
vi.mock("./features/energy/dashboard/EnergyDashboard.jsx", () => ({
  EnergyDashboard: ({ buildingId, initialDate }) => <div data-testid="energy-dashboard">{buildingId}:{initialDate}</div>,
}));

import SolarPresentationPage from "./SolarPresentationPage.jsx";

afterEach(cleanup);

describe("SolarPresentationPage", () => {
  it("renders a full solar presentation surface with synchronized date controls", () => {
    render(<SolarPresentationPage initialDate={new Date("2026-05-18T03:00:00.000Z")} />);

    expect(screen.getByRole("heading", { name: "태양 경로 기반 태양광 시뮬레이션" })).toBeTruthy();
    expect(screen.getByTestId("vworld-solar-map").textContent).toBe("presentation");
    expect(screen.getByTestId("energy-dashboard").textContent).toBe("D4:2026-05-18");

    fireEvent.change(screen.getByRole("slider", { name: "태양 시뮬레이션 월" }), { target: { value: "8" } });
    expect(screen.getByTestId("energy-dashboard").textContent).toBe("D4:2026-08-18");
    expect(screen.getByText("8월 18일")).toBeTruthy();
  });
});

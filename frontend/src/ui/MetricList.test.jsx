/* @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EstimateValue } from "./EstimateValue.jsx";
import { MetricList } from "./MetricList.jsx";

afterEach(cleanup);

describe("MetricList", () => {
  it("renders a dl with matching dt and dd counts and one caption", () => {
    const { container } = render(
      <MetricList
        caption="KMA 초단기실황 · 09:40 기준 추정"
        items={[
          { label: "기온", value: <EstimateValue value={24.3} unit="°C" /> },
          { label: "풍속", value: <EstimateValue value={2.1} unit="m/s" /> },
          { label: "습도", value: null, empty: { message: "기상 서버에 연결할 수 없습니다", actionLabel: "다시 시도", onAction: vi.fn() } },
        ]}
      />,
    );
    const dl = container.querySelector("dl");
    expect(dl.querySelectorAll("dt")).toHaveLength(3);
    expect(dl.querySelectorAll("dd")).toHaveLength(3);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("explains an empty row and offers the next action instead of a placeholder", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { container } = render(<MetricList items={[{ label: "대기질", value: undefined, empty: { message: "측정소 응답 없음", onAction } }]} />);
    expect(screen.getByText("측정소 응답 없음")).toBeTruthy();
    expect(container.querySelector("dd").textContent.trim()).not.toMatch(/^[-\u2013\u2014]$/);
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("falls back to 데이터 없음 when a row has no value and no empty spec", () => {
    render(<MetricList items={[{ label: "하늘", value: undefined }]} />);
    expect(screen.getByText("데이터 없음")).toBeTruthy();
  });
});

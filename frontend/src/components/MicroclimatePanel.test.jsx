/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MicroclimatePanel, describeFreshness } from "./MicroclimatePanel.jsx";

// Fixture literal: RUN_TMP/qa/popup-baseline.json (GET /microclimate/elements/BLD_D4/popup).
const POPUP_BASELINE = {
  element_id: "BLD_D4",
  name: "공과대학 3호관",
  zone_id: "zone_D",
  element_type: "building",
  timestamp: "20261016T1100",
  data_note: {
    assumption_level: "estimated",
    material_source: "estimated_surface_library_v1",
    message: "현재 재질/복사 정보는 추정 기반 시뮬레이션 값이며, 추후 실측/정밀 모델로 교체될 수 있습니다.",
  },
  thermal: {
    local_temp: 22.0,
    feels_like: 21.8,
    utci: 23.9,
    wbgt: 18.0,
    risk_level: "낮음",
    stress_category: "열 스트레스 없음",
    risk_color: "#1976D2",
    risk_score: 0,
  },
  factors: {
    shade: { level: "높음", value: 0.391 },
    vegetation: { level: "낮음", value: 0.033 },
    wind: { level: "보통", value: 0.603 },
    radiation: { level: "낮음", value: 0.434 },
    material_heat: { level: "매우 높음", value: 0.8 },
  },
  delta: { temp: 1.9, label: "기준 기온 대비 +1.9°C" },
  reasons: ["복사열 높음 (+25°C) — 직달 일사의 영향", "풍속 거의 없음 — 열 체류"],
  material: {
    surface_type: "concrete",
    albedo: 0.22,
    surface_emissivity: 0.91,
    thermal_conductivity: 1.35,
    volumetric_heat_capacity: 2050000.0,
    moisture_availability: 0.04,
  },
  base_weather: { temperature: 20.1, humidity: 45.0, wind_speed: 0.8 },
};

const payload = (mutate = () => {}) => {
  const copy = JSON.parse(JSON.stringify(POPUP_BASELINE));
  mutate(copy);
  return copy;
};

const clockOf = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

afterEach(cleanup);

describe("MicroclimatePanel", () => {
  it("renders the full popup payload with every Legacy section and closes through onClose", () => {
    const onClose = vi.fn();
    render(<MicroclimatePanel data={payload()} onClose={onClose} />);

    expect(screen.getByRole("heading", { name: "공과대학 3호관" })).toBeTruthy();
    expect(screen.getByText("zone_D · 열 스트레스 없음")).toBeTruthy();
    for (const tile of ["22°C", "21.8°C", "23.9°C", "18°C"]) expect(screen.getByText(tile)).toBeTruthy();
    expect(screen.getByText("위험도").nextElementSibling.textContent).toBe("낮음");
    for (const factor of ["그늘", "녹지", "통풍", "복사"]) expect(screen.getByText(factor)).toBeTruthy();
    expect(screen.queryByText("재질열")).toBeNull();
    expect(screen.getByText(/기준 기온 대비 \+1\.9°C/)).toBeTruthy();
    expect(screen.getByText("원인 분석")).toBeTruthy();
    for (const reason of POPUP_BASELINE.reasons) expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.getByText("🌡 20.1°C")).toBeTruthy();
    expect(screen.getByText("💧 45%")).toBeTruthy();
    expect(screen.getByText("💨 0.8m/s")).toBeTruthy();
    expect(screen.queryByText("샘플 데이터")).toBeNull();
    expect(screen.queryByTestId("microclimate-freshness")).toBeNull();
    expect(screen.queryByText("기상 데이터 없음")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a payload without thermal (and a bare one) as 기상 데이터 없음 instead of throwing", () => {
    const withoutThermal = payload((p) => { delete p.thermal; });
    const first = render(<MicroclimatePanel data={withoutThermal} onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "공과대학 3호관" })).toBeTruthy();
    expect(screen.getByText("기상 데이터 없음")).toBeTruthy();
    expect(screen.getByText("zone_D")).toBeTruthy();
    expect(screen.queryByText("위험도")).toBeNull();
    expect(screen.queryByText("22°C")).toBeNull();
    expect(screen.getByText("그늘")).toBeTruthy();
    expect(screen.getByText("🌡 20.1°C")).toBeTruthy();
    first.unmount();

    expect(() => render(<MicroclimatePanel data={{ element_id: "BLD_X" }} onClose={() => {}} />)).not.toThrow();
    expect(screen.getByRole("heading", { name: "BLD_X" })).toBeTruthy();
    expect(screen.getByText("기상 데이터 없음")).toBeTruthy();
    expect(screen.getByText("추정")).toBeTruthy();
    expect(screen.queryByText("원인 분석")).toBeNull();
  });

  it("shows the stale freshness line with 샘플 데이터, and 관측 HH:mm while live", () => {
    const stale = payload((p) => {
      p.sample_data = true;
      p.freshness = {
        weather: { source: "cache", observed_at: "2026-10-16T10:30:00+09:00", fetched_at: "2026-10-16T10:53:00+09:00", age_seconds: 420, stale: true },
        forecast: null,
        air_quality: null,
      };
    });
    const view = render(<MicroclimatePanel data={stale} onClose={() => {}} />);

    const staleLine = screen.getByTestId("microclimate-freshness");
    expect(staleLine.textContent).toContain("저장된 기상 데이터 표시 중 · 7분 전");
    expect(staleLine.getAttribute("data-stale")).toBe("true");
    expect(screen.getByText("샘플 데이터")).toBeTruthy();

    const observedAt = "2026-10-16T11:00:00+09:00";
    const live = payload((p) => {
      p.freshness = {
        weather: { source: "live", observed_at: observedAt, fetched_at: "2026-10-16T11:02:10+09:00", age_seconds: 12, stale: false },
        forecast: null,
        air_quality: null,
      };
    });
    view.rerender(<MicroclimatePanel data={live} onClose={() => {}} />);

    const liveLine = screen.getByTestId("microclimate-freshness");
    expect(liveLine.textContent).toContain(`관측 ${clockOf(observedAt)}`);
    expect(liveLine.getAttribute("data-stale")).toBe("false");
    expect(screen.queryByText("샘플 데이터")).toBeNull();

    expect(describeFreshness(undefined)).toBeNull();
    expect(describeFreshness({ source: "live", observed_at: null, fetched_at: null, age_seconds: 0, stale: false })).toBeNull();
    expect(describeFreshness({ stale: true })).toEqual({ stale: true, text: "저장된 기상 데이터 표시 중" });
  });

  it("marks the title with a 추정 badge described by data_note.message", () => {
    const data = payload();
    const view = render(<MicroclimatePanel data={data} onClose={() => {}} />);

    const badge = screen.getByText("추정");
    expect(badge.getAttribute("title")).toBe(data.data_note.message);
    expect(badge.textContent).toContain(data.data_note.message);
    expect(badge.closest("[data-testid='microclimate-panel']")).not.toBeNull();

    view.rerender(<MicroclimatePanel data={payload((p) => { delete p.data_note; })} onClose={() => {}} />);
    const bare = screen.getByText("추정");
    expect(bare.getAttribute("title")).toBeNull();
    expect(bare.textContent).toBe("추정");
  });

  it("keeps the loading, error and empty states of the Legacy panel", () => {
    const view = render(<MicroclimatePanel data={null} loading title="BLD_D4" onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "BLD_D4" })).toBeTruthy();
    expect(screen.getByText("미기후 데이터 불러오는 중…")).toBeTruthy();
    expect(screen.queryByText("추정")).toBeNull();

    view.rerender(<MicroclimatePanel data={null} error="기상 서버에 연결할 수 없습니다" onClose={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("기상 서버에 연결할 수 없습니다");

    view.rerender(<MicroclimatePanel data={null} onClose={() => {}} />);
    expect(screen.getByText("이 건물의 상세 미기후 데이터를 선택해 확인하세요.")).toBeTruthy();
  });
});

/* @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionInspector, describeEstimate, describeFreshness } from "./SelectionInspector.jsx";

// Fixture literal: a GET /microclimate/elements/BLD_D4/popup response from the weather API (the popup contract's baseline keys).
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const popupOf = (state = {}) => ({ data: null, loading: false, error: null, errorStatus: null, errorDetail: null, lastData: null, retry: vi.fn(), ...state });
const show = (state, props = {}) => render(<SelectionInspector popup={popupOf(state)} onClose={() => {}} {...props} />);
const estimates = () => screen.getAllByText((_, el) => el?.dataset?.qa === "estimate-value");

describe("SelectionInspector", () => {
  it("titles the inspector with the registry name, not the payload name, and closes with the button or Esc", () => {
    const onClose = vi.fn();
    show({ data: payload() }, { title: "공대 3호관", onClose });
    expect(screen.getByRole("heading", { level: 3, name: "공대 3호관" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.keyDown(screen.getByRole("heading", { level: 3 }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows one 국지 기온 headline estimate with the risk badge, 열환경 open and one 요인 disclosure", () => {
    show({ data: payload() });
    const headline = document.querySelector('[data-qa="inspector-headline"]');
    const value = within(headline).getByText((_, el) => el?.dataset?.qa === "estimate-value");
    expect(value.textContent).toContain("22");
    expect(value.textContent).toContain("추정");
    expect(within(headline).getByText("낮음").dataset.tone).toBe("success");
    expect(estimates().map((el) => el.querySelector(".tabular-nums").textContent)).toEqual(["22", "21.8", "23.9", "18"]);
    const toggles = screen.getAllByRole("button", { expanded: false }).concat(screen.getAllByRole("button", { expanded: true }));
    expect(toggles.map((b) => b.textContent).sort()).toEqual(["열환경", "요인"].sort());
    expect(screen.getByRole("button", { name: "열환경" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("zone_D")).toBeTruthy();
    expect(screen.getByText("열 스트레스 없음")).toBeTruthy();
    for (const factor of ["그늘", "복사", "통풍", "녹지", "재질열"]) expect(screen.getByText(factor)).toBeTruthy();
    expect(screen.getByText(/기준 기온 대비 \+1\.9°C/)).toBeTruthy();
    for (const reason of POPUP_BASELINE.reasons) expect(screen.getByText(reason)).toBeTruthy();
    // 기준 기상(INV-170)은 현황 탭 현재 기상과 같은 값이라 인스펙터에 다시 두지 않는다.
    expect(screen.queryAllByText((_, el) => el?.dataset?.qa === "measured-value")).toHaveLength(0);
    expect(screen.queryByText("기준 기상")).toBeNull();
    expect(screen.queryByRole("button", { name: "링크 복사" })).toBeNull();
  });

  it("renders a payload without thermal (and a bare one) as 기상 데이터 없음 instead of throwing", () => {
    const first = show({ data: payload((p) => { delete p.thermal; }) });
    expect(screen.getAllByText("기상 데이터 없음").length).toBeGreaterThan(0);
    expect(screen.queryByText("위험도")).toBeNull();
    expect(screen.queryAllByText((_, el) => el?.dataset?.qa === "estimate-value")).toHaveLength(0);
    first.unmount();
    expect(() => show({ data: { element_id: "BLD_X" } })).not.toThrow();
    expect(screen.getByRole("heading", { level: 3, name: "BLD_X" })).toBeTruthy();
    expect(screen.getByTestId("microclimate-estimate-badge").textContent).toBe("추정");
  });

  it("shows the stale freshness line with 샘플 데이터, and 관측 HH:mm while live", () => {
    const stale = payload((p) => {
      p.sample_data = true;
      p.freshness = { weather: { source: "cache", observed_at: "2026-10-16T10:30:00+09:00", fetched_at: "2026-10-16T10:53:00+09:00", age_seconds: 420, stale: true } };
    });
    const view = render(<SelectionInspector popup={popupOf({ data: stale })} onClose={() => {}} />);
    expect(screen.getByTestId("microclimate-freshness").textContent).toContain("저장된 기상 데이터 표시 중 · 7분 전");
    expect(screen.getByText("샘플 데이터")).toBeTruthy();
    const observedAt = "2026-10-16T11:00:00+09:00";
    const live = payload((p) => { p.freshness = { weather: { source: "live", observed_at: observedAt, stale: false } }; });
    view.rerender(<SelectionInspector popup={popupOf({ data: live })} onClose={() => {}} />);
    expect(screen.getByTestId("microclimate-freshness").textContent).toContain(`관측 ${clockOf(observedAt)}`);
    expect(describeFreshness(undefined)).toBeNull();
    expect(describeFreshness({ stale: true })).toEqual({ stale: true, text: "저장된 기상 데이터 표시 중" });
  });

  it("marks the title with a 추정 badge described by data_note.message and keeps the code badge neutral", () => {
    const data = payload();
    show({ data });
    const badge = screen.getByTestId("microclimate-estimate-badge");
    expect(badge.getAttribute("title")).toBe(data.data_note.message);
    expect(screen.getByText("D4").dataset.tone).toBe("neutral");
  });

  it("shows a skeleton at once and one named spinner only after 1 s", () => {
    vi.useFakeTimers();
    show({ loading: true }, { title: "도서관" });
    expect(screen.getAllByText((_, el) => el?.dataset?.qa === "skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("미기후 추정 가져오는 중")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getAllByRole("status").filter((el) => el.textContent.includes("미기후 추정 가져오는 중"))).toHaveLength(1);
  });

  it("offers one 다시 시도 that calls refetch, a copyable detail, and keeps the last values with a stale badge", () => {
    const retry = vi.fn();
    show({ error: "기상 서버에 연결할 수 없습니다", errorDetail: "BLD_D4: Failed to fetch", retry, lastData: payload() });
    const alert = screen.getByRole("alert");
    expect(alert.dataset.source).toBe("selection-popup");
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(within(alert).getByRole("button", { name: "자세히" }));
    expect(within(alert).getByText("BLD_D4: Failed to fetch")).toBeTruthy();
    expect(estimates()).toHaveLength(4);
    expect(document.querySelector('[data-qa="inspector-stale"]').textContent).toBe("저장된 값");
  });

  it("renders the 404 empty state with its 전체 보기 action instead of an error", () => {
    const onShowAll = vi.fn();
    show({ error: "이 건물의 미기후 데이터가 없습니다", errorStatus: 404 }, { title: "학군단", onShowAll });
    expect(screen.queryByRole("alert")).toBeNull();
    const line = document.querySelector('[data-qa="inspector-not-found"]');
    expect(line.nextElementSibling).toBe(document.querySelector('[data-qa="inspector-empty"]'));
    expect(screen.getByText("이 건물의 미기후 추정 데이터가 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it("offers 실내 보기 and the comparison button only when the caller passes them", () => {
    const onOpenIndoor = vi.fn();
    const view = show({ data: payload() });
    expect(document.querySelector('[data-qa="d4-open"]')).toBeNull();
    view.rerender(<SelectionInspector popup={popupOf({ data: payload() })} onClose={() => {}} onOpenIndoor={onOpenIndoor} compare={<button type="button">비교 열기 (1)</button>} />);
    fireEvent.click(screen.getByRole("button", { name: "실내 보기" }));
    expect(onOpenIndoor).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "비교 열기 (1)" })).toBeTruthy();
  });

  it("shows the gate distance line when given", () => {
    show({ data: payload() }, { gateText: "정문에서 추정 직선 거리 250 m · 북" });
    expect(document.querySelector('[data-qa="gate-distance"]').textContent).toBe("정문에서 추정 직선 거리 250 m · 북");
  });
});

// GLB extras -> 추정 caption (ported from MicroclimatePanel.estimate.test.jsx).
const caption = () => document.querySelector('[data-qa="estimate-caption"]');
describe("SelectionInspector 추정 caption", () => {

  it("shows the caption for a floors x median height", () => {
    render(<SelectionInspector popup={popupOf()} onClose={() => {}} title="학군단" estimate={{ heightLineage: "floors x median", footprintEstimated: false, formEstimated: false }} />);
    expect(caption()).not.toBeNull();
    expect(describeEstimate({ heightLineage: "floors x median" })).toBe(describeEstimate({ heightLineage: "vr-floors x median", footprintEstimated: true }));
  });

  it("has no caption for a GIS height without estimated flags", () => {
    render(<SelectionInspector popup={popupOf()} onClose={() => {}} title="공과대학 3호관" estimate={{ heightLineage: "gis-height", footprintEstimated: false, formEstimated: false }} />);
    expect(caption()).toBeNull();
  });

  it("uses the form-only caption when the height is from GIS but the footprint is estimated", () => {
    const formOnly = describeEstimate({ heightLineage: "gis-height", footprintEstimated: true, formEstimated: false });
    expect(formOnly).not.toBeNull();
    expect(formOnly).not.toBe(describeEstimate({ heightLineage: "assumed" }));
  });

  it("has no caption without GLB extras (VWorld or ?model=uni)", () => {
    render(<SelectionInspector popup={popupOf()} onClose={() => {}} title="BLD_D4" />);
    expect(caption()).toBeNull();
  });

  it("shows an estimate caption when only the facade is estimated", () => {
    render(<SelectionInspector popup={popupOf()} onClose={() => {}} title="사범대학" estimate={{ heightLineage: "gis-height", facadeEstimated: true }} />);
    expect(caption()).not.toBeNull();
    expect(describeEstimate({ heightLineage: "gis-height", facadeEstimated: true })).not.toBe(describeEstimate({ heightLineage: "gis-height" }));
  });
});

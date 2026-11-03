/* @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPARISON_NEEDS_TWO } from "../state/useComparisonSet.mjs";
import { rememberPopup } from "../state/popupCache.mjs";
import { CompareButton, ComparisonPane } from "./ComparisonPane.jsx";

const comparison = (ids) => ({ ids, status: "", canCompare: ids.length >= 2, setOpen: vi.fn() });
const payload = (temp) => ({ thermal: { local_temp: temp, feels_like: temp + 1 }, factors: { radiation: { level: "낮음" }, wind: { level: "보통" } } });

describe("CompareButton", () => {
  afterEach(cleanup);

  it("stays dimmed with its reason in title and aria-describedby until two buildings are chosen", () => {
    render(<CompareButton comparison={comparison(["BLD_C1"])} />);
    const button = screen.getByRole("button", { name: /비교 1\/3/ });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("title")).toBe(COMPARISON_NEEDS_TWO);
    expect(document.getElementById(button.getAttribute("aria-describedby")).textContent).toBe(COMPARISON_NEEDS_TWO);
  });

  it("opens once two buildings are chosen", () => {
    const value = comparison(["BLD_C1", "BLD_E1"]);
    render(<CompareButton comparison={value} />);
    const button = screen.getByRole("button", { name: /비교 2\/3/ });
    expect(button.getAttribute("aria-disabled")).toBeNull();
    button.click();
    expect(value.setOpen).toHaveBeenCalledWith(true);
  });
});

describe("ComparisonPane", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders one column per building and one row per headline estimate, each flagged 추정", async () => {
    rememberPopup("BLD_C1", payload(21.4));
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload(19.2)) }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<ComparisonPane ids={["BLD_C1", "BLD_E1_TEST"]} nameOf={(id) => ({ BLD_C1: "도서관", BLD_E1_TEST: "학생회관" })[id]} onRemove={vi.fn()} onClose={vi.fn()} />);
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers[0]).toBe("항목");
    expect(headers[1]).toContain("도서관");
    expect(headers[2]).toContain("학생회관");
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["국지 기온", "체감", "일사(복사)", "통풍"]);
    await waitFor(() => expect(within(table).getAllByText(/19\.2/).length).toBeGreaterThan(0));
    // 도서관은 인스펙터가 이미 받은 응답(캐시)을 쓰고, 학생회관만 한 번 요청한다.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/microclimate\/elements\/BLD_E1_TEST\/popup$/);
    expect(table.querySelectorAll('[data-qa="estimate-value"]').length).toBe(8);
  });
});

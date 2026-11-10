/* @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchField } from "./SearchField.jsx";

afterEach(cleanup);

// 최근 검색을 브라우저에 남기는 저장 키(바뀌면 사용자의 기존 기록이 사라진다).
const RECENT_SEARCHES_KEY = "scnu.recentSearches";

const REGISTRY = new Map([
  ["BLD_C1", { elementId: "BLD_C1", displayName: "도서관", code: "C1", tier: 1, aliases: ["도서관", "C1"] }],
  ["BLD_D4", { elementId: "BLD_D4", displayName: "공과대학 3호관", code: "D4", tier: 1, shortName: "공대 3호관", aliases: ["D4"] }],
  ["BLD_A3", { elementId: "BLD_A3", displayName: "천연물신약연구소", code: "A3", tier: 2, aliases: [] }],
]);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), data };
}

describe("SearchField", () => {
  it("is a combobox whose listbox groups results by tier, and Enter picks the first result", () => {
    const onPick = vi.fn();
    const storage = memoryStorage();
    const { container } = render(<SearchField registry={REGISTRY} onPick={onPick} storage={storage} />);
    expect(container.querySelector('[data-qa="search-field"] input[type="search"]')).not.toBeNull();
    const input = screen.getByRole("combobox", { name: "건물 검색" });
    fireEvent.change(input, { target: { value: "도서관" } });
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByRole("group", { name: "주요 건물" })).toBeTruthy();
    const options = within(listbox).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["C1도서관"]);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(REGISTRY.get("BLD_C1"));
    expect(input.value).toBe("");
    expect(JSON.parse(storage.data.get(RECENT_SEARCHES_KEY))).toEqual(["BLD_C1"]);
  });

  it("moves through results with the arrow keys and picks by click", () => {
    const onPick = vi.fn();
    render(<SearchField registry={REGISTRY} onPick={onPick} storage={memoryStorage()} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(options[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("shows the last searches on focus, newest first", () => {
    const storage = memoryStorage({ [RECENT_SEARCHES_KEY]: JSON.stringify(["BLD_D4", "BLD_GONE", "BLD_C1"]) });
    render(<SearchField registry={REGISTRY} onPick={vi.fn()} storage={storage} />);
    fireEvent.focus(screen.getByRole("combobox"));
    const recent = screen.getByRole("group", { name: "최근 검색" });
    expect(within(recent).getAllByRole("option").map((o) => o.textContent)).toEqual(["D4공과대학 3호관", "C1도서관"]);
  });

  it("explains an empty result, suggests a close name and does nothing on Enter; Escape clears", () => {
    const onPick = vi.fn();
    render(<SearchField registry={REGISTRY} onPick={onPick} storage={memoryStorage()} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "도서곤" } });
    expect(screen.getByText("'도서곤'에 맞는 건물이 없습니다. '도서관'을(를) 찾으시나요?")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
  });
});

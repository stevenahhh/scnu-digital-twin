/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/D4WingFloorSelect", () => ({
  D4WingFloorSelect: ({ onSelectFloor, beforeList }) => (
    <div>
      <button onClick={() => onSelectFloor("left", 2)}>2층 선택</button>
      {beforeList}
      <div>사용 중인 강의실</div>
    </div>
  ),
}));
vi.mock("../components/D4RoomGridSelect", () => ({
  D4RoomGridSelect: ({ selectedRoom, onSelectRoom }) => (
    <div data-testid="room-grid">
      <button onClick={() => onSelectRoom("d4-left-21-204")}>204호 선택</button>
      {selectedRoom && <h2>D4 {selectedRoom.roomNumber.replace("21-", "")}</h2>}
    </div>
  ),
}));
vi.mock("../features/energy/editor/RoofEditor", () => ({ RoofEditor: ({ installationPlanId, onPlanSaved }) => <div>옥상 설치 편집기 {installationPlanId}<button onClick={() => onPlanSaved?.({ id: installationPlanId })}>편집 저장</button></div> }));
vi.mock("../features/energy/installations/InstallationPlanManager", () => ({ InstallationPlanManager: ({ onEditPlan, onPlansChange, onRepresentativeChange }) => <div>설치 계획 관리자<button onClick={() => onEditPlan({ id: "plan-2" })}>대안 편집</button><button onClick={() => onPlansChange(["plan-2"])}>목록 발행</button><button onClick={() => onRepresentativeChange({ installationPlanId: "plan-2" })}>대표 발행</button></div> }));
import { D4SectionExperience } from "./D4SectionExperience";


afterEach(cleanup);

const crumbs = () => [...screen.getByRole("navigation", { name: "breadcrumb" }).querySelectorAll("li")].map((li) => li.textContent.replace("›", "").trim());

describe("D4SectionExperience pane", () => {
  const outsideButtons = [];
  const addOutsideButton = (label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    document.body.appendChild(button);
    outsideButtons.push(button);
    return button;
  };
  afterEach(() => {
    outsideButtons.splice(0).forEach((button) => button.remove());
  });

  it("is a non-modal pane with one header: 상위로 and the breadcrumb, with no wheel exit", () => {
    const { container } = render(<D4SectionExperience onClose={vi.fn()} />);
    const pane = screen.getByRole("dialog");
    expect(pane.getAttribute("aria-modal")).toBe("false");
    expect(pane.closest(".fixed")).toBeNull();
    expect(pane.getAttribute("onwheel")).toBeNull();
    expect(screen.queryByRole("button", { name: /지도$/ })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^(상위로|캠퍼스 지도로 돌아가기)$/ })).toHaveLength(2);
    expect(crumbs()).toEqual(["캠퍼스", "공과대학 3호관D4"]);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("공과대학 3호관D4");
    expect(container.textContent.indexOf("사용 중인 강의실")).toBeLessThan(container.textContent.indexOf("설치 계획"));
  });

  it("keeps the plan tools in a collapsed 설치 계획 disclosure after the room list", async () => {
    const user = userEvent.setup();
    render(<D4SectionExperience onClose={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: "설치 계획" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("설치 계획 관리자")).toBeNull();
    await user.click(toggle);
    expect(screen.getByText("설치 계획 관리자")).toBeTruthy();
  });

  it("walks room -> floor -> building -> campus with Escape and the breadcrumb", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<D4SectionExperience onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "2층 선택" }));
    await user.click(screen.getByRole("button", { name: "204호 선택" }));
    expect(crumbs()).toHaveLength(4);
    expect(crumbs().slice(0, 2)).toEqual(["캠퍼스", "공과대학 3호관D4"]);
    expect(crumbs()[2]).toMatch(/2층$/);
    expect(crumbs()[3]).toMatch(/^D4 /);
    await user.keyboard("{Escape}");
    expect(crumbs()).toHaveLength(3);
    await user.keyboard("{Escape}");
    expect(crumbs()).toHaveLength(2);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "2층 선택" }));
    await user.click(screen.getByRole("button", { name: "캠퍼스 지도로 돌아가기" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("goes up one level with 상위로", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<D4SectionExperience onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "2층 선택" }));
    await user.click(screen.getByRole("button", { name: "상위로" }));
    expect(crumbs()).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "상위로" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape to the roof editor while it is open", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<D4SectionExperience onClose={onClose} startInstallation />);
    await user.click(screen.getByRole("button", { name: "대안 편집" }));
    expect(screen.getByText(/옥상 설치 편집기 plan-2/)).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers every campus preset from the pane when presets are given (phone)", async () => {
    const user = userEvent.setup();
    const onSelectPreset = vi.fn();
    const presets = [{ id: "overview", title: "전체" }, { id: "library", title: "도서관", shortName: "도서관" }];
    render(<D4SectionExperience onClose={vi.fn()} presets={presets} onSelectPreset={onSelectPreset} />);
    const nav = screen.getByRole("navigation", { name: "캠퍼스 시점" });
    expect([...nav.querySelectorAll("button")].map((b) => b.dataset.qa)).toEqual(["camera-preset-overview", "camera-preset-library"]);
    await user.click(screen.getByRole("button", { name: "도서관" }));
    expect(onSelectPreset).toHaveBeenCalledWith(presets[1]);
  });

  it("publishes plan list, representative, and editor save changes from building detail", async () => {
    const user = userEvent.setup();
    const onPlansChange = vi.fn();
    const onRepresentativeChange = vi.fn();
    const onPlanSaved = vi.fn();
    render(<D4SectionExperience onClose={vi.fn()} onPlansChange={onPlansChange} onRepresentativeChange={onRepresentativeChange} onPlanSaved={onPlanSaved} startInstallation />);
    await user.click(screen.getByRole("button", { name: "목록 발행" }));
    await user.click(screen.getByRole("button", { name: "대표 발행" }));
    await user.click(screen.getByRole("button", { name: "대안 편집" }));
    await user.click(screen.getByRole("button", { name: "편집 저장" }));
    expect(onPlansChange).toHaveBeenCalledWith(["plan-2"]);
    expect(onRepresentativeChange).toHaveBeenCalledWith({ installationPlanId: "plan-2" });
    expect(onPlanSaved).toHaveBeenCalledWith({ id: "plan-2" });
  });
  it("returns focus to the opener when the dialog unmounts", () => {
    const opener = addOutsideButton("열기");
    opener.focus();
    const { unmount } = render(<D4SectionExperience onClose={vi.fn()} />);
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
  });
  it("falls back to returnFocusRef when the opener has left the DOM", () => {
    const opener = addOutsideButton("열기");
    const fallback = addOutsideButton("대체 포커스");
    opener.focus();
    const { unmount } = render(<D4SectionExperience onClose={vi.fn()} returnFocusRef={{ current: fallback }} />);
    opener.remove();
    expect(opener.isConnected).toBe(false);
    unmount();
    expect(document.activeElement).toBe(fallback);
  });
  it("keeps returning focus while the opener cannot take it yet, then stops once it has it", async () => {
    const opener = addOutsideButton("열기");
    opener.focus();
    const { unmount } = render(<D4SectionExperience onClose={vi.fn()} />);
    // Legacy 캠퍼스 라벨처럼 닫히는 순간에는 아직 포커스를 받을 수 없는 열기 요소를 흉내 낸다.
    opener.disabled = true;
    unmount();
    expect(document.activeElement).not.toBe(opener);
    opener.disabled = false;
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

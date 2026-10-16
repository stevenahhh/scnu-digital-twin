/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/D4WingFloorSelect", () => ({
  D4WingFloorSelect: ({ onSelectFloor }) => <button onClick={() => onSelectFloor("left", 2)}>2층 선택</button>,
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
import { FOCUSABLE_SELECTOR } from "../components/AccessibleDialog";

afterEach(cleanup);

describe("D4SectionExperience modes", () => {
  it("preserves room selection while installation mode remains separate", async () => {
    const user = userEvent.setup();
    render(<D4SectionExperience onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "2층 선택" }));
    await user.click(screen.getByRole("button", { name: "204호 선택" }));
    expect(screen.getByRole("heading", { name: "D4 204" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "태양광 설치" }));
    expect(screen.getByText("설치 계획 관리자")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "대안 편집" }));
    expect(screen.getByText(/옥상 설치 편집기 plan-2/)).toBeTruthy();
    expect(screen.queryByTestId("room-grid")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "공간 탐색" }));
    expect(screen.getByRole("heading", { name: "D4 204" })).toBeTruthy();
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

  it("exits the dialog with Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<D4SectionExperience onClose={onClose} />);
    await user.keyboard("{Escape}");
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

  it("switches and focuses mode tabs with ArrowRight", async () => {
    const user = userEvent.setup();
    render(<D4SectionExperience onClose={vi.fn()} />);
    const roomsTab = screen.getByRole("tab", { name: "공간 탐색" });
    roomsTab.focus();
    await user.keyboard("{ArrowRight}");
    const installationTab = screen.getByRole("tab", { name: "태양광 설치" });
    expect(installationTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(installationTab);
    expect(installationTab.getAttribute("aria-controls")).toBeTruthy();
  });
});

describe("D4SectionExperience focus", () => {
  // 다이얼로그 밖의 버튼은 React 바깥에서 만들어 테스트 안에서 자유롭게 DOM에서 떼어낼 수 있게 한다.
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

  it("moves focus onto the selected mode tab inside the dialog when it opens", () => {
    const opener = addOutsideButton("열기");
    opener.focus();
    expect(document.activeElement).toBe(opener);
    render(<D4SectionExperience onClose={vi.fn()} />);
    const selectedTab = screen.getByRole("tab", { selected: true });
    expect(selectedTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(selectedTab);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
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

  it("wraps Tab and Shift+Tab between the first and last focusable controls", () => {
    render(<D4SectionExperience onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll(FOCUSABLE_SELECTOR);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(first).not.toBe(last);
    last.focus();
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(first);
    first.focus();
    expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);
  });
});

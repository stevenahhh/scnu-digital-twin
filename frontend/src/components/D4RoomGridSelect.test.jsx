/* @vitest-environment happy-dom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./D4RoomGridScene", () => ({ D4RoomGridScene: () => null }));
import { D4RoomGridSelect } from "./D4RoomGridSelect";

afterEach(cleanup);

const wing = { id: "left", label: "실험동", floors: 6, hasBasement: false };
const room = {
  id: "d4-left-21-301",
  roomNumber: "21-301",
  specialLabel: "강의실",
  sizeLabel: "중형",
  timetable: [],
  hasLargeScreen: false,
  computerCount: 0,
  savingRate: 12,
  weeklySavingsKwh: 22,
};
const status = { isInUse: false, statusText: "현재 공실", hvacRunning: false, hvacText: "냉난방기 대기", currentClass: null, nextClass: null };

describe("D4 room detail", () => {
  it("marks the sample occupancy, HVAC and savings values as sample estimates", () => {
    render(
      <D4RoomGridSelect
        building={{ displayName: "공과대학 3호관", wings: [wing] }}
        wing={wing}
        floor={3}
        rooms={[room]}
        roomUsageById={new Map()}
        selectedRoom={room}
        selectedRoomStatus={status}
        onSelectRoom={() => {}}
        onChangeWing={() => {}}
        onChangeFloor={() => {}}
        onBack={() => {}}
      />,
    );
    const badge = screen.getByTestId("d4-sample-badge");
    expect(within(badge).getByText("샘플 데이터")).toBeTruthy();
    expect(screen.getByText("주간 에너지 절감 (추정)")).toBeTruthy();
  });
});

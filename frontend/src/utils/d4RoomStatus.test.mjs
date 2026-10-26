import assert from "node:assert/strict";
import test from "node:test";
import { D4_BUILDING_DATA, D4_ROOMS } from "./d4BuildingData.mjs";
import { describeTodaySchedule, formatEquipmentLabel, getCurrentRoomStatus } from "./d4RoomStatus.mjs";

test("reports a scheduled D4 classroom as occupied", () => {
  const room = D4_ROOMS.find((candidate) => candidate.timetable.length > 0);
  assert.ok(room);
  const scheduledClass = room.timetable[0];
  const weekdayIndex = ["일", "월", "화", "수", "목", "금", "토"].indexOf(
    scheduledClass.day,
  );
  const date = new Date(2026, 6, 19 + weekdayIndex, scheduledClass.startHour, 0);

  const status = getCurrentRoomStatus(room, date);

  assert.equal(status.isInUse, true);
  assert.equal(status.currentClass?.subject, scheduledClass.subject);
  assert.equal(status.statusText, "현재 수업 중");
});

test("keeps the D4 server room in its always-on state", () => {
  const serverRoom = D4_ROOMS.find((room) => room.specialType === "server");
  assert.ok(serverRoom);

  const status = getCurrentRoomStatus(serverRoom, new Date(2026, 6, 19, 3, 0));

  assert.equal(status.isInUse, true);
  assert.equal(status.statusText, "상시 가동");
  assert.equal(status.hvacText, "냉난방기 가동 중");
});

test("provides section geometry and exposes the basement inventory", () => {
  assert.ok(D4_BUILDING_DATA.floors.some((floor) => floor.floor === 0));
  assert.ok(D4_ROOMS.some((room) => room.floor === 0));
  assert.ok(D4_ROOMS.every((room) => (
    Number.isFinite(room.geometry.x)
    && Number.isFinite(room.geometry.z)
    && room.geometry.width > 0
    && room.geometry.depth > 0
  )));
});

test("formats the room equipment line with one rule per case", () => {
  assert.equal(formatEquipmentLabel({ hasLargeScreen: true, computerCount: 30 }), "대형 스크린, 빔프로젝터");
  assert.equal(formatEquipmentLabel({ hasLargeScreen: false, computerCount: 30 }), "PC 30대");
  assert.equal(formatEquipmentLabel({ hasLargeScreen: false, computerCount: 0 }), "없음");
});

test("describes today's schedule from the current class, then the next one", () => {
  const current = { startHour: 9, durationHours: 2, subject: "구조역학" };
  assert.equal(describeTodaySchedule({ currentClass: current, nextClass: null }), "9:00 - 11:00 구조역학");
  assert.equal(describeTodaySchedule({ currentClass: null, nextClass: { startHour: 13, subject: "설계" } }), "13:00 예정 · 설계");
  assert.equal(describeTodaySchedule({ currentClass: null, nextClass: null }), "오늘 예정 없음");
});

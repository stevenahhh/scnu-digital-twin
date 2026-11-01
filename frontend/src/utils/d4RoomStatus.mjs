import { WEEKDAY_LABELS } from "../features/energy/domain/contracts.mjs";
import { findOccupancyEvent } from "../features/energy/domain/demand.mjs";

export function isRoomInUse(room, date) {
  return getCurrentRoomStatus(room, date).isInUse;
}

export function getCurrentRoomStatus(room, date) {
  const weekday = WEEKDAY_LABELS[date.getDay()];
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const currentClass = findOccupancyEvent(room, weekday, minuteOfDay);
  const nextClass = room.timetable.find((event) => event.day === weekday && event.startMinute >= date.getHours() * 60);
  const isAlwaysOn = room.specialType === "server";
  const isInUse = Boolean(currentClass) || isAlwaysOn;

  return {
    isInUse,
    currentClass,
    nextClass,
    hvacRunning: isInUse && room.specialType !== "faculty",
    statusText: currentClass ? "\uD604\uC7AC \uC218\uC5C5 \uC911" : isAlwaysOn ? "\uC0C1\uC2DC \uAC00\uB3D9" : "\uD604\uC7AC \uACF5\uC2E4",
    hvacText: isInUse && room.specialType !== "faculty" ? "\uB0C9\uB09C\uBC29\uAE30 \uAC00\uB3D9 \uC911" : "\uB0C9\uB09C\uBC29\uAE30 \uB300\uAE30",
  };
}

// 강의실 특수 설비 한 줄: 대형 스크린이 먼저, 없으면 PC 대수, 둘 다 없으면 `없음`.
export function formatEquipmentLabel(room) {
  if (room.hasLargeScreen) return "대형 스크린, 빔프로젝터";
  if (room.computerCount) return `PC ${room.computerCount}대`;
  return "없음";
}

// 오늘 일정 한 줄: 진행 중인 수업, 없으면 다음 수업, 둘 다 없으면 `오늘 예정 없음`.
export function describeTodaySchedule(status) {
  const { currentClass, nextClass } = status;
  if (currentClass) {
    return `${currentClass.startHour}:00 - ${currentClass.startHour + currentClass.durationHours}:00 ${currentClass.subject}`;
  }
  if (nextClass) return `${nextClass.startHour}:00 예정 · ${nextClass.subject}`;
  return "오늘 예정 없음";
}

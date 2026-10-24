import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronDown } from "lucide-react";
import { D4RoomGridScene } from "./D4RoomGridScene";
import { getFloorMajor, formatRoomNumber } from "../utils/d4BuildingData.mjs";
import { D4SampleBadge } from "./D4SampleBadge";

function ScheduleList({ timetable }) {
  if (timetable.length === 0) {
    return (
      <div className="rounded-lg bg-[var(--colors-surface-2)] p-4 text-sm font-[700] text-[var(--colors-ink-muted)]">
        등록된 강의 시간이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {timetable.map((item) => (
        <div
          key={`${item.day}-${item.startHour}-${item.subject}`}
          className="rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] p-3"
        >
          <div className="text-[13px] font-[900] text-[var(--colors-ink)]">{item.subject}</div>
          <div className="mt-1 text-[12px] font-[700] text-[var(--colors-ink-muted)]">
            {item.day}요일 {item.startHour}:00-{item.startHour + item.durationHours}:00 · {item.professorId}
          </div>
        </div>
      ))}
    </div>
  );
}

function RoomDetailCard({ room, status, onBack }) {
  const [view, setView] = useState("detail");

  if (!room) {
    return (
      <div className="rounded-[16px] border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] p-5 text-[13px] font-[700] text-[var(--colors-ink-subtle)] shadow-lg">
        강의실을 선택하면 상세 정보가 표시됩니다.
      </div>
    );
  }

  const scheduleLine = status.currentClass
    ? `${status.currentClass.startHour}:00 - ${status.currentClass.startHour + status.currentClass.durationHours}:00 ${status.currentClass.subject}`
    : status.nextClass
      ? `${status.nextClass.startHour}:00 예정 · ${status.nextClass.subject}`
      : "오늘 예정 없음";
  const hvacTemp = status.hvacRunning ? 24 : null;

  return (
    <div className="rounded-[16px] border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] p-5 shadow-lg">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-[900] uppercase tracking-[0.08em] text-[var(--colors-primary)]">
            {view === "schedule" ? "Room Schedule" : "Room Detail"}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xl font-[900] text-[var(--colors-ink)]">
            D4 {formatRoomNumber(room.roomNumber)}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-[800] ${status.isInUse ? "bg-[var(--colors-primary)] text-white" : "bg-[var(--colors-surface-2)] text-[var(--colors-ink-subtle)]"}`}
            >
              {status.isInUse ? "사용 중" : "미사용"}
            </span>
            <D4SampleBadge />
          </div>
        </div>
        {view === "schedule" ? (
          <button
            type="button"
            onClick={() => setView("detail")}
            className="rounded-md border border-[var(--colors-hairline)] p-2 text-[var(--colors-ink-muted)] hover:text-[var(--colors-ink)]"
          >
            <ArrowLeft size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border border-[var(--colors-hairline)] p-2 text-[var(--colors-ink-muted)] hover:text-[var(--colors-ink)]"
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {view === "schedule" ? (
        <ScheduleList timetable={room.timetable} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-[var(--colors-surface-2)] p-3">
              <div className="text-[12px] font-[700] text-[var(--colors-ink-muted)]">실 이름</div>
              <div className="mt-1 text-[13px] font-[900] text-[var(--colors-ink)]">{room.specialLabel}</div>
            </div>
            <div className="rounded-lg bg-[var(--colors-surface-2)] p-3">
              <div className="text-[12px] font-[700] text-[var(--colors-ink-muted)]">규모</div>
              <div className="mt-1 text-[13px] font-[900] text-[var(--colors-ink)]">{room.sizeLabel}</div>
            </div>
            <div className="rounded-lg bg-[var(--colors-surface-2)] p-3">
              <div className="text-[12px] font-[700] text-[var(--colors-ink-muted)]">현재 상태</div>
              <div className="mt-1 flex items-center gap-1.5 text-[13px] font-[900] text-[var(--colors-ink)]">
                <span className={`h-2 w-2 rounded-full ${status.isInUse ? "bg-[var(--colors-primary)]" : "bg-[var(--colors-ink-tertiary)]"}`} />
                {status.statusText}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--colors-surface-2)] p-3">
              <div className="text-[12px] font-[700] text-[var(--colors-ink-muted)]">냉난방 상태</div>
              <div className="mt-1 text-[13px] font-[900] text-[var(--colors-ink)]">
                {status.hvacRunning ? `냉방 중 (${hvacTemp}°C)` : status.hvacText}
              </div>
            </div>
          </div>
          <div className="rounded-lg bg-[var(--colors-surface-2)] p-3">
            <div className="text-[12px] font-[700] text-[var(--colors-ink-muted)]">특수 설비</div>
            <div className="mt-1 text-[13px] font-[900] text-[var(--colors-ink)]">
              {room.hasLargeScreen ? "대형 스크린, 빔프로젝터" : room.computerCount ? `PC ${room.computerCount}대` : "없음"}
            </div>
          </div>
          <div className="rounded-lg bg-[var(--colors-surface-2)] p-3">
            <div className="text-[12px] font-[700] text-[var(--colors-ink-muted)]">오늘 일정</div>
            <div className="mt-1 text-[13px] font-[900] text-[var(--colors-ink)]">{scheduleLine}</div>
          </div>
          <div className="rounded-lg bg-[var(--colors-surface-2)] p-3">
            <div className="flex items-center justify-between text-[13px] font-[900] text-[var(--colors-ink)]">
              <span>주간 에너지 절감 (추정)</span>
              <span className="text-[var(--colors-primary)]">
                {room.savingRate.toFixed(1)}% ({room.weeklySavingsKwh.toFixed(1)} kWh)
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setView("schedule")}
            className="w-full rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] px-4 py-3 text-sm font-[900] text-[var(--colors-ink)] hover:bg-[var(--colors-surface-3)]"
          >
            강의실 시간표 보기
          </button>
        </div>
      )}
    </div>
  );
}

export function D4RoomGridSelect({
  building,
  wing,
  floor,
  rooms,
  roomUsageById,
  selectedRoom,
  selectedRoomStatus,
  onSelectRoom,
  onChangeWing,
  onChangeFloor,
  onBack,
}) {
  return (
    // lg 미만에서는 장면 열 아래에 상세 카드를 쌓고(order-last) 이 루트가 세로 스크롤을 맡는다.
    // 스크롤 클래스는 max-lg 변형으로만 붙인다: 루트에 `overflow-y-auto`를 그대로 쓰면
    // D4SectionExperience의 휠 종료 판정(closest(".overflow-y-auto"))이 데스크톱에서도 막힌다.
    <div className="flex h-full w-full flex-col items-center gap-6 px-4 py-6 max-lg:overflow-y-auto lg:flex-row lg:justify-center lg:py-0">
      <div className="order-last w-full shrink-0 lg:order-none lg:w-[20vw] lg:min-w-[320px] lg:max-w-[400px]">
        <RoomDetailCard room={selectedRoom} status={selectedRoomStatus} onBack={onBack} />
      </div>

      <div className="flex w-full min-w-0 flex-col items-center gap-5 lg:h-full lg:flex-1 lg:justify-center">
        <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 justify-self-start whitespace-nowrap rounded-md border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] px-3 py-2 text-[13px] font-[700] text-[var(--colors-ink-muted)] transition hover:text-[var(--colors-ink)] hover:bg-[var(--colors-surface-2)]"
          >
            <ChevronLeft size={16} />
            D4 건물 내부 보기
          </button>
          <div className="text-center text-lg font-[900] text-[var(--colors-ink)]">{building.displayName}</div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] p-1">
            {building.wings.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onChangeWing(w.id)}
                className={`rounded-md px-4 py-1.5 text-[13px] font-[800] transition-colors ${
                  wing.id === w.id
                    ? "bg-[var(--colors-primary)] text-white shadow-sm"
                    : "text-[var(--colors-ink-subtle)] hover:text-[var(--colors-ink)]"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <select
              value={floor}
              onChange={(event) => onChangeFloor(Number(event.target.value))}
              className="appearance-none rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] px-4 py-2 pr-8 text-[13px] font-[800] text-[var(--colors-ink)]"
            >
              {(wing.hasBasement
                ? [0, ...Array.from({ length: wing.floors }, (_, i) => i + 1)]
                : Array.from({ length: wing.floors }, (_, i) => i + 1)
              ).map((f) => (
                <option key={f} value={f}>
                  {wing.label} {f === 0 ? "B1" : `${f}층`}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--colors-ink-subtle)]" />
          </div>
        </div>

        {getFloorMajor(wing.id, floor) && (
          <div className="text-[12px] font-[700] text-[var(--colors-ink-subtle)]">
            {wing.label} {floor === 0 ? "B1" : `${floor}층`} · {getFloorMajor(wing.id, floor)}
          </div>
        )}

        {rooms.length === 0 ? (
          <div className="w-full max-w-[700px] rounded-lg border border-dashed border-[var(--colors-hairline)] px-6 py-8 text-center text-[13px] font-[700] text-[var(--colors-ink-subtle)]">
            이 층에는 등록된 강의실이 없습니다.
          </div>
        ) : (
          <div className="h-[32vh] min-h-[220px] w-full max-w-[900px] lg:h-[56vh] lg:min-w-[500px]">
            <D4RoomGridScene
              rooms={rooms}
              roomUsageById={roomUsageById}
              selectedRoomId={selectedRoom?.id}
              onSelectRoom={onSelectRoom}
            />
          </div>
        )}
      </div>
    </div>
  );
}

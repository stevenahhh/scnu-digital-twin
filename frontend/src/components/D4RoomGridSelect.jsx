import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { D4RoomGridScene } from "./D4RoomGridScene";
import { D4SampleBadge } from "./D4SampleBadge";
import { D4ScrollRoot } from "./D4ScrollRoot";
import { D4_CARD, floorLabel, floorLevels } from "./d4Shared.mjs";
import { getFloorMajor, formatRoomNumber } from "../utils/d4BuildingData.mjs";
import { describeTodaySchedule, formatEquipmentLabel } from "../utils/d4RoomStatus.mjs";
import { Button } from "../ui/Button.jsx";
import { MetricList } from "../ui/MetricList.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { COARSE_TARGET, FOCUS_RING } from "../ui/Button.jsx";

const FLOOR_SELECT = `min-h-10 rounded-control border border-hairline-strong bg-surface-1 px-3 text-body text-ink ${COARSE_TARGET} ${FOCUS_RING}`;
const value = (text) => <span className="text-body font-medium text-ink">{text}</span>;

function ScheduleList({ timetable }) {
  if (timetable.length === 0) {
    return <p className="rounded-control bg-surface-2 p-4 text-body text-ink-muted">등록된 강의 시간이 없습니다.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {timetable.map((item) => (
        <li key={`${item.day}-${item.startHour}-${item.subject}`} className="rounded-control border border-hairline bg-surface-2 p-3">
          <p className="text-body font-semibold text-ink">{item.subject}</p>
          <p className="mt-1 text-caption text-ink-muted">
            {`${item.day}요일 ${item.startHour}:00-${item.startHour + item.durationHours}:00 · ${item.professorId}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

function RoomDetailCard({ room, status }) {
  const [view, setView] = useState("detail");

  if (!room) {
    return <p className={`${D4_CARD} text-body text-ink-muted`}>강의실을 선택하면 상세 정보가 표시됩니다.</p>;
  }

  const details = [
    { id: "name", label: "실 이름", value: value(room.specialLabel) },
    { id: "size", label: "규모", value: value(room.sizeLabel) },
    { id: "status", label: "현재 상태", value: value(status.statusText) },
    { id: "hvac", label: "냉난방 상태", value: value(status.hvacRunning ? "냉방 중 (24°C)" : status.hvacText) },
    { id: "equipment", label: "특수 설비", value: value(formatEquipmentLabel(room)) },
    { id: "schedule", label: "오늘 일정", value: value(describeTodaySchedule(status)) },
    {
      id: "saving",
      label: "주간 에너지 절감 (추정)",
      value: value(`${room.savingRate.toFixed(1)}% (${room.weeklySavingsKwh.toFixed(1)} kWh)`),
    },
  ];

  return (
    <section className={`${D4_CARD} flex flex-col gap-4`} aria-labelledby="d4-room-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-caption text-ink-muted">{view === "schedule" ? "강의실 시간표" : "강의실 상세"}</p>
          <h3 id="d4-room-title" className="flex flex-wrap items-center gap-2 text-title text-ink">
            D4 {formatRoomNumber(room.roomNumber)}
            <StatusBadge tone={status.isInUse ? "success" : "neutral"}>{status.isInUse ? "사용 중" : "미사용"}</StatusBadge>
            <D4SampleBadge />
          </h3>
        </div>
        {view === "schedule" && (
          <Button
            variant="ghost"
            iconOnly
            label="상세 정보로 돌아가기"
            icon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
            onClick={() => setView("detail")}
          />
        )}
      </div>
      {view === "schedule" ? (
        <ScheduleList timetable={room.timetable} />
      ) : (
        <>
          <MetricList items={details} />
          <Button onClick={() => setView("schedule")} className="w-full">강의실 시간표 보기</Button>
        </>
      )}
    </section>
  );
}

// 폰에서 3D 장면 이름표는 장면 비율(distanceFactor) 때문에 44px보다 작아진다. 폰에서는 같은 강의실을 44px 버튼 목록으로 고른다.
function RoomButtonList({ rooms, roomUsageById, selectedRoomId, onSelectRoom }) {
  return (
    <ul data-qa="d4-room-list" aria-label="강의실 목록" className="grid w-full grid-cols-3 gap-2 sm:hidden">
      {rooms.filter((room) => room.isSelectable !== false).map((room) => (
        <li key={room.id}>
          <button
            type="button"
            aria-pressed={selectedRoomId === room.id}
            onClick={() => onSelectRoom(room.id)}
            className={`flex min-h-11 w-full flex-col items-center justify-center rounded-control border border-hairline bg-surface-2 px-2 py-1 text-body font-semibold text-ink aria-pressed:ring-2 aria-pressed:ring-primary ${COARSE_TARGET} ${FOCUS_RING}`}
          >
            {formatRoomNumber(room.roomNumber)}
            {roomUsageById.get(room.id) && <span className="text-micro text-ink-muted">사용 중</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

// D4 층의 강의실 고르기(패인의 층 단계): 동·층 선택 -> 강의실(장면 또는 폰의 버튼 목록) -> 고른 강의실 상세.
// 제목과 돌아가기는 패인 머리(브레드크럼·상위로) 하나뿐이다.
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
}) {
  const major = getFloorMajor(wing.id, floor);
  return (
    <D4ScrollRoot>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Segmented
            kind="radio"
            label="동 선택"
            size="sm"
            options={building.wings.map((item) => ({ value: item.id, label: item.label }))}
            value={wing.id}
            onChange={onChangeWing}
          />
        </div>
        <label className="flex items-center gap-2 text-caption text-ink-muted">
          층
          <select value={floor} onChange={(event) => onChangeFloor(Number(event.target.value))} className={FLOOR_SELECT}>
            {floorLevels(wing).map((level) => <option key={level} value={level}>{`${wing.label} ${floorLabel(level)}`}</option>)}
          </select>
        </label>
      </div>

      {major && <p className="text-caption text-ink-muted">{`${wing.label} ${floorLabel(floor)} · ${major}`}</p>}

      {rooms.length === 0 ? (
        <p className="w-full rounded-card border border-hairline px-6 py-8 text-center text-body text-ink-muted">
          이 층에는 등록된 강의실이 없습니다.
        </p>
      ) : (
        <>
          <div data-qa="d4-room-grid" className="h-[40vh] min-h-[220px] w-full max-sm:hidden">
            <D4RoomGridScene rooms={rooms} roomUsageById={roomUsageById} selectedRoomId={selectedRoom?.id} onSelectRoom={onSelectRoom} />
          </div>
          <RoomButtonList rooms={rooms} roomUsageById={roomUsageById} selectedRoomId={selectedRoom?.id} onSelectRoom={onSelectRoom} />
        </>
      )}

      <RoomDetailCard room={selectedRoom} status={selectedRoomStatus} />
    </D4ScrollRoot>
  );
}

import { D4WingFloorScene } from "./D4WingFloorScene";
import { D4SampleBadge } from "./D4SampleBadge";
import { D4ScrollRoot } from "./D4ScrollRoot";
import { D4_CARD, D4_TITLE_CHIP, floorLabel } from "./d4Shared.mjs";
import { formatRoomNumber, getWingById } from "../utils/d4BuildingData.mjs";
import { Segmented } from "../ui/Segmented.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { COARSE_TARGET, FOCUS_RING } from "../ui/Button.jsx";

const HINT_ID = "d4-floor-scene-hint";

function InUseRoomList({ rooms, onSelectRoom }) {
  return (
    <section className={`${D4_CARD} flex w-full max-w-[560px] shrink-0 flex-col gap-3 lg:w-[340px]`} aria-labelledby="d4-in-use-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="d4-in-use-title" className="flex items-center gap-2 text-body font-semibold text-ink">
          사용 중인 강의실
          <D4SampleBadge />
        </h3>
        <StatusBadge tone="neutral">{`${rooms.length}개`}</StatusBadge>
      </div>
      {rooms.length === 0 ? (
        <p className="rounded-control bg-surface-2 p-3 text-caption text-ink-muted">현재 사용 중인 강의실이 없습니다.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {rooms.map((room) => (
            <li key={room.id}>
              <button
                type="button"
                onClick={() => onSelectRoom(room)}
                className={`flex min-h-11 w-full min-w-0 flex-col items-start gap-1 rounded-control border border-hairline bg-surface-2 px-3 py-2 text-left hover:bg-surface-3 ${COARSE_TARGET} ${FOCUS_RING}`}
              >
                <span className="text-body font-semibold text-ink">D4 {formatRoomNumber(room.roomNumber)}</span>
                <span className="w-full truncate text-caption text-ink-muted">{room.specialLabel}</span>
                <span className="text-caption text-ink-muted">{`${getWingById(room.wing).label} ${floorLabel(room.floor)}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// D4 날개·층 고르기. 장면이 왼쪽, 사용 중인 강의실 목록이 오른쪽(좁으면 아래)이다. 돌아가기는 D4 화면의 `지도` 단추 하나뿐이다.
export function D4WingFloorSelect({ building, activeWingId, onSelectWing, onSelectFloor, inUseRooms = [], onSelectInUseRoom }) {
  return (
    <D4ScrollRoot className="lg:items-center lg:justify-center">
      <div className="flex w-full max-w-[560px] shrink-0 flex-col items-center gap-6 lg:w-[560px]">
        <h2 className={D4_TITLE_CHIP}><StatusBadge tone="neutral" data-qa="building-code-badge" className="mr-2 align-middle">{building.code}</StatusBadge>{building.displayName}</h2>
        <div className="w-full max-w-xs">
          <Segmented
            kind="radio"
            label="동 선택"
            options={building.wings.map((wing) => ({ value: wing.id, label: wing.label }))}
            value={activeWingId}
            onChange={onSelectWing}
          />
        </div>
        <div className="h-[48vh] min-h-[280px] w-full lg:h-[64vh]" title="층을 선택하면 해당 층의 강의실 목록으로 이동합니다." aria-describedby={HINT_ID}>
          <D4WingFloorScene building={building} activeWingId={activeWingId} onSelectFloor={onSelectFloor} />
        </div>
        <p id={HINT_ID} className="sr-only">층을 선택하면 해당 층의 강의실 목록으로 이동합니다.</p>
      </div>
      <InUseRoomList rooms={inUseRooms} onSelectRoom={onSelectInUseRoom} />
    </D4ScrollRoot>
  );
}

import { D4WingFloorScene } from "./D4WingFloorScene";
import { D4SampleBadge } from "./D4SampleBadge";
import { D4_CARD, D4_COLUMN, floorLabel, floorLevels } from "./d4Shared.mjs";
import { formatRoomNumber, getWingById } from "../utils/d4BuildingData.mjs";
import { Segmented } from "../ui/Segmented.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { COARSE_TARGET, FOCUS_RING } from "../ui/Button.jsx";

// 안내 문장은 보이는 글로 두지 않고 title·aria-description으로만 준다.
const HINT = "층을 선택하면 해당 층의 강의실 목록으로 이동합니다.";

// 터치·폰에서 층을 고르는 44px 버튼 목록(지금 고른 동). 데스크톱 포인터에서는 장면 이름표가 같은 일을 한다.
function FloorButtonList({ wing, onSelectFloor }) {
  if (!wing) return null;
  return (
    <ul data-qa="d4-floor-list" aria-label={`${wing.label} 층 목록`} className="hidden w-full grid-cols-4 gap-2 [@media(pointer:coarse)]:grid max-[639px]:grid">
      {floorLevels(wing).map((level) => (
        <li key={level}>
          <button
            type="button"
            aria-label={`${level === 0 ? "지하 1" : level}층 선택`}
            onClick={() => onSelectFloor(wing.id, level)}
            className={`flex min-h-11 w-full items-center justify-center rounded-control border border-hairline bg-surface-2 px-2 text-body font-semibold text-ink hover:bg-surface-3 ${COARSE_TARGET} ${FOCUS_RING}`}
          >
            {floorLabel(level)}
          </button>
        </li>
      ))}
    </ul>
  );
}

function InUseRoomList({ rooms, onSelectRoom }) {
  return (
    <section className={`${D4_CARD} flex w-full shrink-0 flex-col gap-3`} aria-labelledby="d4-in-use-title">
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

// D4 날개·층 고르기(패인의 건물 단계). 장면이 맨 위, 그 아래 동 선택, 사용 중인 강의실 목록.
// 제목과 돌아가기는 패인 머리(브레드크럼·상위로) 하나뿐이다.
export function D4WingFloorSelect({ building, activeWingId, onSelectWing, onSelectFloor, inUseRooms = [], onSelectInUseRoom }) {
  return (
    <div className={D4_COLUMN}>
      <div className="flex w-full shrink-0 flex-col items-center gap-4">
        <div className="h-[32vh] min-h-[240px] w-full sm:h-[40vh]" title={HINT} aria-description={HINT}>
          <D4WingFloorScene building={building} activeWingId={activeWingId} onSelectFloor={onSelectFloor} />
        </div>
        <div className="w-full">
          <Segmented
            kind="radio"
            label="동 선택"
            options={building.wings.map((wing) => ({ value: wing.id, label: wing.label }))}
            value={activeWingId}
            onChange={onSelectWing}
          />
        </div>
        <FloorButtonList wing={building.wings.find((wing) => wing.id === activeWingId) ?? building.wings[0]} onSelectFloor={onSelectFloor} />
      </div>
      <InUseRoomList rooms={inUseRooms} onSelectRoom={onSelectInUseRoom} />
    </div>
  );
}

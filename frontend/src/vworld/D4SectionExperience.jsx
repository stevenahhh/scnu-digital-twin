import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { D4RoomGridSelect } from "../components/D4RoomGridSelect";
import { D4WingFloorSelect } from "../components/D4WingFloorSelect";
import { floorLabel } from "../components/d4Shared.mjs";
import { RoofEditor } from "../features/energy/editor/RoofEditor";
import { InstallationPlanManager } from "../features/energy/installations/InstallationPlanManager";
import { Breadcrumb } from "../ui/Breadcrumb.jsx";
import { Button } from "../ui/Button.jsx";
import { Disclosure } from "../ui/Disclosure.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { D4_BUILDING_DATA, D4_ROOMS, formatRoomNumber, getWingById } from "../utils/d4BuildingData.mjs";
import { getCurrentRoomStatus, isRoomInUse } from "../utils/d4RoomStatus.mjs";

const DEFAULT_WING_ID = D4_BUILDING_DATA.wings[0].id;
const PANE_TITLE_ID = "d4-pane-title";

// D4 건물 상세: 지도 옆 패인(데스크톱·태블릿) 또는 full 단계 바텀 시트(폰)의 내용. 캔버스는 그대로 뒤에 남는다.
// 머리 하나: `상위로` 버튼과 브레드크럼(캠퍼스 › 공과대학 3호관 [D4] › 층 › 호실, 현재 위치가 제목).
// 내용 순서: 건물 단계는 동·층 장면과 사용 중인 강의실, 층 단계는 층 고르기 -> 강의실 -> 상세. 설치 계획은 접힌 펼침 안에 있다.
// 나가기는 Esc(한 번에 한 단계)나 브레드크럼·상위로뿐이다. 휠로 나가는 동작은 없다.
// presets/onSelectPreset(폰): 시트가 지도를 가리는 동안 캠퍼스 시점으로 바로 가는 버튼 줄.
export function D4SectionExperience({
  onClose,
  buildingId = "D4",
  scenarioId,
  installationPlanId,
  onPlanSaved,
  createInstallationPlanDraft,
  onPlansChange,
  onRepresentativeChange,
  planRefreshKey,
  startInstallation = false,
  returnFocusRef,
  presets = null,
  onSelectPreset,
}) {
  const [isPlanOpen, setIsPlanOpen] = useState(startInstallation);
  const [isPlanEditorOpen, setIsPlanEditorOpen] = useState(Boolean(scenarioId || installationPlanId));
  const [activeInstallationPlanId, setActiveInstallationPlanId] = useState(installationPlanId ?? null);
  const [localPlanRevision, setLocalPlanRevision] = useState(0);
  const [d4View, setD4View] = useState("wings");
  const [d4ActiveWingId, setD4ActiveWingId] = useState(DEFAULT_WING_ID);
  const [d4SelectedFloor, setD4SelectedFloor] = useState(1);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [currentTime] = useState(() => new Date());
  const paneRef = useRef(null);
  const building = D4_BUILDING_DATA;
  const activeWing = getWingById(d4ActiveWingId);
  const floorRooms = useMemo(
    () => D4_ROOMS.filter((room) => room.wing === d4ActiveWingId && room.floor === d4SelectedFloor),
    [d4ActiveWingId, d4SelectedFloor],
  );
  const selectedRoom = useMemo(() => floorRooms.find((room) => room.id === selectedRoomId) ?? null, [floorRooms, selectedRoomId]);
  const roomUsageById = useMemo(() => new Map(D4_ROOMS.map((room) => [room.id, isRoomInUse(room, currentTime)])), [currentTime]);
  const selectedRoomStatus = selectedRoom ? getCurrentRoomStatus(selectedRoom, currentTime) : null;
  const inUseRooms = useMemo(() => D4_ROOMS.filter((room) => room.isSelectable && roomUsageById.get(room.id)), [roomUsageById]);
  const level = selectedRoom ? "room" : d4View === "grid" ? "floor" : "building";

  useEffect(() => {
    if (!scenarioId && !installationPlanId) return;
    setIsPlanOpen(true);
    setActiveInstallationPlanId(installationPlanId ?? null);
    setIsPlanEditorOpen(true);
  }, [installationPlanId, scenarioId]);

  const toBuilding = () => {
    setSelectedRoomId(null);
    setD4View("wings");
  };
  const toFloor = () => setSelectedRoomId(null);
  // 상위로: 호실 -> 층 -> 건물 -> 캠퍼스.
  const goUp = () => {
    if (level === "room") toFloor();
    else if (level === "floor") toBuilding();
    else onClose?.();
  };
  const goUpRef = useRef(goUp);
  goUpRef.current = goUp;

  // 옥상 편집기는 Esc를 "마지막 유효 배치로 되돌리기"에 쓰므로, 편집기가 열린 동안에는 Esc로 단계를 오르지 않는다.
  const isRoofEditorOpen = isPlanOpen && isPlanEditorOpen;
  useEffect(() => {
    if (isRoofEditorOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      goUpRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRoofEditorOpen]);

  // 열리면 패인으로 포커스를 옮기고, 닫히면 열기 전에 포커스가 있던 요소(없으면 returnFocusRef)로 돌려준다.
  useEffect(() => {
    const previous = document.activeElement;
    const remembered = previous && previous !== document.body ? previous : null;
    paneRef.current?.focus();
    return () => {
      const target = [remembered, returnFocusRef?.current].find((candidate) => candidate instanceof Element && candidate.isConnected);
      if (!target) return;
      target.focus();
      if (document.activeElement === target) return;
      // 대상이 아직 숨겨져 있으면(Legacy 캠퍼스 라벨은 3D 장면 렌더러가 한두 프레임 뒤에 다시 보이게 한다) 포커스가 무시되므로,
      // 다른 요소가 포커스를 가져가지 않은 동안만 몇 프레임 더 시도한다.
      let frames = 0;
      const retry = () => {
        const focusIsIdle = document.activeElement === null || document.activeElement === document.body;
        if (!focusIsIdle || !target.isConnected || frames >= 30) return;
        frames += 1;
        target.focus();
        if (document.activeElement !== target) requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
    };
  }, []);

  const selectFloorFromWings = (wingId, floor) => {
    setD4ActiveWingId(wingId);
    setD4SelectedFloor(floor);
    setSelectedRoomId(null);
    setD4View("grid");
  };
  const changeWing = (wingId) => {
    const wing = getWingById(wingId);
    const minFloor = wing.hasBasement ? 0 : 1;
    setD4ActiveWingId(wingId);
    setD4SelectedFloor((previous) => Math.min(Math.max(previous, minFloor), wing.floors));
    setSelectedRoomId(null);
  };
  const changeFloor = (floor) => {
    setD4SelectedFloor(floor);
    setSelectedRoomId(null);
  };
  const jumpToInUseRoom = (room) => {
    setD4ActiveWingId(room.wing);
    setD4SelectedFloor(room.floor);
    setSelectedRoomId(room.id);
    setD4View("grid");
  };

  const crumbs = [
    { id: "campus", label: "캠퍼스", ariaLabel: "캠퍼스 지도로 돌아가기", onSelect: () => onClose?.() },
    {
      id: "building",
      label: (
        <>
          {building.displayName}
          <StatusBadge tone="neutral" data-qa="building-code-badge">{building.code}</StatusBadge>
        </>
      ),
      onSelect: toBuilding,
    },
    level !== "building" && { id: "floor", label: `${activeWing.label} ${floorLabel(d4SelectedFloor)}`, onSelect: toFloor },
    level === "room" && { id: "room", label: `D4 ${formatRoomNumber(selectedRoom.roomNumber)}` },
  ].filter(Boolean);

  const presetRow = presets && (
    <nav aria-label="캠퍼스 시점" className="flex flex-wrap gap-2">
      {presets.map((preset) => (
        <Button key={preset.id} size="sm" data-qa={`camera-preset-${preset.id}`} onClick={() => onSelectPreset?.(preset)}>
          {preset.shortName ?? preset.title}
        </Button>
      ))}
    </nav>
  );

  return (
    <section
      ref={paneRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={PANE_TITLE_ID}
      tabIndex={-1}
      data-qa="d4-pane"
      className="flex h-full min-h-0 flex-col bg-surface-1 text-ink outline-none"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-4 py-2">
        <Button size="sm" variant="ghost" data-qa="d4-up" icon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />} onClick={goUp}>
          상위로
        </Button>
        <Breadcrumb id={PANE_TITLE_ID} items={crumbs} currentHeading={2} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-6">
        {d4View === "wings" ? (
          <D4WingFloorSelect
            building={building}
            activeWingId={d4ActiveWingId}
            onSelectWing={changeWing}
            onSelectFloor={selectFloorFromWings}
            inUseRooms={inUseRooms}
            onSelectInUseRoom={jumpToInUseRoom}
            beforeList={presetRow}
          />
        ) : (
          <D4RoomGridSelect
            building={building}
            wing={activeWing}
            floor={d4SelectedFloor}
            rooms={floorRooms}
            roomUsageById={roomUsageById}
            selectedRoom={selectedRoom}
            selectedRoomStatus={selectedRoomStatus}
            onSelectRoom={setSelectedRoomId}
            onChangeWing={changeWing}
            onChangeFloor={changeFloor}
          />
        )}
        <Disclosure summary="설치 계획" open={isPlanOpen} onOpenChange={setIsPlanOpen} data-qa="d4-plan-disclosure" className="px-4">
          {isPlanOpen && (isPlanEditorOpen ? (
            <div className="relative h-[70vh] min-h-[420px] overflow-hidden rounded-card border border-hairline">
              <RoofEditor
                key={activeInstallationPlanId ?? scenarioId ?? "default-scenario"}
                buildingId={buildingId}
                scenarioId={activeInstallationPlanId ? undefined : scenarioId}
                installationPlanId={activeInstallationPlanId}
                onPlanSaved={(plan) => {
                  setLocalPlanRevision((value) => value + 1);
                  onPlanSaved?.(plan);
                }}
                onBackToPlans={() => setIsPlanEditorOpen(false)}
              />
            </div>
          ) : (
            <InstallationPlanManager
              buildingId={buildingId}
              refreshKey={`${planRefreshKey ?? ""}:${localPlanRevision}`}
              createPlanDraft={createInstallationPlanDraft ?? (({ plans }) => ({ name: `${buildingId} 새 설치안 ${plans.length + 1}`, arrays: [] }))}
              onEditPlan={(plan) => {
                setActiveInstallationPlanId(plan.id);
                setIsPlanEditorOpen(true);
              }}
              onPlansChange={onPlansChange}
              onRepresentativeChange={onRepresentativeChange}
            />
          ))}
        </Disclosure>
      </div>
    </section>
  );
}

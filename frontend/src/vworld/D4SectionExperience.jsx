import { ArrowLeft, Building2, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { D4RoomGridSelect } from "../components/D4RoomGridSelect";
import { D4WingFloorSelect } from "../components/D4WingFloorSelect";
import { RoofEditor } from "../features/energy/editor/RoofEditor";
import { InstallationPlanManager } from "../features/energy/installations/InstallationPlanManager";
import { D4_BUILDING_DATA, D4_ROOMS, getWingById } from "../utils/d4BuildingData.mjs";
import { getCurrentRoomStatus, isRoomInUse } from "../utils/d4RoomStatus.mjs";

const DEFAULT_WING_ID = D4_BUILDING_DATA.wings[0].id;

// 공간 탐색 화면 위에서 마우스 휠/트랙패드로 축소(줌아웃)하면 캠퍼스로 돌아간다.
// 태양광 설치 화면은 목록 스크롤·옥상 편집기 자체 줌과 휠을 이미 쓰고 있어서
// 겹치지 않도록 공간 탐색 모드에서만 반응한다.
const ZOOM_OUT_EXIT_THRESHOLD = 220;
const ZOOM_OUT_RESET_DELAY_MS = 400;
const EXPERIENCE_TITLE_ID = "d4-section-experience-title";
const ROOMS_PANEL_ID = "d4-rooms-panel";
const INSTALLATION_PANEL_ID = "d4-installation-panel";

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
}) {
  const [experienceMode, setExperienceMode] = useState(startInstallation ? "installation" : "rooms");
  const [isPlanEditorOpen, setIsPlanEditorOpen] = useState(Boolean(scenarioId || installationPlanId));
  const [activeInstallationPlanId, setActiveInstallationPlanId] = useState(installationPlanId ?? null);
  const [localPlanRevision, setLocalPlanRevision] = useState(0);
  const [d4View, setD4View] = useState("wings");
  const [d4ActiveWingId, setD4ActiveWingId] = useState(DEFAULT_WING_ID);
  const [d4SelectedFloor, setD4SelectedFloor] = useState(1);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [currentTime] = useState(() => new Date());
  // 확대된 캠퍼스 화면은 그대로 배경으로 유지되고, 이 패널은 마운트 직후
  // 살짝 페이드인되어 건물 기능 UI만 그 위에 자연스럽게 나타나는 느낌을 준다.
  const [hasEntered, setHasEntered] = useState(false);
  const modeTabRefs = useRef([]);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setHasEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const activeWing = getWingById(d4ActiveWingId);
  const floorRooms = useMemo(
    () => D4_ROOMS.filter((room) => room.wing === d4ActiveWingId && room.floor === d4SelectedFloor),
    [d4ActiveWingId, d4SelectedFloor],
  );
  const selectedRoom = useMemo(
    () => floorRooms.find((room) => room.id === selectedRoomId) ?? null,
    [floorRooms, selectedRoomId],
  );
  const roomUsageById = useMemo(
    () => new Map(D4_ROOMS.map((room) => [room.id, isRoomInUse(room, currentTime)])),
    [currentTime],
  );
  const selectedRoomStatus = selectedRoom ? getCurrentRoomStatus(selectedRoom, currentTime) : null;
  const inUseRooms = useMemo(
    () => D4_ROOMS.filter((room) => room.isSelectable && roomUsageById.get(room.id)),
    [roomUsageById],
  );

  useEffect(() => {
    if (!scenarioId && !installationPlanId) return;
    setExperienceMode("installation");
    setActiveInstallationPlanId(installationPlanId ?? null);
    setIsPlanEditorOpen(true);
  }, [installationPlanId, scenarioId]);

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

  const zoomOutAccumRef = useRef(0);
  const zoomOutResetTimerRef = useRef(null);
  const handleZoomOutWheel = useCallback((event) => {
    if (experienceMode !== "rooms") return;
    // 사용 중인 강의실 목록처럼 자체 스크롤이 있는 영역에서는 목록 스크롤을 그대로 둔다.
    if (event.target.closest?.(".overflow-y-auto")) return;
    if (event.deltaY <= 0) {
      zoomOutAccumRef.current = 0;
      return;
    }
    zoomOutAccumRef.current += event.deltaY;
    clearTimeout(zoomOutResetTimerRef.current);
    zoomOutResetTimerRef.current = window.setTimeout(() => {
      zoomOutAccumRef.current = 0;
    }, ZOOM_OUT_RESET_DELAY_MS);
    if (zoomOutAccumRef.current >= ZOOM_OUT_EXIT_THRESHOLD) {
      zoomOutAccumRef.current = 0;
      clearTimeout(zoomOutResetTimerRef.current);
      onClose?.();
    }
  }, [experienceMode, onClose]);
  useEffect(() => () => clearTimeout(zoomOutResetTimerRef.current), []);

  // 옥상 편집기는 Esc를 "마지막 유효 배치로 되돌리기"에 쓰므로, 편집기가 열려 있는 동안에는 상세 화면을 닫지 않는다.
  const isRoofEditorOpen = experienceMode !== "rooms" && isPlanEditorOpen;
  useEffect(() => {
    if (isRoofEditorOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, isRoofEditorOpen]);

  const handleModeTabKeyDown = (event, index) => {
    const tabs = modeTabRefs.current.filter(Boolean);
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    nextTab.focus();
    nextTab.click();
  };

  const jumpToInUseRoom = (room) => {
    setD4ActiveWingId(room.wing);
    setD4SelectedFloor(room.floor);
    setSelectedRoomId(room.id);
    setD4View("grid");
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] min-h-0 overflow-hidden transition-opacity duration-500 ease-out ${
        hasEntered ? "opacity-100" : "opacity-0"
      }`}
      onWheel={handleZoomOutWheel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={EXPERIENCE_TITLE_ID}
    >
      <h1 id={EXPERIENCE_TITLE_ID} className="sr-only">D4 공과대학 3호관 상세 경험</h1>
      {experienceMode === "rooms" ? (
        <div id={ROOMS_PANEL_ID} role="tabpanel" aria-labelledby="d4-rooms-tab" className="absolute inset-0 pt-16">
          {d4View === "wings" ? (
            <D4WingFloorSelect
              building={D4_BUILDING_DATA}
              activeWingId={d4ActiveWingId}
              onSelectWing={changeWing}
              onSelectFloor={selectFloorFromWings}
              onBack={onClose}
              inUseRooms={inUseRooms}
              onSelectInUseRoom={jumpToInUseRoom}
            />
          ) : (
            <D4RoomGridSelect
              building={D4_BUILDING_DATA}
              wing={activeWing}
              floor={d4SelectedFloor}
              rooms={floorRooms}
              roomUsageById={roomUsageById}
              selectedRoom={selectedRoom}
              selectedRoomStatus={selectedRoomStatus}
              onSelectRoom={setSelectedRoomId}
              onChangeWing={changeWing}
              onChangeFloor={changeFloor}
              onBack={() => setD4View("wings")}
            />
          )}
        </div>
  ) : isPlanEditorOpen ? (
      <div id={INSTALLATION_PANEL_ID} role="tabpanel" aria-labelledby="d4-installation-tab" className="absolute inset-0">
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
    <div id={INSTALLATION_PANEL_ID} role="tabpanel" aria-labelledby="d4-installation-tab" className="absolute inset-0 overflow-y-auto px-4 pb-8 pt-20 sm:px-6">
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
        className="mx-auto max-w-5xl"
      />
    </div>
  )}

      <div className="pointer-events-auto absolute left-1/2 top-4 z-50 flex -translate-x-1/2 overflow-hidden rounded-lg border border-[var(--colors-hairline-strong)] bg-[var(--colors-surface-1)] p-1 shadow-lg" role="tablist" aria-label={`${buildingId} 상세 모드`}>
        {buildingId === "D4" && <button ref={(element) => { modeTabRefs.current[0] = element; }} id="d4-rooms-tab" type="button" role="tab" aria-controls={ROOMS_PANEL_ID} aria-selected={experienceMode === "rooms"} tabIndex={experienceMode === "rooms" ? 0 : -1} onKeyDown={(event) => handleModeTabKeyDown(event, 0)} onClick={() => setExperienceMode("rooms")} className={`flex h-10 items-center gap-2 rounded-md px-3 text-xs font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--colors-primary)] ${experienceMode === "rooms" ? "bg-[var(--colors-surface-3)] text-[var(--colors-ink)]" : "text-[var(--colors-ink-subtle)]"}`}><Building2 size={16} /> 공간 탐색</button>}
        <button ref={(element) => { modeTabRefs.current[buildingId === "D4" ? 1 : 0] = element; }} id="d4-installation-tab" type="button" role="tab" aria-controls={INSTALLATION_PANEL_ID} aria-selected={experienceMode === "installation"} tabIndex={experienceMode === "installation" ? 0 : -1} onKeyDown={(event) => handleModeTabKeyDown(event, buildingId === "D4" ? 1 : 0)} onClick={() => { setExperienceMode("installation"); setIsPlanEditorOpen(false); }} className={`flex h-10 items-center gap-2 rounded-md px-3 text-xs font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--colors-primary)] ${experienceMode === "installation" ? "bg-[var(--colors-primary)] text-white" : "text-[var(--colors-ink-subtle)]"}`}><Sun size={16} /> 태양광 설치</button>
      </div>

      <div className={`pointer-events-auto absolute left-4 z-50 flex overflow-hidden rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] shadow-lg sm:left-6 ${experienceMode === "installation" ? "top-4" : "bottom-4 sm:bottom-6"}`}>
        <button type="button" onClick={onClose} className="flex h-11 items-center gap-2 px-3 text-[12px] font-[800] text-[var(--colors-ink-muted)] transition-colors hover:bg-[var(--colors-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--colors-primary)]" aria-label="캠퍼스 지도로 돌아가기" title="캠퍼스 지도로 돌아가기">
          <ArrowLeft size={16} /> 지도
        </button>
      </div>
    </div>,
    document.body,
  );
}

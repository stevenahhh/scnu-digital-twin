import { useRef } from "react";
import {
  BookOpen, Building, Check, ChevronDown, DoorOpen, Eye, GraduationCap, Home, Landmark, Pause, Play, Sprout, Wrench,
} from "lucide-react";
import { OVERVIEW_PRESET_ID } from "../camera/cameraPresets.mjs";
import { Button, COARSE_TARGET, FOCUS_RING } from "../ui/Button.jsx";
import { Popover } from "../ui/Popover.jsx";
import { cx } from "../ui/cx.mjs";

const PRESET_ICONS = {
  gate: DoorOpen,
  d4: Building,
  engineering: Wrench,
  library: BookOpen,
  "life-science": Sprout,
  headquarters: Landmark,
  humanities: GraduationCap,
};
const icon = (Icon) => <Icon aria-hidden="true" className="h-4 w-4" />;
// 눌린(지금 보고 있는) 시점의 모양 하나: surface-2 바탕 + ink 글자 + 확인 표시. 강조색 테두리는 쓰지 않는다.
const PRESSED = "bg-surface-2 text-ink";

// 시점 메뉴: 위아래 화살표로 항목을 옮기고 Enter로 고른다. Esc는 Popover가 닫고 포커스를 트리거로 돌린다.
function PresetMenu({ presets, activeId, onSelect, close }) {
  const listRef = useRef(null);
  const moveFocus = (event) => {
    const items = [...listRef.current.querySelectorAll("[role=menuitemradio]")];
    const index = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = items[(index + 1) % items.length];
    else if (event.key === "ArrowUp") next = items[(index - 1 + items.length) % items.length];
    else if (event.key === "Home") next = items[0];
    else if (event.key === "End") next = items[items.length - 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };
  return (
    <ul ref={listRef} className="flex flex-col gap-0.5" onKeyDown={moveFocus}>
      {presets.map((preset) => {
        const Icon = PRESET_ICONS[preset.id] ?? Building;
        const active = preset.id === activeId;
        return (
          <li key={preset.id} role="none">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={active}
              data-qa={`camera-preset-${preset.id}`}
              onClick={() => {
                close();
                onSelect(preset);
              }}
              className={cx(
                "flex min-h-10 w-full items-start gap-2 rounded-control px-2 py-1.5 text-left hover:bg-surface-2",
                COARSE_TARGET,
                FOCUS_RING,
                active && PRESSED,
              )}
            >
              <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body font-medium text-ink">{preset.shortName ?? preset.title}</span>
                {preset.description && <span className="break-keep text-caption text-ink-muted">{preset.description}</span>}
              </span>
              {active && <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// 지도 왼쪽 위 카메라 도구 모음: 전체 · 시점 메뉴 · 투어, 세 묶음. presets는 cameraPresets.mjs의 CAMERA_PRESETS다.
export function HudToolbar({ presets, activeId, onSelect, touring = false, onToggleTour, className = "" }) {
  const overview = presets.find((preset) => preset.id === OVERVIEW_PRESET_ID);
  const named = presets.filter((preset) => preset.id !== OVERVIEW_PRESET_ID);
  const activeNamed = named.find((preset) => preset.id === activeId);
  const overviewActive = activeId === OVERVIEW_PRESET_ID;
  return (
    <div
      role="toolbar"
      aria-label="카메라 시점"
      data-qa="camera-preset-bar"
      className={cx("pointer-events-auto inline-flex w-max items-center gap-1 rounded-card border border-hairline bg-surface-1 p-1 shadow-popover", className)}
    >
      <Button
        size="sm"
        variant="ghost"
        data-qa="camera-preset-overview"
        aria-pressed={overviewActive}
        title={overview.description}
        onClick={() => onSelect(overview)}
        icon={overviewActive ? icon(Check) : icon(Home)}
        className={cx(overviewActive && PRESSED)}
      >
        {overview.title}
      </Button>
      <Popover
        label="시점"
        role="menu"
        qa="camera-view-menu-list"
        renderTrigger={(props) => (
          <Button
            {...props}
            size="sm"
            variant="ghost"
            data-qa="camera-view-menu"
            title={activeNamed ? `시점: ${activeNamed.title}` : "건물·장소 시점 고르기"}
            icon={icon(Eye)}
            className={cx(activeNamed && PRESSED)}
          >
            시점
            {activeNamed && <span className="text-ink-muted">{activeNamed.shortName ?? activeNamed.title}</span>}
            <ChevronDown aria-hidden="true" className="h-3 w-3" />
          </Button>
        )}
      >
        {({ close }) => <PresetMenu presets={named} activeId={activeId} onSelect={onSelect} close={close} />}
      </Popover>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-hairline-strong" />
      <Button
        size="sm"
        variant="ghost"
        data-qa="camera-tour-toggle"
        aria-pressed={touring}
        title={touring ? "투어를 멈춥니다" : "시점을 6초마다 차례로 보여 줍니다"}
        onClick={onToggleTour}
        icon={touring ? icon(Pause) : icon(Play)}
        className={cx(touring && PRESSED)}
      >
        {touring ? "투어 멈춤" : "투어 시작"}
      </Button>
    </div>
  );
}

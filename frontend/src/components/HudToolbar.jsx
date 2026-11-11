import { useRef } from "react";
import {
  BookOpen, Building, Check, ChevronDown, DoorOpen, Eye, GraduationCap, Landmark, Sprout, Wrench,
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
// 지금 보고 있는 시점의 모양 하나: surface-2 바탕 + ink 글자 + 확인 표시. 강조색 테두리는 쓰지 않는다.
const ACTIVE_ITEM = "bg-surface-2 text-ink";
// 트리거는 data-active일 때 같은 바탕을 쓴다(속성 선택자라 변형의 바탕보다 앞선다).
const ACTIVE_TRIGGER = "data-[active=true]:bg-surface-2 data-[active=true]:text-ink";

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
                active && ACTIVE_ITEM,
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

// HUD의 시점 메뉴 하나. presets는 cameraPresets.mjs의 CAMERA_PRESETS다. 전체 시점은 카메라 묶음의 `전체 보기`가 맡는다.
// compact(폰): 글자 없이 아이콘 단추(44 px)로 놓고, 메뉴는 HUD 한 줄의 오른쪽 끝에 맞춰 연다. 끊긴 피드 칩이 있으면 단추가
// 줄 가운데로 밀리므로, 단추에 맞추면 메뉴가 화면 왼쪽 밖으로 나간다.
export function HudToolbar({ presets, activeId, onSelect, compact = false, className = "" }) {
  const named = presets.filter((preset) => preset.id !== OVERVIEW_PRESET_ID);
  const activeNamed = named.find((preset) => preset.id === activeId);
  const title = activeNamed ? `시점: ${activeNamed.title}` : "건물·장소 시점 고르기";
  return (
    <div data-qa="camera-preset-bar" className={cx("pointer-events-auto shrink-0", className)}>
      <Popover
        label="시점"
        role="menu"
        align={compact ? "end" : "start"}
        anchor={compact ? "container" : "trigger"}
        qa="camera-view-menu-list"
        renderTrigger={(props) => (
          <Button
            {...props}
            size="sm"
            iconOnly={compact}
            label={compact ? (activeNamed ? title : "시점") : undefined}
            data-qa="camera-view-menu"
            data-active={activeNamed ? "true" : undefined}
            title={title}
            icon={<Eye aria-hidden="true" className="h-4 w-4" />}
            className={cx(ACTIVE_TRIGGER, "whitespace-nowrap")}
          >
            시점
            {activeNamed && <span className="text-ink-muted">{activeNamed.shortName ?? activeNamed.title}</span>}
            <ChevronDown aria-hidden="true" className="h-3 w-3" />
          </Button>
        )}
      >
        {({ close }) => <PresetMenu presets={named} activeId={activeId} onSelect={onSelect} close={close} />}
      </Popover>
    </div>
  );
}

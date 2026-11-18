import {
  BookOpen, Building, ChevronDown, DoorOpen, Eye, GraduationCap, Landmark, Sprout, Wrench,
} from "lucide-react";
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { OVERVIEW_PRESET_ID } from "../camera/cameraPresets.mjs";
import { Button } from "../ui/Button.jsx";
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
// 트리거는 data-active일 때 같은 바탕을 쓴다(속성 선택자라 변형의 바탕보다 앞선다).
const ACTIVE_TRIGGER = "data-[active=true]:bg-surface-2 data-[active=true]:text-ink";

// 시점 메뉴: 지금 시점에 확인 표시가 붙는다. 이미 고른 시점을 다시 골라도 카메라가 그 시점으로 돌아가도록 항목마다 onSelect를 건다.
function PresetMenu({ presets, activeId, onSelect }) {
  return (
    <DropdownMenuRadioGroup value={activeId}>
      {presets.map((preset) => {
        const Icon = PRESET_ICONS[preset.id] ?? Building;
        return (
          <DropdownMenuRadioItem
            key={preset.id}
            value={preset.id}
            data-qa={`camera-preset-${preset.id}`}
            onSelect={() => onSelect(preset)}
            className="items-start"
          >
            <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body font-medium text-ink">{preset.shortName ?? preset.title}</span>
              {preset.description && <span className="break-keep text-caption text-ink-muted">{preset.description}</span>}
            </span>
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
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
        <PresetMenu presets={named} activeId={activeId} onSelect={onSelect} />
      </Popover>
    </div>
  );
}

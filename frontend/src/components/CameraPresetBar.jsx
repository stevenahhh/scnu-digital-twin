import { BookOpen, Building, DoorOpen, GraduationCap, Home, Landmark, Pause, Play, Sprout, Wrench } from "lucide-react";

const PRESET_ICONS = {
  overview: Home,
  gate: DoorOpen,
  d4: Building,
  engineering: Wrench,
  library: BookOpen,
  "life-science": Sprout,
  headquarters: Landmark,
  humanities: GraduationCap,
};

// 버튼은 마우스에서 32 px, 터치 화면에서는 44 px 높이다(WCAG 2.5.8). 모든 버튼이 Tab 순서에 들어간다.
const BUTTON_BASE =
  "inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[12px] font-[600] leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--colors-primary)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11";
const BUTTON_ACTIVE = "border-[var(--colors-primary)] bg-[var(--colors-surface-2)] text-[var(--colors-primary)]";
const BUTTON_IDLE = "border-transparent text-[var(--colors-ink-muted)] hover:bg-[var(--colors-surface-2)] hover:text-[var(--colors-ink)]";

// presets는 cameraPresets.mjs의 CAMERA_PRESETS 형태다.
export function CameraPresetBar({ presets, activeId, onSelect, touring = false, onToggleTour, className = "" }) {
  return (
    <div
      role="group"
      aria-label="카메라 시점"
      data-qa="camera-preset-bar"
      className={`pointer-events-auto flex items-center gap-1 overflow-x-auto rounded-[12px] border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl [scrollbar-width:thin] sm:flex-wrap sm:overflow-visible ${className}`}
    >
      {presets.map((preset) => {
        const Icon = PRESET_ICONS[preset.id] ?? Building;
        const isActive = preset.id === activeId;
        return (
          <button
            key={preset.id}
            type="button"
            data-qa={`camera-preset-${preset.id}`}
            aria-pressed={isActive}
            title={preset.description ?? preset.title}
            onClick={() => onSelect(preset)}
            className={`${BUTTON_BASE} ${isActive ? BUTTON_ACTIVE : BUTTON_IDLE}`}
          >
            <Icon size={14} aria-hidden="true" />
            {preset.title}
          </button>
        );
      })}
      <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-[var(--colors-hairline-strong)]" />
      <button
        type="button"
        data-qa="camera-tour-toggle"
        aria-pressed={touring}
        title={touring ? "투어 멈춤" : "시점을 6초마다 차례로 보여 줍니다"}
        onClick={onToggleTour}
        className={`${BUTTON_BASE} ${touring ? BUTTON_ACTIVE : BUTTON_IDLE}`}
      >
        {touring ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        {touring ? "투어 멈춤" : "투어"}
      </button>
    </div>
  );
}

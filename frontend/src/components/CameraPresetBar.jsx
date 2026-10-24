import { useEffect, useRef, useState } from "react";
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
  "inline-flex h-8 min-w-8 shrink-0 snap-start items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[12px] font-[600] leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--colors-primary)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11";
const BUTTON_ACTIVE = "border-[var(--colors-primary)] bg-[var(--colors-surface-2)] text-[var(--colors-primary)]";
const BUTTON_IDLE = "border-transparent text-[var(--colors-ink-muted)] hover:bg-[var(--colors-surface-2)] hover:text-[var(--colors-ink)]";

// 좁은 화면에서 양 끝에 "더 있다"는 표시로 깔리는 페이드. 스크롤이 닿은 쪽은 꺼져서 마지막 시점(인문·사범)과 투어 버튼이
// 또렷이 보인다. 폭(w-8)은 스크롤러의 scroll-px-8과 같아서 스냅되거나 포커스로 끌려온 버튼이 페이드 아래로 들어가지 않는다.
const EDGE_FADE_BASE =
  "pointer-events-none absolute inset-y-0 w-8 transition-opacity duration-200 motion-reduce:transition-none sm:hidden";

// 스크롤 위치로 시작/끝 페이드를 켤지 정한다. 1 px 여유는 소수점 scrollLeft 때문이다.
function useScrollEdges(ref, presets) {
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const element = ref.current;
    const update = () => {
      const maxScrollLeft = element.scrollWidth - element.clientWidth;
      const next = { start: element.scrollLeft > 1, end: element.scrollLeft < maxScrollLeft - 1 };
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    // jsdom에는 ResizeObserver가 없다. 글꼴 로드로 버튼 폭이 바뀌는 경우까지 잡으려고 자식도 함께 관찰한다.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    return () => {
      element.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [ref, presets]);
  return edges;
}

// presets는 cameraPresets.mjs의 CAMERA_PRESETS 형태다.
export function CameraPresetBar({ presets, activeId, onSelect, touring = false, onToggleTour, className = "" }) {
  const scrollerRef = useRef(null);
  const edges = useScrollEdges(scrollerRef, presets);
  // 페이드의 containing block은 className이 주는 absolute다. 여기에 relative를 더하면 Tailwind CSS 순서상 absolute를 이겨
  // 바가 흐름 안의 블록이 되고 데스크톱에서 max-width까지 늘어난다.
  return (
    <div
      role="group"
      aria-label="카메라 시점"
      data-qa="camera-preset-bar"
      className={`pointer-events-auto rounded-[12px] border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl ${className}`}
    >
      <div
        ref={scrollerRef}
        data-qa="camera-preset-scroller"
        className="flex snap-x snap-mandatory items-center gap-1 overflow-x-auto scroll-px-8 p-1 [scrollbar-width:thin] sm:snap-none sm:flex-wrap sm:overflow-visible"
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
      <span
        aria-hidden="true"
        data-qa="camera-preset-fade-start"
        data-visible={edges.start ? "true" : "false"}
        className={`${EDGE_FADE_BASE} left-0 rounded-l-[inherit] bg-gradient-to-r from-[var(--colors-surface-1)] to-transparent ${edges.start ? "opacity-100" : "opacity-0"}`}
      />
      <span
        aria-hidden="true"
        data-qa="camera-preset-fade-end"
        data-visible={edges.end ? "true" : "false"}
        className={`${EDGE_FADE_BASE} right-0 rounded-r-[inherit] bg-gradient-to-l from-[var(--colors-surface-1)] to-transparent ${edges.end ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

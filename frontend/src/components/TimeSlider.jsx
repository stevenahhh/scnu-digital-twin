import { useEffect, useRef } from "react";
import { Clock3, Pause, Play } from "lucide-react";
import {
  MINUTES_PER_DAY,
  PLAY_INTERVAL_MS,
  PLAY_STEP_MINUTES,
  formatMinuteOfDay,
  minuteForKey,
  stepMinuteOfDay,
  wrapMinuteOfDay,
} from "../weather/sceneClock.mjs";

export const TIME_SLIDER_LABEL = "시각 (KST)";

const ICON_BUTTON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] text-[var(--colors-ink-muted)] transition hover:bg-[var(--colors-surface-2)] hover:text-[var(--colors-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--colors-primary)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";

// 1분 해상도: range step 1, 화살표 ±1분, Shift+화살표 ±10분, PageUp/PageDown ±60분, Home/End 0시/23:59(sceneClock.minuteForKey).
export function TimeSlider({
  minuteOfDay,
  onMinuteChange,
  playing = false,
  onPlayingChange,
  live = false,
  caption = null,
  className = "",
}) {
  const minuteRef = useRef(minuteOfDay);
  useEffect(() => {
    minuteRef.current = minuteOfDay;
  }, [minuteOfDay]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      onMinuteChange(stepMinuteOfDay(minuteRef.current, PLAY_STEP_MINUTES));
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [onMinuteChange, playing]);

  const handleKeyDown = (event) => {
    const next = minuteForKey(wrapMinuteOfDay(minuteOfDay), event);
    if (next === null) return;
    event.preventDefault();
    onMinuteChange(next);
  };

  const timeLabel = formatMinuteOfDay(minuteOfDay);

  return (
    <section
      aria-label="시간 조절"
      data-qa="time-slider"
      className={`pointer-events-auto rounded-[12px] border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] px-3 py-2.5 shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-[500] text-[var(--colors-ink-subtle)]">
          <Clock3 size={14} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{TIME_SLIDER_LABEL}</span>
          {live && (
            <span className="dashboard-status-badge inline-flex shrink-0 items-center border border-[var(--colors-hairline-strong)] font-[700] leading-4">
              실시간
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span data-qa="time-slider-value" className="text-[16px] font-[600] tabular-nums tracking-[-0.3px] text-[var(--colors-ink)]">
            {timeLabel}
          </span>
          <button
            type="button"
            aria-label={playing ? "시간 일시정지" : "시간 재생"}
            title={playing ? "시간 일시정지" : "시간 재생"}
            aria-pressed={playing}
            onClick={() => onPlayingChange(!playing)}
            className={ICON_BUTTON}
          >
            {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={MINUTES_PER_DAY - 1}
        step={1}
        value={wrapMinuteOfDay(minuteOfDay)}
        aria-label={TIME_SLIDER_LABEL}
        aria-valuetext={timeLabel}
        onChange={(event) => onMinuteChange(Number(event.target.value))}
        onKeyDown={handleKeyDown}
        className="mt-2 w-full accent-[var(--colors-primary)]"
      />
      <div className="mt-1 flex justify-between text-[11px] font-[500] tabular-nums text-[var(--colors-ink-tertiary)]" aria-hidden="true">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
      {caption && <div className="mt-2 border-t border-[var(--colors-hairline)] pt-2">{caption}</div>}
    </section>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Clock3, Pause, Play } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { cx } from "../ui/cx.mjs";
import {
  MINUTES_PER_DAY,
  PLAY_INTERVAL_MS,
  PLAY_STEP_MINUTES,
  formatMinuteOfDay,
  minuteForKey,
  stepMinuteOfDay,
  wrapMinuteOfDay,
} from "../weather/sceneClock.mjs";
import { parseSceneDate, parseTypedTime } from "./timeControl.mjs";

export const TIME_SLIDER_LABEL = "시각 (KST)";

const SURFACE = "pointer-events-auto rounded-card border border-hairline bg-surface-1 px-3 py-2.5";
// 폰에서 접힌 시간 카드: 장면 시각 칩 하나(누르면 펼친다). 지도를 가리지 않는다.
const COLLAPSED_SURFACE = "pointer-events-auto rounded-card border border-hairline bg-surface-1 p-1";
const CHIP = cx(
  "flex min-h-11 items-center gap-2 rounded-control px-3",
  "text-caption font-medium text-ink-muted hover:bg-surface-2",
);
const FIELD = cx(
  "min-h-8 rounded-control border border-hairline-strong bg-surface-1 px-2 text-caption tabular-nums text-ink",
  "[@media(pointer:coarse)]:min-h-11 aria-[invalid=true]:border-danger",
);
const HEADING = "flex min-w-0 items-center gap-1.5 text-caption font-medium text-ink-muted";
const ICON = "h-3.5 w-3.5";
const READOUT = "text-body font-semibold tabular-nums text-ink";
// 눈금: 0..24시 25개의 짧은 금. 글자는 데스크톱에서 3시간마다, 폰에서 6시간마다(25개 글자는 24rem에 붙어 읽히지 않는다).
// 12px, 4.5:1 이상(ink-muted).
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const TICKS = "mt-1 flex justify-between text-[12px] font-medium tabular-nums text-ink-muted";
const tickLabelClass = (hour) => (hour % 6 === 0 ? "" : hour % 3 === 0 ? "hidden sm:inline" : "invisible");

// 장면 시각을 정하는 하나뿐인 조작: 날짜, 직접 입력한 시각, `지금`(실측으로 돌아감), 0..1439분 슬라이더와 시간 눈금.
// 키보드: 화살표 ±1분, Shift+화살표 ±10분, PageUp/PageDown ±60분, Home/End 0시/23:59(sceneClock.minuteForKey).
// collapsible(폰): 처음에는 장면 시각 칩만 보이고, 누르면 카드 전체가 펼쳐진다(접기 단추로 다시 접는다).
// 접혀 있어도 조작은 그대로 붙어 있고 보이지만 않는다(재생은 계속된다).
export function TimeSlider({
  minuteOfDay,
  onMinuteChange,
  dateValue,
  onDateChange,
  onNow,
  playing = false,
  onPlayingChange,
  live = false,
  caption = null,
  collapsible = false,
  className = "",
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const collapsed = collapsible && !expanded;
  const minuteRef = useRef(minuteOfDay);
  const [typed, setTyped] = useState(null);
  const timeLabel = formatMinuteOfDay(minuteOfDay);
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

  // 잘못된 시각(예: 25:99)은 슬라이더를 움직이지 않고 입력 칸만 aria-invalid로 표시한다.
  const handleTyped = (event) => {
    const text = event.target.value;
    const minute = parseTypedTime(text);
    setTyped({ text, invalid: minute === null });
    if (minute !== null) onMinuteChange(minute);
  };
  const typedInvalid = Boolean(typed?.invalid);

  return (
    <section
      aria-label="시간 조절"
      data-qa="time-slider"
      data-collapsed={collapsible ? String(collapsed) : undefined}
      className={cx(collapsed ? COLLAPSED_SURFACE : SURFACE, className)}
      style={collapsed ? { width: "auto" } : undefined}
    >
      {collapsed && (
        <button
          type="button"
          data-qa="time-chip"
          aria-expanded="false"
          aria-controls={bodyId}
          onClick={() => setExpanded(true)}
          className={CHIP}
        >
          <Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>장면</span>
          <span data-qa="time-slider-value" className={READOUT}>{timeLabel}</span>
          {playing && <Play aria-label="재생 중" className={ICON} />}
          <ChevronUp aria-hidden="true" className={ICON} />
          <span className="sr-only">시간 조작 펼치기</span>
        </button>
      )}
      <div id={bodyId} hidden={collapsed}>
        <div className="flex items-center justify-between gap-3">
          <div className={HEADING}>
            <Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{TIME_SLIDER_LABEL}</span>
            {live && <StatusBadge tone="success">실측</StatusBadge>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span data-qa={collapsed ? undefined : "time-slider-value"} className={READOUT}>{timeLabel}</span>
            {onNow && (
              <Button size="sm" data-qa="time-now" onClick={onNow} aria-pressed={live} className="shrink-0">
                지금
              </Button>
            )}
            <Button
              size="sm"
              iconOnly
              label={playing ? "시간 일시정지" : "시간 재생"}
              aria-pressed={playing}
              icon={playing
                ? <Pause aria-hidden="true" className={ICON} />
                : <Play aria-hidden="true" className={ICON} />}
              onClick={() => onPlayingChange(!playing)}
              className="shrink-0"
            />
            {collapsible && (
              <Button
                size="sm"
                iconOnly
                variant="ghost"
                label="시간 조작 접기"
                aria-expanded="true"
                aria-controls={bodyId}
                icon={<ChevronDown aria-hidden="true" className={ICON} />}
                onClick={() => setExpanded(false)}
                className="shrink-0"
              />
            )}
          </div>
        </div>
        {onDateChange && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="장면 날짜"
              value={dateValue}
              onChange={(event) => {
                const parts = parseSceneDate(event.target.value);
                if (parts) onDateChange(parts);
              }}
              className={FIELD}
            />
            <input
              type="time"
              step={60}
              aria-label="장면 시각 입력"
              aria-invalid={typedInvalid ? "true" : "false"}
              value={typedInvalid ? typed.text : timeLabel}
              onChange={handleTyped}
              onBlur={() => setTyped(null)}
              className={FIELD}
            />
          </div>
        )}
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
          className="time-range mt-2 w-full accent-[var(--colors-primary)]"
        />
        <div className={TICKS} aria-hidden="true">
          {HOURS.map((hour) => (
            <span key={hour} data-qa="time-tick" className="flex w-0 flex-col items-center gap-0.5">
              <span aria-hidden="true" className="h-1 w-px bg-hairline-strong" />
              <span className={tickLabelClass(hour)}>{String(hour).padStart(2, "0")}</span>
            </span>
          ))}
        </div>
        {caption && <div className="mt-2 border-t border-hairline pt-2">{caption}</div>}
      </div>
    </section>
  );
}

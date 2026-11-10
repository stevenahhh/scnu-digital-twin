import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Clock3, Pause, Play } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { Popover } from "../ui/Popover.jsx";
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

const RANGE_LABEL = "시각 (KST)";
// 정밀 포인터에서는 슬라이더 히트 영역을 24px로 둔다. index.css의 input[type="range"](18px)보다 앞서야 해서 클래스 둘을
// 묶은 선택자를 쓰고, 굵은 포인터·폰 폭에서는 index.css의 44px 규칙이 그대로 남는다.
const RANGE = "time-range mt-2 w-full accent-[var(--colors-primary)] [@media(pointer:fine)]:[&.time-range]:h-6";

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
  // 기본 날짜·시각 입력은 안쪽(그림자 DOM)의 칸과 달력 단추가 따로 포커스를 받아 입력 요소에 :focus가 걸리지 않을 때가
  // 있으므로 다른 조작과 같은 포커스 테두리를 :focus-within으로 그린다.
  "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary",
);
const ICON = "h-3.5 w-3.5";
// 갱신 강조(ideal-state MOT-09): 사람이 시각을 한 번에 바꾼 때(슬라이더를 놓거나 키로 옮김, 날짜, `지금`)만 시각 값에 1초 wash.
// 끌고 있는 동안(input)과 재생 중에는 강조하지 않는다.
const UPDATED_MS = 1000;
const UPDATED_WASH = "rounded-control bg-surface-3";
const READOUT = "text-body font-semibold tabular-nums text-ink";
// 시간 카드는 화면 아래에 붙어 있으므로 편집 팝오버를 트리거 위로 연다. Popover는 트리거 아래(top-full + 0.5rem)에
// 놓이므로 자기 높이 + 트리거 높이(2rem, 굵은 포인터 2.75rem) + 두 간격(1rem)만큼 올린다.
const POPOVER_ABOVE = "-translate-y-[calc(100%_+_3rem)] [@media(pointer:coarse)]:-translate-y-[calc(100%_+_3.75rem)]";
// 눈금: 0..24시 25개의 짧은 금. 글자는 데스크톱에서 3시간마다, 폰에서 6시간마다(25개 글자는 24rem에 붙어 읽히지 않는다).
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const TICKS = "mt-1 flex justify-between text-caption font-medium tabular-nums text-ink-muted";
const tickLabelClass = (hour) => (hour % 6 === 0 ? "" : hour % 3 === 0 ? "hidden sm:inline" : "invisible");

// 장면 시각을 정하고 보여 주는 하나뿐인 조작: 시각 값, `지금`(실시간으로 돌아감), 재생, 0..1439분 슬라이더와 시간 눈금.
// 시각 값 단추를 누르면 날짜와 정확한 시각을 넣는 팝오버가 열린다(첫 화면에는 입력 칸이 없다).
// 키보드: 화살표 ±1분, Shift+화살표 ±10분, PageUp/PageDown ±60분, Home/End 0시/23:59(sceneClock.minuteForKey).
// collapsible(폰): 처음에는 장면 시각 칩만 보이고, 누르면 카드가 펼쳐지며 날짜·시각 입력도 카드 안에 함께 놓인다.
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
  const [updated, setUpdated] = useState(false);
  const updatedTimer = useRef(null);
  const rangeRef = useRef(null);
  const timeLabel = formatMinuteOfDay(minuteOfDay);
  useEffect(() => {
    minuteRef.current = minuteOfDay;
  }, [minuteOfDay]);

  const markUpdated = () => {
    window.clearTimeout(updatedTimer.current);
    setUpdated(true);
    updatedTimer.current = window.setTimeout(() => setUpdated(false), UPDATED_MS);
  };
  useEffect(() => () => window.clearTimeout(updatedTimer.current), []);
  // React의 onChange는 끌 때마다(input) 불린다. 놓거나 키로 확정한 값은 브라우저의 change 이벤트에서만 알 수 있다.
  useEffect(() => {
    const range = rangeRef.current;
    if (!range) return undefined;
    range.addEventListener("change", markUpdated);
    return () => range.removeEventListener("change", markUpdated);
  }, []);
  const updatedProps = updated ? { "data-updated": "true" } : {};

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
    markUpdated();
  };

  // 잘못된 시각(예: 25:99)은 슬라이더를 움직이지 않고 입력 칸만 aria-invalid로 표시한다.
  const handleTyped = (event) => {
    const text = event.target.value;
    const minute = parseTypedTime(text);
    setTyped({ text, invalid: minute === null });
    if (minute !== null) onMinuteChange(minute);
  };
  const typedInvalid = Boolean(typed?.invalid);
  const valueQa = collapsed ? undefined : "time-slider-value";

  const fields = onDateChange && (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        aria-label="장면 날짜"
        value={dateValue}
        onChange={(event) => {
          const parts = parseSceneDate(event.target.value);
          if (parts) {
            onDateChange(parts);
            markUpdated();
          }
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
  );

  const value = fields && !collapsible ? (
    <Popover
      label="장면 날짜와 시각"
      qa="time-edit-popover"
      className={POPOVER_ABOVE}
      renderTrigger={(props) => (
        <Button
          {...props}
          variant="ghost"
          size="sm"
          data-qa="time-value"
          aria-label={`장면 시각 ${timeLabel}, 날짜와 시각 바꾸기`}
        >
          <span data-qa={valueQa} {...updatedProps} className={cx(READOUT, updated && UPDATED_WASH)}>{timeLabel}</span>
          <ChevronDown aria-hidden="true" className={cx(ICON, "text-ink")} />
        </Button>
      )}
    >
      {fields}
    </Popover>
  ) : (
    <span data-qa={valueQa} {...updatedProps} className={cx(READOUT, "px-1", updated && UPDATED_WASH)}>{timeLabel}</span>
  );

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
          <Clock3 aria-hidden="true" className={cx(ICON, "shrink-0")} />
          <span>장면</span>
          <span data-qa="time-slider-value" {...updatedProps} className={cx(READOUT, updated && UPDATED_WASH)}>{timeLabel}</span>
          {playing && <Play aria-label="재생 중" className={ICON} />}
          <ChevronUp aria-hidden="true" className={ICON} />
          <span className="sr-only">시간 조작 펼치기</span>
        </button>
      )}
      <div id={bodyId} hidden={collapsed}>
        <div className="flex items-center gap-2">
          {value}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {onNow && (
              <Button
                size="sm"
                data-qa="time-now"
                onClick={() => {
                  onNow();
                  markUpdated();
                }}
                aria-pressed={live}
                icon={live ? <Check aria-hidden="true" className={ICON} /> : undefined}
                className="shrink-0"
              >
                지금
                {live && <> <span className="text-ink-muted">실시간</span></>}
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
        {fields && collapsible && <div className="mt-2">{fields}</div>}
        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={MINUTES_PER_DAY - 1}
          step={1}
          value={wrapMinuteOfDay(minuteOfDay)}
          aria-label={RANGE_LABEL}
          aria-valuetext={timeLabel}
          onChange={(event) => onMinuteChange(Number(event.target.value))}
          onKeyDown={handleKeyDown}
          className={RANGE}
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

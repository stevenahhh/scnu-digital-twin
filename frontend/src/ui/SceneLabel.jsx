import { useState } from "react";
import { StatusBadge } from "./StatusBadge.jsx";
import { cx } from "./cx.mjs";

export const SCENE_LABEL_STATES = ["idle", "hover", "focus", "selected", "dimmed", "no-data", "stale", "estimated", "motion"];

// 글자 크기: 데스크톱 12px(--text-caption). 640px 미만에서는 같은 토큰의 폰 단계(15px)로 커지고,
// 640px 이상이지만 굵은 포인터(터치)면 14px(--text-body 데스크톱 단계)로 올린다. transform으로 줄이지 않는다.
export const LABEL_TEXT = "text-caption [@media(pointer:coarse)_and_(min-width:640px)]:text-body";
// 버튼(누르는 영역)은 포인터 32px, 굵은 포인터·폰 44px. 보이는 칩과 글자는 그대로이고 투명한 영역만 커진다.
export const LABEL_HIT = "min-h-8 [@media(pointer:coarse)]:min-h-11 max-[639px]:min-h-11";

// 선택: 강조색 테두리와 강조색 글자. 글자는 강조색을 ink 쪽으로 섞어 두 테마 모두 4.5:1을 넘긴다.
const SELECTED_INK = "text-[color:color-mix(in_srgb,var(--colors-primary)_75%,var(--colors-ink))]";
const HALO = "[text-shadow:0_0_1px_var(--colors-label-halo),0_0_2px_var(--colors-label-halo)]";
const CHIP_FOCUS = "group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary";

const STATE_CHIP = {
  idle: "",
  hover: "bg-surface-2 shadow-popover",
  focus: "outline outline-2 outline-offset-2 outline-primary",
  selected: `border-2 border-primary font-semibold ${SELECTED_INK}`,
  dimmed: "opacity-60",
  "no-data": "",
  stale: "",
  estimated: "",
  motion: "opacity-40",
};

function StateDot({ state }) {
  if (state === "no-data") return <span aria-hidden="true" data-qa="label-dot" className="h-2 w-2 shrink-0 rounded-pill border border-ink-subtle" />;
  if (state === "stale") return <span aria-hidden="true" data-qa="label-dot" className="h-2 w-2 shrink-0 rounded-pill bg-ink-subtle" />;
  return null;
}

function Leader({ leader }) {
  if (!leader) return null;
  return (
    <svg aria-hidden="true" data-qa="label-leader" className="pointer-events-none absolute left-1/2 top-full overflow-visible text-hairline-strong" width="1" height="1">
      <line x1="0" y1="0" x2={leader.dx} y2={leader.dy} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

// 장면 라벨 칩: 캠퍼스 건물 이름표와 D4 층·호실 이름표(size="sm")가 같은 요소를 쓴다.
export function SceneLabel({
  name,
  elementId,
  tier = 2,
  state = "idle",
  code,
  value,
  estimatedName = state === "estimated",
  leader = null,
  size = "md",
  onSelect,
  className,
  ...rest
}) {
  const accessibleName = estimatedName ? `${code ? `${code} ` : ""}${name}, 명칭 추정` : undefined;
  return (
    <button
      type="button"
      data-qa="campus-label"
      data-element-id={elementId}
      data-tier={tier}
      data-state={state}
      data-estimated={estimatedName ? "true" : undefined}
      aria-label={accessibleName}
      aria-pressed={state === "selected"}
      onClick={() => onSelect?.(elementId)}
      className={cx(
        "group relative inline-flex items-center justify-center bg-transparent p-0 outline-none",
        // 버튼도 칩 글자 크기를 가진다(브라우저 기본 16 px가 아니라). 칩의 글자 크기를 재는 쪽이 버튼을 읽어도 같은 값이다.
        LABEL_TEXT,
        LABEL_HIT,
        // 마우스를 올린 건물(칩이나 그 메시)의 칩은 한 단계 떠오른다(그림자와 함께 2 px 위로). 2 px는 전환 없이 바로 옮긴다:
        // 멈춘 화면(frameloop demand)에서는 그릴 프레임이 거의 없어 CSS 전환이 끝나지 않은 채 남았다.
        state === "hover" && "-translate-y-0.5",
        className,
      )}
      {...rest}
    >
      <span
        data-qa="label-chip"
        className={cx(
          "inline-flex max-w-40 items-center gap-1 rounded-control border border-hairline bg-[var(--colors-label-bg)] font-medium text-ink",
          "transition-[opacity,background-color,box-shadow] duration-state motion-reduce:transition-none",
          size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1",
          LABEL_TEXT,
          HALO,
          CHIP_FOCUS,
          state !== "selected" && "group-hover:bg-surface-2 group-hover:shadow-popover",
          estimatedName && "border-dashed",
          STATE_CHIP[state],
        )}
      >
        <StateDot state={state} />
        {code && <StatusBadge tone="neutral">{code}</StatusBadge>}
        {estimatedName && (
          <span aria-hidden="true" data-qa="label-estimated-glyph" className="shrink-0 text-ink-muted">
            ≈
          </span>
        )}
        <span className="line-clamp-2 break-keep text-left">{name}</span>
        {value && (
          <span data-qa="label-value" className={cx("shrink-0 tabular-nums text-ink-muted", state === "hover" ? "inline" : "hidden group-hover:inline")}>
            {value}
          </span>
        )}
      </span>
      <Leader leader={leader} />
    </button>
  );
}

// 별관처럼 가까이 가기 전에는 이름을 감추는 건물의 8px 점. 마우스를 올리거나 처음 누르면 칩으로 펼쳐지고, 펼친 상태에서 누르면 고른다.
export function DotMarker({ name, elementId, selected = false, onSelect, className }) {
  const [expanded, setExpanded] = useState(false);
  const open = expanded || selected;

  const handleClick = () => {
    if (!open) {
      setExpanded(true);
      return;
    }
    onSelect?.(elementId);
  };

  return (
    <button
      type="button"
      data-qa="campus-dot"
      data-element-id={elementId}
      data-expanded={open ? "true" : "false"}
      aria-label={name}
      aria-pressed={selected}
      onPointerEnter={(event) => event.pointerType === "mouse" && setExpanded(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
      onClick={handleClick}
      className={cx("group relative inline-flex min-h-6 min-w-6 items-center justify-center bg-transparent p-0 outline-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11", className)}
    >
      {open ? (
        <span
          aria-hidden="true"
          className={cx(
            "inline-flex max-w-40 items-center gap-1 rounded-control border border-hairline bg-[var(--colors-label-bg)] px-2 py-1 font-medium text-ink",
            LABEL_TEXT,
            HALO,
            CHIP_FOCUS,
            selected && `border-2 border-primary font-semibold ${SELECTED_INK}`,
          )}
        >
          <span className="h-2 w-2 shrink-0 rounded-pill bg-ink-muted" />
          <span className="line-clamp-2 break-keep text-left">{name}</span>
        </span>
      ) : (
        <span aria-hidden="true" data-qa="dot" className={cx("h-2 w-2 rounded-pill border border-[var(--colors-label-halo)] bg-ink-muted", CHIP_FOCUS)} />
      )}
    </button>
  );
}

// 구역 이름(개요 단계). 누를 수 없고 화면 읽기 프로그램에는 숨긴다. 구역 안 건물 칩이 이름을 알린다.
export function ZoneLabel({ name, className }) {
  return (
    <span
      aria-hidden="true"
      data-qa="zone-label"
      data-tier="0"
      className={cx("pointer-events-none select-none break-keep text-body font-semibold tracking-wide text-ink-muted", HALO, className)}
    >
      {name}
    </span>
  );
}

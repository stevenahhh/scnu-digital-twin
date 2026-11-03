import { useRef } from "react";
import { cx } from "./cx.mjs";
import { COARSE_TARGET, FOCUS_RING } from "./Button.jsx";
import { Check } from "lucide-react";

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

// 트랙과 칸이 모두 pill이라 안쪽 반지름이 바깥 반지름에서 트랙 안 여백(p-1)을 뺀 값과 같은 동심원이 된다.
// 활성 칸은 어디서나 같은 모양 하나: surface-2 바탕, ink 글자, 이름 앞 4px 점. 강조색 테두리·채움은 쓰지 않는다.
export function Segmented({ kind = "tabs", label, options, value, onChange, size = "md", className, ...rest }) {
  const itemRefs = useRef([]);
  const enabled = options.filter((option) => !option.disabled);
  const isTabs = kind === "tabs";

  const move = (fromValue, step) => {
    const from = enabled.findIndex((option) => option.value === fromValue);
    const target = enabled[(from + step + enabled.length) % enabled.length];
    if (!target) return;
    onChange?.(target.value);
    itemRefs.current[options.indexOf(target)]?.focus();
  };

  const handleKeyDown = (event, optionValue) => {
    if (NEXT_KEYS.has(event.key)) move(optionValue, 1);
    else if (PREV_KEYS.has(event.key)) move(optionValue, -1);
    else if (event.key === "Home") move(enabled[0]?.value, 0);
    else if (event.key === "End") move(enabled[enabled.length - 1]?.value, 0);
    else return;
    event.preventDefault();
  };

  // 선택된 값이 없으면 처음 쓸 수 있는 칸이 Tab을 받는다(로빙 tabindex).
  const tabStop = options.some((option) => option.value === value && !option.disabled) ? value : enabled[0]?.value;

  return (
    <div
      role={isTabs ? "tablist" : "radiogroup"}
      aria-label={label}
      className={cx("flex w-full gap-1 rounded-pill border border-hairline bg-surface-1 p-1", className)}
      {...rest}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role={isTabs ? "tab" : "radio"}
            id={option.id}
            aria-selected={isTabs ? active : undefined}
            aria-checked={isTabs ? undefined : active}
            aria-controls={option.controls}
            aria-disabled={option.disabled ? "true" : undefined}
            title={option.disabled ? option.disabledReason : undefined}
            tabIndex={option.value === tabStop ? 0 : -1}
            data-active={active ? "true" : undefined}
            data-qa={option.qa}
            onClick={() => !option.disabled && !active && onChange?.(option.value)}
            onKeyDown={(event) => handleKeyDown(event, option.value)}
            className={cx(
              "inline-flex flex-1 basis-0 items-center justify-center gap-2 rounded-control border font-medium",
              "transition-colors duration-micro",
              size === "sm" ? "min-h-8 px-2 text-caption" : "min-h-10 px-3 text-body",
              COARSE_TARGET,
              FOCUS_RING,
              active
                ? "border-hairline-strong bg-surface-2 text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
              option.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {active && <Check aria-hidden="true" className="h-3 w-3 shrink-0" data-qa="segment-dot" />}
            <span className="break-keep sm:whitespace-nowrap">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

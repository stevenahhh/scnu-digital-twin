import { COARSE_TARGET } from "./Button.jsx";
import { cx } from "./cx.mjs";

const KEY_STEPS = { ArrowDown: -1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// 이름·현재 값 한 줄과 범위 입력 하나. 지도(3D·VWorld)가 같은 입력을 카메라 조작으로 받지 않도록
// 포인터·키 입력은 여기서 멈추고 값은 직접 계산한다.
export function SliderRow({ label, valueLabel, min, max, step = 1, value, onValueChange, className }) {
  const stopMapHandling = (event) => event.stopPropagation();
  const updateFromPointer = (event) => {
    event.stopPropagation();
    const { left, width } = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - left) / width, 0, 1);
    onValueChange(clamp(min + Math.round(((max - min) * ratio) / step) * step, min, max));
  };
  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateFromPointer(event);
  };
  const handlePointerMove = (event) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) updateFromPointer(event);
  };
  const handleKeyDown = (event) => {
    event.stopPropagation();
    let nextValue;
    if (event.key === "Home") nextValue = min;
    else if (event.key === "End") nextValue = max;
    else if (event.key in KEY_STEPS) nextValue = value + KEY_STEPS[event.key] * step;
    else return;
    event.preventDefault();
    onValueChange(clamp(nextValue, min, max));
  };

  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3 text-body">
        <span className="break-keep text-ink-muted">{label}</span>
        <span className="font-medium tabular-nums text-ink">{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onValueChange(Number(event.target.value))}
        onClick={stopMapHandling}
        onKeyDown={handleKeyDown}
        onMouseDown={stopMapHandling}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onTouchStart={stopMapHandling}
        className={cx("pointer-events-auto w-full accent-[var(--colors-primary)]", COARSE_TARGET)}
      />
    </div>
  );
}

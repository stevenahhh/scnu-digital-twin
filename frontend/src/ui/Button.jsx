import { forwardRef } from "react";
import { LoaderCircle } from "lucide-react";
import { cx } from "./cx.mjs";

// 강조색 채움은 primary 하나뿐이다. 같은 면에서 primary는 한 번만 쓰고 나머지는 secondary·ghost로 둔다.
export const BUTTON_VARIANTS = {
  primary: "bg-primary text-on-primary hover:brightness-90 active:brightness-75",
  secondary: "border border-hairline-strong bg-surface-1 text-ink hover:bg-surface-2 active:bg-surface-3",
  ghost: "bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink active:bg-surface-3",
};

// 데스크톱 32/40px, 굵은 포인터(터치)에서는 둘 다 44px.
export const BUTTON_SIZES = {
  sm: "min-h-8 px-3 text-caption",
  md: "min-h-10 px-4 text-body",
};

export const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
export const COARSE_TARGET = "[@media(pointer:coarse)]:min-h-11";

export const Button = forwardRef(function Button(
  {
    variant = "secondary",
    size = "md",
    type = "button",
    icon = null,
    iconOnly = false,
    label,
    disabled = false,
    disabledReason,
    loading = false,
    onClick,
    className,
    children,
    ...rest
  },
  ref,
) {
  const inactive = disabled || loading;
  const accessibleLabel = iconOnly ? label : undefined;
  const title = disabled && disabledReason ? disabledReason : accessibleLabel;

  // disabled 대신 aria-disabled를 써서 포커스와 title 툴팁(비활성 사유)이 살아 있게 한다.
  const handleClick = (event) => {
    if (inactive) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      type={type}
      aria-label={accessibleLabel}
      aria-disabled={inactive ? "true" : undefined}
      aria-busy={loading ? "true" : undefined}
      title={title}
      data-variant={variant}
      data-size={size}
      onClick={handleClick}
      className={cx(
        // 누르는 동안 1px 내려앉는다. 바탕색은 전환 없이 바로 바뀌고 글자색과 밝기만 짧게 전환한다(DESIGN 6절).
        "relative inline-flex select-none items-center justify-center gap-2 rounded-control font-medium active:translate-y-px",
        "transition-[color,filter] duration-micro",
        BUTTON_VARIANTS[variant],
        iconOnly ? (size === "sm" ? "min-h-8 min-w-8 px-0 text-caption" : "min-h-10 min-w-10 px-0 text-body") : BUTTON_SIZES[size],
        COARSE_TARGET,
        iconOnly && "[@media(pointer:coarse)]:min-w-11",
        FOCUS_RING,
        disabled && "cursor-not-allowed opacity-50",
        loading && "cursor-progress",
        className,
      )}
      {...rest}
    >
      <span className={cx("inline-flex items-center gap-2", loading && "invisible")}>
        {icon}
        {!iconOnly && children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center" data-qa="button-spinner">
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        </span>
      )}
    </button>
  );
});

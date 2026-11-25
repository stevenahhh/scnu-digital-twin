import { forwardRef } from "react";
import { LoaderCircle } from "lucide-react";
import {
  Button as ShadcnButton,
  buttonSizeClasses,
  buttonVariantClasses,
  COARSE_TARGET,
  FOCUS_RING,
} from "@/components/ui/button";
import { cn } from "@/lib/utils";

export { COARSE_TARGET, FOCUS_RING };

const SHADCN_VARIANT = { primary: "default", secondary: "outline", ghost: "ghost" };
const SHADCN_SIZE = { sm: "sm", md: "default" };
const SHADCN_ICON_SIZE = { sm: "icon-sm", md: "icon" };

// 강조색 채움은 primary 하나뿐이다. 같은 면에서 primary는 한 번만 쓰고 나머지는 secondary·ghost로 둔다.
export const BUTTON_VARIANTS = {
  primary: buttonVariantClasses[SHADCN_VARIANT.primary],
  secondary: buttonVariantClasses[SHADCN_VARIANT.secondary],
  ghost: buttonVariantClasses[SHADCN_VARIANT.ghost],
};

export const BUTTON_SIZES = {
  sm: buttonSizeClasses[SHADCN_SIZE.sm],
  md: buttonSizeClasses[SHADCN_SIZE.md],
};

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
    <ShadcnButton
      ref={ref}
      type={type}
      variant={SHADCN_VARIANT[variant]}
      size={iconOnly ? SHADCN_ICON_SIZE[size] : SHADCN_SIZE[size]}
      aria-label={accessibleLabel}
      aria-disabled={inactive ? "true" : undefined}
      aria-busy={loading ? "true" : undefined}
      title={title}
      data-variant={variant}
      data-size={size}
      onClick={handleClick}
      className={cn(disabled && "cursor-not-allowed opacity-50", loading && "cursor-progress", className)}
      {...rest}
    >
      <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
        {icon}
        {!iconOnly && children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center" data-qa="button-spinner">
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        </span>
      )}
    </ShadcnButton>
  );
});

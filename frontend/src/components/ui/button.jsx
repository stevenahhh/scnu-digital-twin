import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

export const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
export const COARSE_TARGET = "[@media(pointer:coarse)]:min-h-11";
const COARSE_SQUARE = "[@media(pointer:coarse)]:min-w-11";

// 강조색 채움은 default 하나뿐이다. 바탕색은 전환 없이 바로 바뀌고 글자색과 밝기만 짧게 전환한다(DESIGN 6절).
export const buttonVariantClasses = {
  default: "bg-primary text-on-primary hover:brightness-90 active:brightness-75",
  destructive: "bg-destructive text-destructive-foreground hover:brightness-90 active:brightness-75",
  outline: "border border-hairline-strong bg-surface-1 text-ink hover:bg-accent active:bg-surface-3",
  secondary: "bg-secondary text-secondary-foreground hover:bg-surface-3",
  ghost: "bg-transparent text-ink-muted hover:bg-accent hover:text-accent-foreground active:bg-surface-3",
  link: "text-primary underline-offset-4 hover:underline",
};

// 글자가 길면 줄을 바꿀 수 있게 높이는 min-h로 둔다. 데스크톱 32/40px, 굵은 포인터에서는 44px.
export const buttonSizeClasses = {
  default: "min-h-10 px-4 text-body",
  sm: "min-h-8 px-3 text-caption",
  lg: "min-h-11 px-8 text-body",
  icon: `min-h-10 min-w-10 px-0 text-body ${COARSE_SQUARE}`,
  "icon-sm": `min-h-8 min-w-8 px-0 text-caption ${COARSE_SQUARE}`,
};

// 아이콘 크기는 버튼 바로 아래 svg에만 정한다. 감싼 요소 안의 아이콘은 자기 크기를 지킨다.
const buttonVariants = cva(
  [
    "relative inline-flex select-none items-center justify-center gap-2 rounded-md font-medium transition-[color,filter] duration-micro active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&>svg]:size-4",
    COARSE_TARGET,
    FOCUS_RING,
  ],
  {
    variants: {
      variant: buttonVariantClasses,
      size: buttonSizeClasses,
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }

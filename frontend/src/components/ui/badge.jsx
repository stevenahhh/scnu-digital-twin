import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

// 의미색 톤: wash 바탕 위에 의미색을 ink 쪽으로 섞은 글자를 쓴다. 비율은 src/ui/badgeTones.mjs와 같아야 한다(badgeContrast.test.mjs가 4.5:1을 잰다).
const WARNING_TONE = "border-[color:color-mix(in_srgb,var(--colors-semantic-warning)_40%,var(--colors-surface-1))] bg-[var(--colors-semantic-warning-wash)] text-[color:color-mix(in_srgb,var(--colors-semantic-warning)_75%,var(--colors-ink))]";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-normal break-keep rounded-control border px-2 py-0 text-caption",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        neutral: "border-hairline bg-surface-2 text-ink-muted",
        success: "border-[color:color-mix(in_srgb,var(--colors-semantic-success)_40%,var(--colors-surface-1))] bg-[var(--colors-semantic-success-wash)] text-[color:color-mix(in_srgb,var(--colors-semantic-success)_75%,var(--colors-ink))]",
        warning: WARNING_TONE,
        danger: "border-[color:color-mix(in_srgb,var(--colors-semantic-danger)_40%,var(--colors-surface-1))] bg-[var(--colors-semantic-danger-wash)] text-[color:color-mix(in_srgb,var(--colors-semantic-danger)_75%,var(--colors-ink))]",
        // 추정값은 상태색으로 칠하지 않고 점선 테두리로 구분한다.
        estimate: "border-dashed border-hairline-strong bg-surface-1 text-ink-muted",
        sample: WARNING_TONE,
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

// 문장 안에도 놓이므로 div 대신 span으로 그린다.
function Badge({
  className,
  variant,
  ...props
}) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }

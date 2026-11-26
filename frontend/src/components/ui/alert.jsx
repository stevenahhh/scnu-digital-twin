import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative flex w-full flex-col gap-1 break-keep rounded-xl border px-4 py-3 text-body text-foreground [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background [&>svg]:text-foreground",
        destructive: "border-destructive/50 text-destructive [&>svg]:text-destructive",
        neutral: "bg-surface-2 [&>svg]:text-ink-muted",
        success: "bg-[var(--colors-semantic-success-wash)] [&>svg]:text-[color:color-mix(in_srgb,var(--colors-semantic-success)_75%,var(--colors-ink))]",
        warning: "bg-[var(--colors-semantic-warning-wash)] [&>svg]:text-[color:color-mix(in_srgb,var(--colors-semantic-warning)_75%,var(--colors-ink))]",
        danger: "bg-[var(--colors-semantic-danger-wash)] [&>svg]:text-[color:color-mix(in_srgb,var(--colors-semantic-danger)_75%,var(--colors-ink))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

// 알림 제목은 문서 제목 구조에 끼지 않는다(제목 수준을 건너뛰지 않게 h5 대신 p).
const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-body font-semibold text-foreground", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex min-w-0 flex-col gap-1 text-caption text-muted-foreground", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }

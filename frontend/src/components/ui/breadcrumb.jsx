import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { ChevronRight, MoreHorizontal } from "lucide-react"

import { COARSE_TARGET, FOCUS_RING } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const Breadcrumb = React.forwardRef(
  ({ ...props }, ref) => <nav ref={ref} aria-label="breadcrumb" {...props} />
)
Breadcrumb.displayName = "Breadcrumb"

const BreadcrumbList = React.forwardRef(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn(
      "flex flex-wrap items-center gap-1 text-caption text-muted-foreground",
      className
    )}
    {...props}
  />
))
BreadcrumbList.displayName = "BreadcrumbList"

const BreadcrumbItem = React.forwardRef(({ className, ...props }, ref) => (
  <li
    ref={ref}
    className={cn("inline-flex items-center gap-1", className)}
    {...props}
  />
))
BreadcrumbItem.displayName = "BreadcrumbItem"

const BreadcrumbLink = React.forwardRef(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "a"

  return (
    <Comp
      ref={ref}
      className={cn(
        "inline-flex min-h-8 items-center gap-1 break-keep rounded-md px-1 hover:bg-accent hover:text-foreground",
        COARSE_TARGET,
        FOCUS_RING,
        className
      )}
      {...props}
    />
  )
})
BreadcrumbLink.displayName = "BreadcrumbLink"

// 현재 위치는 링크가 아니고 화면 제목이 되기도 하므로(asChild로 h2 등) role="link"를 붙이지 않는다.
const BreadcrumbPage = React.forwardRef(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      ref={ref}
      aria-current="page"
      className={cn("inline-flex items-center gap-1 break-keep px-1 text-caption font-semibold text-foreground", className)}
      {...props}
    />
  )
})
BreadcrumbPage.displayName = "BreadcrumbPage"

// 구분자는 앞 단계의 항목 안에 놓는다. 목록 항목 수가 경로 단계 수와 같다.
const BreadcrumbSeparator = ({
  children,
  className,
  ...props
}) => (
  <span
    role="presentation"
    aria-hidden="true"
    className={cn("shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5", className)}
    {...props}
  >
    {children ?? <ChevronRight />}
  </span>
)
BreadcrumbSeparator.displayName = "BreadcrumbSeparator"

const BreadcrumbEllipsis = ({
  className,
  ...props
}) => (
  <span
    role="presentation"
    aria-hidden="true"
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More</span>
  </span>
)
BreadcrumbEllipsis.displayName = "BreadcrumbElipssis"

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}

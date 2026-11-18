import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }

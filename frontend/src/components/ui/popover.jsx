"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

// portalled={false}면 body 대신 제자리에 둔다. HUD 안의 면은 HUD의 쌓임 순서와 pointer-events를 그대로 물려받아야 한다.
// 등장 애니메이션은 쓰지 않는다. keyframe의 transform이 호출부의 transform 클래스(시간 카드의 위로 올리기)를 덮는다.
const PopoverContent = React.forwardRef(({ className, align = "center", sideOffset = 4, portalled = true, ...props }, ref) => {
  const content = (
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-modal w-72 rounded-xl border border-hairline bg-popover p-4 text-popover-foreground shadow-popover outline-none origin-[--radix-popover-content-transform-origin]",
        className
      )}
      {...props}
    />
  )
  return portalled ? <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal> : content
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }

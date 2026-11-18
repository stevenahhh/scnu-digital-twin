import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { COARSE_TARGET, FOCUS_RING } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// 펼침: 요약 버튼 하나와 그 아래로 자라는 내용. 열림 여부는 aria-expanded와 화살표 방향으로 보인다.
// 닫아도 내용을 언마운트하지 않아 안쪽 입력값이 유지된다(forceMount + hidden). Radix는 열렸을 때만
// aria-controls를 붙이므로, 닫힌 상태에서도 패널을 가리키도록 id를 직접 준다.
export function Disclosure({ summary, defaultOpen = false, open: openProp, onOpenChange, children, className, ...rest }) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const panelId = useId();

  const handleOpenChange = (next) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className={cn("flex flex-col", className)}
      data-open={open ? "true" : "false"}
      {...rest}
    >
      <CollapsibleTrigger
        aria-controls={panelId}
        className={cn(
          "inline-flex min-h-8 items-center gap-1 self-start rounded-md px-1 text-caption text-muted-foreground hover:text-foreground",
          COARSE_TARGET,
          FOCUS_RING,
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn("h-4 w-4 shrink-0 transition-transform duration-micro motion-reduce:transition-none", open && "rotate-90")}
        />
        {summary}
      </CollapsibleTrigger>
      <CollapsibleContent forceMount id={panelId} hidden={!open} className="pt-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

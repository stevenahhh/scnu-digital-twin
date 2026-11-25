import { useRef, useState } from "react";
import { Popover as PopoverRoot, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cx } from "./cx.mjs";

const SURFACE_WIDTH = "w-auto min-w-56 max-w-[min(20rem,calc(100vw-1rem))]";
const SIDE_OFFSET_PX = 8;
const EDGE_PADDING_PX = 8;

// anchor="container"일 때 트리거 기준 정렬을 가장 가까운 위치 지정 조상의 같은 가장자리까지 옮기는 값.
function containerAlignOffset(trigger, align) {
  const container = trigger.offsetParent?.getBoundingClientRect();
  if (!container) return 0;
  const rect = trigger.getBoundingClientRect();
  return align === "end" ? rect.right - container.right : container.left - rect.left;
}

// 닫히는 사이 포커스가 다른 곳(설정 면, 직접 복사 칸)으로 옮겨 갔으면 트리거로 되돌리지 않는다.
function keepMovedFocus(event) {
  const active = document.activeElement;
  if (active && active !== document.body && !event.currentTarget.contains(active)) event.preventDefault();
}

function useSurface({ label, align, anchor, qa, className }) {
  const triggerRef = useRef(null);
  const [open, setOpenState] = useState(false);
  const [alignOffset, setAlignOffset] = useState(0);
  const setOpen = (next) => {
    if (next && anchor === "container") setAlignOffset(containerAlignOffset(triggerRef.current, align));
    setOpenState(next);
  };
  const contentProps = {
    portalled: false,
    align,
    alignOffset,
    // 기본값 "partial"은 면을 트리거 곁으로 끌어당겨 줄 끝에 맞춘 위치를 되돌린다.
    sticky: anchor === "container" ? "always" : "partial",
    sideOffset: SIDE_OFFSET_PX,
    "aria-label": label,
    "data-qa": qa,
    className: cx(SURFACE_WIDTH, className),
    onCloseAutoFocus: keepMovedFocus,
  };
  return { open, setOpen, triggerRef, contentProps };
}

// 호출부의 className이 면의 위치를 transform으로 옮길 수 있어서(시간 카드) 충돌 회피로 면을 뒤집지 않는다.
function DialogPopover({ renderTrigger, children, ...surface }) {
  const { open, setOpen, triggerRef, contentProps } = useSurface(surface);
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <div className="inline-block">
        <PopoverTrigger ref={triggerRef} asChild>{renderTrigger({})}</PopoverTrigger>
        <PopoverContent {...contentProps} avoidCollisions={false} className={cx(contentProps.className, "p-3")}>
          {typeof children === "function" ? children({ close: () => setOpen(false) }) : children}
        </PopoverContent>
      </div>
    </PopoverRoot>
  );
}

// Radix 메뉴는 pointerdown에 열리고 첫 항목에 포커스를 주지 않는다. 이 앱의 트리거는 click으로 열고 닫으며(프로그램 클릭 포함),
// 열리면 첫 항목에 포커스가 간다. 트리거를 누르는 동작은 바깥 클릭으로 치지 않아야 click이 메뉴를 다시 열지 않는다.
function MenuPopover({ renderTrigger, children, ...surface }) {
  const { open, setOpen, triggerRef, contentProps } = useSurface(surface);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <div className="inline-block">
        <DropdownMenuTrigger
          ref={triggerRef}
          asChild
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setOpen(!open)}
        >
          {renderTrigger({})}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          {...contentProps}
          aria-labelledby={undefined}
          collisionPadding={EDGE_PADDING_PX}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            event.currentTarget.querySelector("[role^=menuitem]")?.focus({ preventScroll: true });
          }}
          onInteractOutside={(event) => {
            if (triggerRef.current?.contains(event.detail.originalEvent.target)) event.preventDefault();
          }}
        >
          {typeof children === "function" ? children({ close: () => setOpen(false) }) : children}
        </DropdownMenuContent>
      </div>
    </DropdownMenu>
  );
}

// 트리거에 붙어 뜨는 작은 면(범례, 시점 메뉴). shadcn Popover(role="dialog")나 DropdownMenu(role="menu") 위에 있다.
// Esc나 바깥 클릭으로 닫히고, Esc나 close()로 닫으면 포커스가 트리거로 돌아간다. 면은 제자리에 렌더링한다.
// renderTrigger는 트리거 버튼에 펼칠 속성을 받고, 돌려준 요소에 Radix가 ref와 핸들러, aria-*를 합친다.
// children이 함수면 close()를 받는다. role="menu"의 children은 DropdownMenu 항목이고 항목을 고르면 메뉴가 저절로 닫힌다.
// anchor="container"면 면을 트리거가 아니라 가장 가까운 위치 지정 조상(예: HUD 한 줄)의 가장자리에 맞춘다. 좁은 줄 가운데의
// 트리거에 오른쪽을 맞추면 면이 화면 왼쪽 밖으로 나가는 폰 HUD가 쓴다.
export function Popover({ role = "dialog", align = "start", anchor = "trigger", ...props }) {
  const Surface = role === "menu" ? MenuPopover : DialogPopover;
  return <Surface align={align} anchor={anchor} {...props} />;
}

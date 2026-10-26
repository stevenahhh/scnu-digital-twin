import { forwardRef, useCallback, useEffect, useRef } from "react";
import { Car, ChevronLeft, ChevronRight, ChevronUp, LayoutDashboard, Leaf, Zap } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { Sheet } from "../ui/Sheet.jsx";
import { cx } from "../ui/cx.mjs";
import { useInert } from "../hooks/useInert.mjs";
import { DASHBOARD_TABS, DashboardPanel } from "./DashboardPanel.jsx";
import { Wordmark } from "./Wordmark.jsx";

const TAB_ICONS = { dashboard: LayoutDashboard, parking_safety: Car, energy: Zap, environment: Leaf };
const TARGET_44 = "h-11 min-h-11 w-11 min-w-11";
// 폰 시트 peek: 손잡이(48) + 머리 두 줄(시각·워드마크·여닫기 44, 갱신 표시·검색 44) + 사이 4 + 아래 8. 화면의 25 % 미만.
export const SHELL_PEEK_HEIGHT = 148;
const SURFACE_MOTION = "transition-transform duration-surface ease-[var(--motion-ease-standard)] motion-reduce:transition-none";

// 패널이 차지하는 오른쪽 폭: 지도와 HUD는 이만큼 비켜 선다. 태블릿 서랍과 폰 시트는 장면 위에 겹친다.
export function shellInsetRight(mode, open) {
  if (mode === "phone") return "0px";
  if (mode === "desktop" && open) return "var(--dashboard-panel-width)";
  return "var(--dashboard-rail-width)";
}

// 화면 폭에 따라 패널 그릇을 고른다(useViewportMode).
// desktop: 오른쪽 붙박이 패널, 닫으면 56px 레일(탭 아이콘 넷 + 패널 열기). transform으로 밀려난다.
// tablet: 오른쪽에서 겹쳐 나오는 서랍(min(440px, 85vw)), 가림막 없음, Esc로 닫고 포커스는 패널 열기로 돌아간다.
// phone: 바텀 시트. 처음에는 peek, 탭을 누르면 full. 시트 머리에 시각과 두 칸(freshnessSlot, searchSlot)이 있다.
export const DashboardShell = forwardRef(function DashboardShell(
  {
    mode, open, onOpenChange, detent, onDetentChange, hidden = false,
    activeTab, onTabChange, extraTabs = [], timeReadout = null, freshnessSlot = null, searchSlot = null, footer, scrollRef, children,
  },
  panelRef,
) {
  const toggleRef = useRef(null);
  const contentRef = useRef(null);
  const shellRef = useRef(null);
  const wasOpen = useRef(open);
  const attachShell = useCallback((node) => {
    shellRef.current = node;
    if (typeof panelRef === "function") panelRef(node);
    else if (panelRef) panelRef.current = node;
  }, [panelRef]);

  // D4 상세가 열린 동안(hidden)에는 셸 전체를, 데스크톱·태블릿에서 레일로 접힌 동안에는 패널 내용만 포커스에서 뺀다.
  useInert([shellRef], hidden, [mode]);
  useInert([contentRef], mode !== "phone" && !open, [mode]);
  // 서랍·패널을 닫으면(Esc 포함) 포커스를 레일의 패널 열기로 돌려준다.
  useEffect(() => {
    if (wasOpen.current && !open && contentRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (mode === "phone") {
    const expanded = detent !== "peek";
    const selectTab = (tab) => {
      onTabChange(tab);
      onDetentChange("full");
    };
    return (
      <Sheet
        ref={attachShell}
        label="대시보드"
        aria-hidden={hidden ? "true" : undefined}
        data-qa="dashboard-panel"
        detent={detent}
        onDetentChange={onDetentChange}
        peekHeight={SHELL_PEEK_HEIGHT}
        className={hidden ? "invisible" : undefined}
        header={(
          <div className="flex flex-col gap-1">
            <div className="flex h-11 items-center gap-2">
              {timeReadout && <p data-qa="sheet-time" className="shrink-0 text-body font-semibold tabular-nums text-ink">{timeReadout}</p>}
              <Wordmark className="ml-auto shrink-0 text-ink-muted" />
              <Button
                variant="ghost"
                iconOnly
                label={expanded ? "패널 닫기" : "패널 열기"}
                icon={<ChevronUp aria-hidden="true" className={cx("h-5 w-5", expanded && "rotate-180")} />}
                onClick={() => onDetentChange(expanded ? "peek" : "half")}
                className={TARGET_44}
              />
            </div>
            <div className="flex min-h-11 items-center gap-2 overflow-x-auto">
              {freshnessSlot}
              {searchSlot && <div className="min-w-0 flex-1">{searchSlot}</div>}
            </div>
          </div>
        )}
      >
        <DashboardPanel activeTab={activeTab} onTabChange={selectTab} extraTabs={extraTabs} footer={footer} scrollRef={scrollRef}>
          {children}
        </DashboardPanel>
      </Sheet>
    );
  }

  const handleKeyDown = (event) => {
    if (event.key !== "Escape" || mode !== "tablet" || !open) return;
    event.stopPropagation();
    onOpenChange(false);
  };

  return (
    <div
      ref={attachShell}
      data-qa="dashboard-panel"
      aria-hidden={hidden ? "true" : undefined}
      data-mode={mode}
      data-open={open ? "true" : "false"}
      onKeyDown={handleKeyDown}
      className={cx("pointer-events-none absolute inset-y-0 right-0 z-10", SURFACE_MOTION, hidden && "invisible")}
      style={{
        width: mode === "tablet" ? "min(440px, 85vw)" : "var(--dashboard-panel-width)",
        transform: open ? "translateX(0)" : "translateX(calc(100% - var(--dashboard-rail-width)))",
      }}
    >
      {/* 레일로 접힌 동안 내용은 레일 밑에 남지만 보이지도, 닿지도 않는다(스크롤 위치는 그대로 지킨다). */}
      <div ref={contentRef} aria-hidden={open ? undefined : "true"} className={cx("pointer-events-auto h-full border-l border-hairline", !open && "invisible")}>
        <DashboardPanel
          activeTab={activeTab}
          onTabChange={onTabChange}
          extraTabs={extraTabs}
          footer={footer}
          scrollRef={scrollRef}
          headerAction={open && (
            <Button
              variant="ghost"
              iconOnly
              label="패널 닫기"
              icon={<ChevronRight aria-hidden="true" className="h-5 w-5" />}
              onClick={() => onOpenChange(false)}
              className={TARGET_44}
            />
          )}
        >
          {children}
        </DashboardPanel>
      </div>
      {!open && (
        <nav
          aria-label="대시보드 레일"
          data-qa="dashboard-rail"
          className="pointer-events-auto absolute inset-y-0 left-0 flex w-[var(--dashboard-rail-width)] flex-col items-center gap-2 border-l border-hairline bg-surface-1 py-4"
        >
          <Button
            ref={toggleRef}
            variant="ghost"
            iconOnly
            label="패널 열기"
            icon={<ChevronLeft aria-hidden="true" className="h-5 w-5" />}
            onClick={() => onOpenChange(true)}
            className={TARGET_44}
          />
          <span aria-hidden="true" className="h-px w-8 bg-hairline" />
          {DASHBOARD_TABS.map((tab) => {
            const Icon = TAB_ICONS[tab.value];
            return (
              <Button
                key={tab.value}
                variant="ghost"
                iconOnly
                label={tab.label}
                data-qa={`dashboard-tab-${tab.value}`}
                aria-current={tab.value === activeTab ? "page" : undefined}
                icon={<Icon aria-hidden="true" className="h-5 w-5" />}
                onClick={() => {
                  onTabChange(tab.value);
                  onOpenChange(true);
                }}
                className={cx(TARGET_44, tab.value === activeTab && "bg-surface-2 text-ink")}
              />
            );
          })}
        </nav>
      )}
    </div>
  );
});

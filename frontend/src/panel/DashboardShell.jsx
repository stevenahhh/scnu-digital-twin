import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Building2, ChevronRight, ChevronUp, FlaskConical, LayoutDashboard, Zap } from "lucide-react";
import { AlertDot } from "../ui/AlertDot.jsx";
import { Button } from "../ui/Button.jsx";
import { Sheet } from "../ui/Sheet.jsx";
import { cx } from "../ui/cx.mjs";
import { useInert } from "../hooks/useInert.mjs";
import { DASHBOARD_TABS, DashboardPanel, dashboardTitle } from "./DashboardPanel.jsx";
import { alertLabel, totalTabAlerts } from "./tabAlerts.mjs";

const TAB_ICONS = { building: Building2, status: LayoutDashboard, energy: Zap, simulation: FlaskConical };
const TARGET_44 = "h-11 min-h-11 w-11 min-w-11";
// 폰 시트 peek: 손잡이(48) + 머리 한 줄(탭 이름·여닫기 44) + 아래 8.
export const SHELL_PEEK_HEIGHT = 100;
// --motion-surface와 같은 값. 레일과 HUD 자리는 슬라이드가 시작 프레임까지 포함해 다 끝난 뒤(SETTLE_MS)에 바꾼다.
export const SURFACE_MS = 300;
export const SETTLE_MS = SURFACE_MS + 50;
const SURFACE_MOTION = "transition-transform duration-surface ease-[var(--motion-ease-standard)] motion-reduce:transition-none";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// D4 패인이 열리면(데스크톱·태블릿) 패널 자리가 레일 + 패인 너비로 넓어진다.
export const PANE_SHELL_WIDTH = "calc(var(--dashboard-pane-width) + var(--dashboard-rail-width))";

// 패널이 차지하는 오른쪽 폭: 지도와 HUD는 이만큼 비켜 선다. 태블릿 서랍과 폰 시트는 장면 위에 겹친다.
export function shellInsetRight(mode, open, pane = false) {
  if (mode === "phone") return "0px";
  if (pane) return PANE_SHELL_WIDTH;
  if (mode === "desktop" && open) return "var(--dashboard-panel-width)";
  return "var(--dashboard-rail-width)";
}

// 닫히는 동안에도 열린 것으로 본다: 내용은 패널과 함께 미끄러져 나가고 레일은 다 닫힌 뒤에 나타난다.
export function useSettledOpen(open) {
  const [settled, setSettled] = useState(open);
  useEffect(() => {
    if (open) {
      setSettled(true);
      return undefined;
    }
    if (window.matchMedia?.(REDUCED_MOTION).matches) {
      setSettled(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setSettled(false), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  return open || settled;
}

const withAlertDot = (icon, count) => <span className="relative inline-flex">{icon}{count > 0 && <AlertDot className="-right-1 -top-1" />}</span>;

// 56px 레일: 탭 아이콘만 둔다(건물은 고른 것이 있을 때만). 아이콘을 누르면 그 탭으로 패널을 연다. 확인할 일이 있는 탭에는 점을 단다.
// 레일은 보이는 제목을 둘 폭이 없어 지금 탭 이름을 화면 읽기용 제목(h2)으로 둔다.
const Rail = forwardRef(function Rail({ activeTab, tabs, tabAlerts, onOpen, className }, activeRef) {
  return (
    <nav
      aria-label="대시보드 레일"
      data-qa="dashboard-rail"
      className={cx("pointer-events-auto absolute inset-y-0 flex w-[var(--dashboard-rail-width)] flex-col items-center gap-2 border-l border-hairline bg-surface-1 py-4", className)}
    >
      <h2 className="sr-only text-body">{dashboardTitle(activeTab)}</h2>
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab.value];
        const active = tab.value === activeTab;
        const alerts = tabAlerts[tab.value] ?? 0;
        return (
          <Button
            key={tab.value}
            ref={active ? activeRef : undefined}
            variant="ghost"
            iconOnly
            label={alerts > 0 ? `${tab.label}, ${alertLabel(alerts)}` : tab.label}
            data-qa={`dashboard-tab-${tab.value}`}
            aria-current={active ? "page" : undefined}
            icon={withAlertDot(<Icon aria-hidden="true" className="h-5 w-5" />, alerts)}
            onClick={() => onOpen(tab.value)}
            className={cx(TARGET_44, "aria-[current=page]:bg-surface-2 aria-[current=page]:text-ink")}
          />
        );
      })}
    </nav>
  );
});

// 화면 폭에 따라 패널 그릇을 고른다(useViewportMode).
// desktop: 오른쪽 붙박이 패널, 닫으면 56px 레일. transform으로 밀려난다.
// tablet: 오른쪽에서 겹쳐 나오는 서랍(--dashboard-drawer-width), 가림막 없음, Esc로 닫고 포커스는 레일의 지금 탭으로 간다.
// phone: 바텀 시트. 처음에는 peek(탭 이름과 여닫기), 탭을 누르면 half.
export const DashboardShell = forwardRef(function DashboardShell(
  {
    mode, open, onOpenChange, detent, onDetentChange, hidden = false, activeTab, onTabChange, tabs = DASHBOARD_TABS, tabAlerts = {},
    hasSelection = false, scrollRef, pane = null, onPaneExit, children,
  },
  panelRef,
) {
  const railTabRef = useRef(null);
  const contentRef = useRef(null);
  const shellRef = useRef(null);
  const focusRailRef = useRef(false);
  const shown = useSettledOpen(open);
  const railTabs = tabs.filter((tab) => tab.value !== "building" || hasSelection);
  const attachShell = useCallback((node) => {
    shellRef.current = node;
    if (typeof panelRef === "function") panelRef(node);
    else if (panelRef) panelRef.current = node;
  }, [panelRef]);

  useInert([shellRef], hidden, [mode]);
  useInert([contentRef], mode !== "phone" && !shown, [mode]);
  // 패널을 닫을 때(Esc 포함) 포커스가 안에 있었으면, 레일이 나타난 뒤 지금 탭 아이콘으로 옮긴다.
  useEffect(() => {
    if (!open && contentRef.current?.contains(document.activeElement)) focusRailRef.current = true;
  }, [open]);
  useEffect(() => {
    if (shown || !focusRailRef.current) return;
    focusRailRef.current = false;
    (railTabRef.current ?? shellRef.current?.querySelector("[data-qa=dashboard-rail] button"))?.focus();
  }, [shown]);

  // D4 패인(폰): 시트가 full로 올라가 패인만 담는다. Esc는 패인이 단계별로 쓴다.
  if (pane && mode === "phone") {
    return (
      <Sheet ref={attachShell} label="D4 상세" data-qa="dashboard-panel" data-pane="d4" detent="full" escapeCollapses={false}>
        {pane}
      </Sheet>
    );
  }

  // D4 패인(데스크톱·태블릿): 레일은 오른쪽 끝에 그대로 두고 그 왼쪽에 패인을 둔다. 레일의 탭을 누르면 D4를 닫고 그 탭을 연다.
  if (pane) {
    return (
      <div
        ref={attachShell}
        data-qa="dashboard-panel"
        data-mode={mode}
        data-pane="d4"
        className="pointer-events-none absolute inset-y-0 right-0 z-10"
        style={{ width: PANE_SHELL_WIDTH }}
      >
        <div className="pointer-events-auto absolute inset-y-0 left-0 border-l border-hairline" style={{ right: "var(--dashboard-rail-width)" }}>
          {pane}
        </div>
        <Rail ref={railTabRef} activeTab={activeTab} tabs={railTabs} tabAlerts={tabAlerts} className="right-0" onOpen={(tab) => {
          onPaneExit?.();
          onTabChange(tab);
          onOpenChange(true);
        }} />
      </div>
    );
  }

  if (mode === "phone") {
    const expanded = detent !== "peek";
    const alertCount = expanded ? 0 : totalTabAlerts(tabAlerts);
    const selectTab = (tab) => {
      onTabChange(tab);
      // 탭을 고르면 시트를 반만 올린다(peek일 때만). 전체 높이는 사용자가 끌어 올린다.
      if (detent === "peek") onDetentChange("half");
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
          <div className="flex h-11 items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-title text-ink">{dashboardTitle(activeTab)}</h2>
            <Button
              variant="ghost"
              iconOnly
              label={expanded ? "패널 닫기" : alertCount > 0 ? `패널 열기, ${alertLabel(alertCount)}` : "패널 열기"}
              icon={withAlertDot(<ChevronUp aria-hidden="true" className={cx("h-5 w-5 transition-transform duration-micro motion-reduce:transition-none", expanded && "rotate-180")} />, alertCount)}
              onClick={() => onDetentChange(expanded ? "peek" : "half")}
              className={TARGET_44}
            />
          </div>
        )}
      >
        <DashboardPanel activeTab={activeTab} onTabChange={selectTab} tabs={tabs} tabAlerts={tabAlerts} showTitle={false} scrollRef={scrollRef}>
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
        width: mode === "tablet" ? "var(--dashboard-drawer-width)" : "var(--dashboard-panel-width)",
        transform: open ? "translateX(0)" : "translateX(calc(100% - var(--dashboard-rail-width)))",
      }}
    >
      {!shown && (
        <Rail ref={railTabRef} activeTab={activeTab} tabs={railTabs} tabAlerts={tabAlerts} className="left-0" onOpen={(tab) => {
          onTabChange(tab);
          onOpenChange(true);
        }} />
      )}
      {/* 레일로 접힌 동안 내용은 레일 밑에 남지만 보이지도, 닿지도 않는다(스크롤 위치와 인스펙터 펼침은 그대로 지킨다). */}
      <div ref={contentRef} aria-hidden={shown ? undefined : "true"} className={cx("pointer-events-auto h-full border-l border-hairline", !shown && "invisible")}>
        <DashboardPanel
          activeTab={activeTab}
          onTabChange={onTabChange}
          tabs={tabs}
          tabAlerts={tabAlerts}
          scrollRef={scrollRef}
          headerAction={(
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
    </div>
  );
});

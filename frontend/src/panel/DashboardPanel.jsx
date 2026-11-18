import { Tabs, TabsContent } from "@/components/ui/tabs";
import { SegmentedTabList } from "../ui/Segmented.jsx";
import { alertLabel } from "./tabAlerts.mjs";

export const DASHBOARD_TABS = Object.freeze([
  { value: "building", label: "건물" },
  { value: "status", label: "현황" },
  { value: "energy", label: "에너지" },
  { value: "simulation", label: "시뮬레이션" },
]);
export const DEFAULT_TAB = "status";

// 예전 탭 값(기존 공유 링크, 시연 일정)은 그 내용이 옮겨 간 새 탭으로 읽는다. 모르는 값은 null이다.
const LEGACY_TABS = Object.freeze({ dashboard: "status", parking_safety: "status", environment: "simulation" });
export function normalizeTab(value) {
  if (Object.hasOwn(LEGACY_TABS, value)) return LEGACY_TABS[value];
  return DASHBOARD_TABS.some((tab) => tab.value === value) ? value : null;
}

export function dashboardTitle(activeTab) {
  return DASHBOARD_TABS.find((tab) => tab.value === activeTab)?.label ?? "";
}

const TABPANEL_ID = "dashboard-tabpanel";
const tabId = (value) => `dashboard-tab-${value}-label`;

// 두 대시보드가 함께 쓰는 패널 내용: 제목(h2), 탭, 스크롤되는 탭 본문(tabpanel).
// 어디에 놓일지(붙박이 패널·서랍·바텀 시트)는 DashboardShell이 정한다. 폰 시트는 제목을 시트 머리에 두므로 showTitle을 끈다.
// tabs는 보여 줄 탭 목록이다(학생 화면은 건물·현황 둘만 넘긴다). tabAlerts는 탭별 확인할 일의 수다(탭 이름 옆 점).
export function DashboardPanel({ activeTab, onTabChange, tabs = DASHBOARD_TABS, tabAlerts = {}, headerAction = null, showTitle = true, scrollRef, children }) {
  const options = tabs.map((tab) => ({ ...tab, qa: `dashboard-tab-${tab.value}`, id: tabId(tab.value), controls: TABPANEL_ID, alert: tabAlerts[tab.value] ? alertLabel(tabAlerts[tab.value]) : undefined }));
  return (
    <Tabs value={activeTab} role="region" aria-label="대시보드" className="flex h-full w-full flex-col bg-surface-1 text-ink">
      <header className="dashboard-panel-content flex flex-col gap-4 px-4 pb-4 pt-4">
        {showTitle && (
          <div className="flex min-h-11 items-center justify-between gap-2">
            <h2 className="min-w-0 break-keep text-title text-ink">{dashboardTitle(activeTab)}</h2>
            {headerAction}
          </div>
        )}
        <SegmentedTabList label="대시보드 보기" size="sm" options={options} value={activeTab} onChange={onTabChange} />
      </header>
      <div ref={scrollRef} data-qa="panel-scroll" className="dashboard-panel-content min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {/* 본문 하나를 탭이 함께 가리킨다. 스크롤 영역 안의 컨트롤 순서를 지키려고 패널 자체는 Tab을 받지 않는다. */}
        <TabsContent value={activeTab} id={TABPANEL_ID} aria-labelledby={tabId(activeTab)} tabIndex={undefined} className="mt-0 flex flex-col gap-6">
          {children}
        </TabsContent>
      </div>
    </Tabs>
  );
}

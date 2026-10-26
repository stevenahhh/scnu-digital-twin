import { Segmented } from "../ui/Segmented.jsx";

export const DASHBOARD_TABS = Object.freeze([
  { value: "dashboard", label: "기본 현황" },
  { value: "parking_safety", label: "주차·안전" },
  { value: "energy", label: "에너지" },
  { value: "environment", label: "환경 시뮬" },
]);

// 패널 제목은 보고 있는 화면 이름이다(브랜드 문구가 아니다).
export function dashboardTitle(activeTab, tabs = DASHBOARD_TABS) {
  const label = tabs.find((tab) => tab.value === activeTab)?.label;
  return label ? `순천대 캠퍼스 · ${label}` : "순천대 캠퍼스";
}

// 두 대시보드가 함께 쓰는 패널 내용: 제목, 탭(Segmented), 스크롤되는 본문, 아래 고정 칸(footer).
// 어디에 놓일지(붙박이 패널·서랍·바텀 시트)는 DashboardShell이 정한다. 양옆 여백은 16px로 같다.
export function DashboardPanel({ activeTab, onTabChange, extraTabs = [], headerAction = null, footer, children }) {
  const tabs = [...DASHBOARD_TABS, ...extraTabs];
  const options = tabs.map((tab) => ({ ...tab, qa: `dashboard-tab-${tab.value}` }));
  return (
    <section aria-label="대시보드" className="flex h-full w-full flex-col bg-surface-1 text-ink">
      <header className="dashboard-panel-content flex flex-col gap-4 px-4 pb-4 pt-4">
        <div className="flex min-h-11 items-center justify-between gap-2">
          <h2 className="min-w-0 break-keep text-title text-ink">{dashboardTitle(activeTab, tabs)}</h2>
          {headerAction}
        </div>
        <Segmented kind="tabs" label="대시보드 보기" size="sm" options={options} value={activeTab} onChange={onTabChange} />
      </header>
      <div className="dashboard-panel-content flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-8">{children}</div>
      {footer}
    </section>
  );
}

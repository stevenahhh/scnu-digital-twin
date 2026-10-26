import { forwardRef } from "react";
import { Segmented } from "../ui/Segmented.jsx";
import { cx } from "../ui/cx.mjs";

export const DASHBOARD_TABS = Object.freeze([
  { value: "dashboard", label: "기본 현황" },
  { value: "parking_safety", label: "주차·안전" },
  { value: "energy", label: "에너지" },
  { value: "environment", label: "환경 시뮬" },
]);

// 두 대시보드가 함께 쓰는 오른쪽 패널 틀: 제목, 탭(Segmented), 스크롤되는 본문, 아래 고정 칸(footer).
// 지도 위에 떠 있지만 불투명한 기능 면(surface-1)이라 뒤 장면이 비치지 않는다. 닫히면 transform으로 화면 밖에 밀려나고,
// DOM에는 남으므로 부르는 쪽이 panelRef에 inert를 건다.
export const DashboardPanel = forwardRef(function DashboardPanel(
  { visible, activeTab, onTabChange, extraTabs = [], footer, children },
  panelRef,
) {
  const options = [...DASHBOARD_TABS, ...extraTabs].map((tab) => ({ ...tab, qa: `dashboard-tab-${tab.value}` }));
  return (
    <div
      ref={panelRef}
      data-qa="dashboard-panel"
      aria-hidden={visible ? undefined : "true"}
      className={cx(
        "pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-[min(var(--dashboard-panel-width),100vw)]",
        "transition-transform duration-surface ease-[var(--motion-ease-standard)] motion-reduce:transition-none",
        visible ? "translate-x-0" : "translate-x-full",
      )}
    >
      <section
        aria-label="대시보드"
        className="pointer-events-auto flex h-full w-full flex-col border-l border-hairline bg-surface-1 text-ink"
      >
        <header className="dashboard-panel-content flex flex-col gap-4 px-6 pb-4 pt-8">
          <h2 className="text-title text-ink">스마트 시티 대시보드</h2>
          <Segmented kind="tabs" label="대시보드 보기" size="sm" options={options} value={activeTab} onChange={onTabChange} />
        </header>
        <div className="dashboard-panel-content flex flex-1 flex-col gap-6 overflow-y-auto px-6 pb-8">{children}</div>
        {footer}
      </section>
    </div>
  );
});

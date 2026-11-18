import { SectionHeader } from "../ui/SectionHeader.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { describeRestriction } from "./restrictionModel.mjs";

// 현황 탭의 통제·공사 알림 목록. 관리자가 넣은 시뮬레이션 시나리오이므로 실제 공지가 아니라고 함께 적는다.
export function RestrictionNotices({ items }) {
  if (items.length === 0) return null;
  return (
    <section data-qa="restriction-notices" className="flex flex-col gap-3">
      <SectionHeader title="교통 통제·공사 알림" />
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const text = describeRestriction(item);
          return (
            <li key={item.id} className="flex flex-col gap-1 rounded-card bg-surface-2 px-3 py-2">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-keep text-body font-medium text-ink">{text.title}</span>
                <StatusBadge tone="warning">{text.status}</StatusBadge>
              </span>
              {text.detail && <span className="break-keep text-caption text-ink-muted">{text.detail}</span>}
            </li>
          );
        })}
      </ul>
      <p className="break-keep text-caption text-ink-muted">시뮬레이션 시나리오 · 실제 공지가 아닙니다</p>
    </section>
  );
}

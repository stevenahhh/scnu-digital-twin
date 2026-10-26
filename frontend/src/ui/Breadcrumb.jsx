import { ChevronRight } from "lucide-react";
import { COARSE_TARGET, FOCUS_RING } from "./Button.jsx";
import { cx } from "./cx.mjs";

// 캠퍼스 > 건물 > 층 > 호실. 마지막(현재 위치)을 뺀 모든 단계가 버튼이다.
export function Breadcrumb({ items, className, ...rest }) {
  return (
    <nav aria-label="breadcrumb" data-qa="breadcrumb" className={className} {...rest}>
      <ol className="flex flex-wrap items-center gap-1 text-caption">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={item.id ?? item.label} className="flex items-center gap-1">
              {last ? (
                <span aria-current="page" className="break-keep px-1 font-semibold text-ink">
                  {item.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={item.onSelect}
                  className={cx("min-h-8 break-keep rounded-control px-1 text-ink-muted hover:bg-surface-2 hover:text-ink", COARSE_TARGET, FOCUS_RING)}
                >
                  {item.label}
                </button>
              )}
              {!last && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

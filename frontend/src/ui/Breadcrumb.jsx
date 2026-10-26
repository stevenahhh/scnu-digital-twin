import { COARSE_TARGET, FOCUS_RING } from "./Button.jsx";
import { cx } from "./cx.mjs";

// 캠퍼스 › 건물 › 층 › 호실. 마지막(현재 위치)을 뺀 모든 단계가 버튼이다.
// 구분자 `›`는 글자로 그려 경로를 글로 읽어도(복사·검색) 단계가 이어진다. 보조 기술에는 목록 구조로 충분하므로 숨긴다.
// currentHeading(2..4)이면 현재 위치를 그 화면의 제목(h2 등)으로 쓴다. item.ariaLabel은 버튼의 이름을 더 자세히 준다
// (보이는 글자를 포함해야 한다).
export function Breadcrumb({ items, currentHeading = null, className, ...rest }) {
  const Current = currentHeading ? `h${Math.min(Math.max(currentHeading, 2), 4)}` : "span";
  return (
    <nav aria-label="breadcrumb" data-qa="breadcrumb" className={className} {...rest}>
      <ol className="flex flex-wrap items-center gap-1 text-caption">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={item.id ?? item.label} className="flex items-center gap-1">
              {last ? (
                <Current aria-current="page" className="inline-flex items-center gap-1 break-keep px-1 text-caption font-semibold text-ink">
                  {item.label}
                </Current>
              ) : (
                <button
                  type="button"
                  onClick={item.onSelect}
                  aria-label={item.ariaLabel}
                  className={cx(
                    "inline-flex min-h-8 items-center gap-1 break-keep rounded-control px-1 text-ink-muted hover:bg-surface-2 hover:text-ink",
                    COARSE_TARGET,
                    FOCUS_RING,
                  )}
                >
                  {item.label}
                </button>
              )}
              {!last && <span aria-hidden="true" className="shrink-0 text-ink-muted">›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

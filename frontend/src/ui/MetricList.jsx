import { Button } from "./Button.jsx";
import { cx } from "./cx.mjs";

// 현재 상태를 이름·값 두 열의 dl로 보여 준다. 값 칸에는 EstimateValue를 넣을 수 있다.
// 값이 비면 자리 표시 기호 대신 이유(empty.message)와 다음 동작 버튼을 보여 준다.
// 출처 설명(caption)은 묶음마다 한 번만 둔다.
export function MetricList({ items, caption, columns = 1, className, ...rest }) {
  return (
    <div className={cx("flex flex-col gap-2", className)} {...rest}>
      <dl data-qa="metric-list" className={cx("grid gap-x-4 gap-y-2", columns === 2 ? "sm:grid-cols-2" : "grid-cols-1")}>
        {items.map((item) => (
          <div key={item.id ?? item.label} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-hairline pb-2 last:border-b-0">
            <dt className="break-keep text-caption text-ink-muted">{item.label}</dt>
            <dd className="min-w-0 text-right">
              {item.value ?? (
                <span data-empty="true" className="inline-flex flex-wrap items-center justify-end gap-2">
                  <span className="break-keep text-caption text-ink-muted">{item.empty?.message ?? "데이터 없음"}</span>
                  {item.empty?.onAction && (
                    <Button size="sm" variant="ghost" onClick={item.empty.onAction}>
                      {item.empty.actionLabel ?? "다시 시도"}
                    </Button>
                  )}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {caption && <p className="break-keep text-caption text-[var(--colors-estimate-ink)]">{caption}</p>}
    </div>
  );
}
